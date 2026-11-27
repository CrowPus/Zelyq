import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { maxImageReferences, ZelyqError } from "@zelyq/core";
import type { MediaSleep } from "./storage/media-sleep.js";
import { within } from "./storage/within.js";

/** Application data; never placed in a project workspace or public web root. */
export class ImageAssetStore {
  /** Images nobody opened for a while are kept in storage, and fetched back before a read (storage/media-sleep.ts). */
  media?: MediaSleep;

  constructor(readonly root: string) {}

  private directory(ownerId: string) {
    if (!/^usr_[a-f0-9]{32}$/.test(ownerId)) throw ZelyqError.badRequest("Invalid image owner.");
    return within(this.root, ownerId);
  }
  private file(ownerId: string, id: string) {
    if (!/^img_[a-f0-9]{32}$/.test(id)) throw ZelyqError.badRequest("Invalid image ID.");
    return within(this.directory(ownerId), `${id}.png`);
  }
  private referenceFile(ownerId: string, id: string, index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= maxImageReferences)
      throw ZelyqError.badRequest("Invalid reference image.");
    return within(this.directory(ownerId), `${id}.ref-${index}.png`);
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
    const file = this.file(ownerId, id);
    await this.media?.local(file);
    return fs.readFile(file);
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
      Array.from({ length: Math.min(count, maxImageReferences) }, async (_, index) => {
        const file = this.referenceFile(ownerId, id, index);
        await this.media?.local(file);
        return fs.readFile(file);
      }),
    );
  }
  async remove(ownerId: string, id: string) {
    const files = [
      this.file(ownerId, id),
      ...Array.from({ length: maxImageReferences }, (_, index) =>
        this.referenceFile(ownerId, id, index),
      ),
    ];
    const rm = (file: string) => () => fs.rm(file, { force: true });
    await Promise.all(
      files.map((file) => (this.media ? this.media.removed(file, rm(file)) : rm(file)())),
    );
  }
  async removeUser(ownerId: string) {
    const notes = (await this.media?.notesOf(ownerId)) ?? [];
    await fs.rm(this.directory(ownerId), { recursive: true, force: true });
    await this.media?.forgetOwner(ownerId, notes);
  }
}
