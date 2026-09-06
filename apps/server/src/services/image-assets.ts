import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { maxImageReferences, ZelyqError } from "@zelyq/core";

/** Application data; never placed in a project workspace or public web root. */
export class ImageAssetStore {
  constructor(private readonly root: string) {}

  private directory(ownerId: string) {
    if (!/^usr_[a-f0-9]{32}$/.test(ownerId)) throw ZelyqError.badRequest("Invalid image owner.");
    return path.join(this.root, ownerId);
  }
  private file(ownerId: string, id: string) {
    if (!/^img_[a-f0-9]{32}$/.test(id)) throw ZelyqError.badRequest("Invalid image ID.");
    return path.join(this.directory(ownerId), `${id}.png`);
  }
  private referenceFile(ownerId: string, id: string, index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= maxImageReferences)
      throw ZelyqError.badRequest("Invalid reference image.");
    return path.join(this.directory(ownerId), `${id}.ref-${index}.png`);
  }
  async save(ownerId: string, id: string, bytes: Buffer) {
    const target = this.file(ownerId, id);
    await fs.mkdir(this.directory(ownerId), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async read(ownerId: string, id: string) {
    return fs.readFile(this.file(ownerId, id));
  }
  async saveReference(ownerId: string, id: string, index: number, bytes: Buffer) {
    const target = this.referenceFile(ownerId, id, index);
    await fs.mkdir(this.directory(ownerId), { recursive: true, mode: 0o700 });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async readReferences(ownerId: string, id: string, count: number) {
    return Promise.all(
      Array.from({ length: Math.min(count, maxImageReferences) }, (_, index) =>
        fs.readFile(this.referenceFile(ownerId, id, index)),
      ),
    );
  }
  async remove(ownerId: string, id: string) {
    await fs.rm(this.file(ownerId, id), { force: true });
    await Promise.all(
      Array.from({ length: maxImageReferences }, (_, index) =>
        fs.rm(this.referenceFile(ownerId, id, index), { force: true }),
      ),
    );
  }
  async removeUser(ownerId: string) {
    await fs.rm(this.directory(ownerId), { recursive: true, force: true });
  }
}
