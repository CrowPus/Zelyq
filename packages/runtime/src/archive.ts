import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { ZelyqError } from "@zelyq/core";

/**
 * A project's files as a gzipped tar, for shipping an app to a pipeline
 * runner, which unpacks it with the `tar` every Linux, macOS and Windows 10+
 * machine has. Written here rather than shelling out so it is the same bytes
 * on every server, and so no file name ever passes through a shell.
 *
 * Plain files only: the caller's file list already leaves out node_modules,
 * .git and local .env files, and symlinks are not followed.
 */

/** Large enough for any app source; a runner installs dependencies itself. */
export const ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;

export async function tarGz(root: string, files: { path: string }[]): Promise<Buffer> {
  const blocks: Buffer[] = [];
  let total = 0;
  for (const file of files) {
    const absolute = path.join(root, file.path);
    const stat = await fs.lstat(absolute).catch(() => null);
    if (!stat?.isFile()) continue;
    total += stat.size;
    if (total > ARCHIVE_MAX_BYTES) {
      throw ZelyqError.badRequest(
        "This app is larger than 256 MB without node_modules; it cannot be sent to a runner.",
      );
    }
    const data = await fs.readFile(absolute);
    blocks.push(...entry(file.path, data, stat.mode & 0o777, Math.floor(stat.mtimeMs / 1000)));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function entry(name: string, data: Buffer, mode: number, mtime: number): Buffer[] {
  const out: Buffer[] = [];
  const nameBytes = Buffer.from(name, "utf8");
  let ustarName = name;
  // A name over 100 bytes (or not plain ASCII) goes in a PAX header first.
  if (nameBytes.length > 100 || nameBytes.length !== name.length) {
    const record = paxRecord("path", name);
    out.push(header("././@PaxHeader", record.length, 0o644, mtime, "x"), pad(record));
    ustarName = name.replace(/[^\x20-\x7e]/g, "_").slice(-100);
  }
  out.push(header(ustarName, data.length, mode || 0o644, mtime, "0"), pad(data));
  return out;
}

/** "<length> key=value\n", where length counts itself. */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length += 1;
  return Buffer.from(`${length}${body}`, "utf8");
}

function header(name: string, size: number, mode: number, mtime: number, type: string): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write(octal(mode, 8), 100, "ascii");
  block.write(octal(0, 8), 108, "ascii");
  block.write(octal(0, 8), 116, "ascii");
  block.write(octal(size, 12), 124, "ascii");
  block.write(octal(mtime, 12), 136, "ascii");
  block.write("        ", 148, "ascii");
  block.write(type, 156, "ascii");
  block.write("ustar\u000000", 257, "ascii");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\u0000 `, 148, "ascii");
  return block;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\u0000`;
}

function pad(data: Buffer): Buffer {
  const rest = data.length % 512;
  return rest === 0 ? data : Buffer.concat([data, Buffer.alloc(512 - rest)]);
}
