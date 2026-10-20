import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ZelyqError } from "@zelyq/core";

const EXTENSION: Record<string, string> = { "image/png": "png", "image/webp": "webp" };

/**
 * The files of the images outside agents were given to work from in Studio —
 * a portrait, a logo. The rows are in `agent_references`; the bytes live here,
 * beside the database like Studio's own images, never in an app's files.
 */
export class AgentReferenceStore {
  constructor(private readonly root: string) {}

  private file(id: string, mimeType: string): string {
    if (!/^arf_[a-f0-9]{32}$/.test(id)) throw ZelyqError.badRequest("Invalid reference ID.");
    const extension = EXTENSION[mimeType];
    if (!extension) throw ZelyqError.badRequest("Unsupported reference type.");
    return path.join(this.root, `${id}.${extension}`);
  }

  async save(id: string, mimeType: string, bytes: Buffer): Promise<void> {
    const target = this.file(id, mimeType);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  async read(id: string, mimeType: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.file(id, mimeType));
    } catch {
      throw ZelyqError.notFound("Reference image", id);
    }
  }

  async remove(id: string, mimeType: string): Promise<void> {
    await fs.rm(this.file(id, mimeType), { force: true });
  }
}
