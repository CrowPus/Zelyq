import fs from "node:fs/promises";
import path from "node:path";
import type { AttachmentRef } from "@zelyq/core";
import { newId, ZelyqError } from "@zelyq/core";

const MAX_BYTES = 8 * 1024 * 1024;

interface StoredMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Where a prompt's uploaded files live. Deliberately not the project's own
 * workspace: an attachment is conversation data, not project data, and a
 * project's files are committed to git automatically — an image landing in
 * that history by accident is not this feature's call to make.
 *
 * Uses plain `node:fs` directly, the same way `secrets.ts` already does for
 * the encryption key file — this is application data outside `RuntimeDriver`'s
 * scope, not a project file, so it has no business going through the
 * abstraction meant for those.
 *
 * Metadata is a small sidecar JSON file next to the bytes rather than a new
 * database table: an attachment's own reference (id, filename, mimeType,
 * sizeBytes) already lives on the message row that used it, which is the
 * only place that ever needs to list them; this only ever needs to answer
 * "what are the bytes and type for this one id", which a sidecar answers
 * without a schema migration.
 */
export class AttachmentService {
  constructor(private readonly baseDir: string) {}

  private dirFor(projectId: string): string {
    // The id has already gone through `newId`/route validation by the time
    // it reaches here — never user-supplied text used as a path segment.
    return path.join(this.baseDir, projectId);
  }

  private blobPath(projectId: string, id: string): string {
    return path.join(this.dirFor(projectId), id);
  }

  private metaPath(projectId: string, id: string): string {
    return path.join(this.dirFor(projectId), `${id}.json`);
  }

  async store(
    projectId: string,
    input: { filename: string; mimeType: string; data: string },
  ): Promise<AttachmentRef> {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.data, "base64");
    } catch {
      throw ZelyqError.badRequest("That attachment's data was not valid base64.");
    }
    if (bytes.length === 0) {
      throw ZelyqError.badRequest("That attachment is empty.");
    }
    if (bytes.length > MAX_BYTES) {
      throw ZelyqError.badRequest(
        `That attachment is ${Math.ceil(bytes.length / 1024 / 1024)}MB — the limit is ` +
          `${MAX_BYTES / 1024 / 1024}MB.`,
      );
    }

    const id = newId("attachment");
    const meta: StoredMeta = {
      filename: input.filename,
      mimeType: input.mimeType || "application/octet-stream",
      sizeBytes: bytes.length,
    };

    await fs.mkdir(this.dirFor(projectId), { recursive: true });
    await fs.writeFile(this.blobPath(projectId, id), bytes);
    await fs.writeFile(this.metaPath(projectId, id), JSON.stringify(meta));

    return { id, ...meta };
  }

  /** Null for an id that was never stored, or belongs to a different project. */
  async get(projectId: string, id: string): Promise<{ ref: AttachmentRef; data: Buffer } | null> {
    try {
      const [data, metaRaw] = await Promise.all([
        fs.readFile(this.blobPath(projectId, id)),
        fs.readFile(this.metaPath(projectId, id), "utf8"),
      ]);
      const meta = JSON.parse(metaRaw) as StoredMeta;
      return { ref: { id, ...meta }, data };
    } catch {
      return null;
    }
  }

  async removeProject(projectId: string): Promise<void> {
    await fs.rm(this.dirFor(projectId), { recursive: true, force: true });
  }
}
