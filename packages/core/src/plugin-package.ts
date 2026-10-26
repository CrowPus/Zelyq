import { createHash } from "node:crypto";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { ZelyqError } from "./errors.js";
import { type PluginManifest, parsePluginManifest } from "./pipelines.js";

/** A package as uploaded: at most this, packed. */
export const MAX_PLUGIN_PACKAGE_BYTES = 10 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;
const MANIFEST = "zelyq-plugin.yml";

/**
 * Reads and checks a plugin package: a gzipped tar of plain files and
 * folders, with relative paths only (no links, nothing outside the package),
 * within size, and a valid `zelyq-plugin.yml` at its top.
 */
export function readPluginPackage(body: Buffer): {
  manifest: PluginManifest;
  sha256: string;
  /** Every file in it, by its path inside the package. */
  files: Map<string, Buffer>;
} {
  const refuse = (message: string): never => {
    throw ZelyqError.badRequest(`This is not a plugin package Zelyq accepts: ${message}`);
  };
  if (body.length === 0) refuse("the file is empty.");
  if (body.length > MAX_PLUGIN_PACKAGE_BYTES) refuse("it is larger than 10 MB.");
  let tar: Buffer;
  try {
    tar = gunzipSync(body, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    return refuse("it is not a .tar.gz, or unpacks to more than 50 MB.");
  }
  const files = new Map<string, Buffer>();
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  let count = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) refuse("a file's size is not readable.");
    const type = String.fromCharCode(header[156] ?? 0);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = data.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    if (type === "x") {
      const match = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      paxPath = match?.[1] ?? null;
      continue;
    }
    if (type === "g") continue;
    const prefix = field(345, 155);
    const raw = paxPath ?? longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    paxPath = null;
    const name = raw.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
    if (type !== "0" && type !== "\0" && type !== "5") {
      refuse(`${raw} is a link or a special file; a plugin holds only files and folders.`);
    }
    if (name === "" || name === ".") continue;
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split(/[\\/]/).includes("..")) {
      refuse(`${raw} points outside the package.`);
    }
    if (type === "5") continue;
    count += 1;
    if (count > MAX_FILES) refuse(`it holds more than ${MAX_FILES} files.`);
    files.set(name, Buffer.from(data));
  }
  const manifestFile = files.get(MANIFEST);
  if (!manifestFile) {
    const nested = [...files.keys()].find((name) => name.endsWith(`/${MANIFEST}`));
    return refuse(
      nested
        ? `${MANIFEST} must be at the top of the package, not in ${path.posix.dirname(nested)}/. Pack it from inside the plugin's folder: tar -czf plugin.tar.gz -C my-plugin .`
        : `there is no ${MANIFEST} in it.`,
    );
  }
  const parsed = parsePluginManifest(manifestFile.toString("utf8"));
  if (!parsed.ok) return refuse(`${MANIFEST}: ${parsed.message}`);
  return {
    manifest: parsed.manifest,
    sha256: createHash("sha256").update(body).digest("hex"),
    files,
  };
}
