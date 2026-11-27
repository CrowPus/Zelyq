import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import { type StorageConfig, StorageSetupError, storeFor } from "./app-sleep.js";
import type { ObjectStore } from "./object-store.js";
import { within } from "./within.js";

/**
 * Generated images and videos nobody has opened for a while move to the server's storage
 * (Server settings → Storage), like sleeping apps: the disk keeps only the ones in use. Anything
 * that reads one brings it back to the disk first, so playback, the video checks and the frame
 * grabber keep working on ordinary files.
 *
 * Only the files Zelyq names itself move (img_….png and their references, vid_….mp4, vrf_….png),
 * under <folder in the storage>/media/<images|videos>/<owner>/<file>. Frames and posters made from
 * a video stay: they are small, and made again from it.
 *
 * A moved file leaves a small note beside it (<file>.stored) saying which storage holds it, so:
 * a file that is simply missing stays "not found"; each file comes back from where it went even
 * after the storage settings change; and a new storage can be used for new moves at once.
 *
 * Safe by order: a file leaves the disk only after its copy is checked in storage, only if it still
 * exists and nobody opened it lately, and the note is written before it goes. Deleting waits for a
 * move or a fetch of the same file; a stored copy that cannot be deleted now is kept on a list and
 * deleted later.
 */

export type MediaKind = "images" | "videos";

const NAMES: Record<MediaKind, RegExp> = {
  images: /^img_[a-f0-9]{32}(\.ref-\d+)?\.png$/,
  videos: /^(vid_[a-f0-9]{32}\.mp4|vrf_[a-f0-9]{32}\.png)$/,
};
const OWNER = /^usr_[a-f0-9]{32}$/;
const DAY_MS = 24 * 60 * 60_000;
/** Read this recently: in use, whatever the days asked (an admin's "now" included). */
const IN_USE_MS = 10 * 60_000;
const NOTE = ".stored";

export interface MediaSleepDeps {
  store: Store;
  kind: MediaKind;
  /** The folder the store keeps its files in: <root>/<owner>/<file>. */
  root: string;
  config: () => Promise<StorageConfig>;
  log?: (message: string) => void;
}

type Found = { store: ObjectStore; identity: string };

export class MediaSleep {
  private cached: {
    signature: string;
    found: ReturnType<typeof storeFor> | StorageSetupError;
  } | null = null;
  /** Files being moved, fetched or deleted, so these wait for each other. */
  private readonly busy = new Map<string, Promise<unknown>>();
  /** When each file was last read, in this process. */
  private readonly lastRead = new Map<string, number>();
  private orphanChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: MediaSleepDeps) {}

  private get orphanKey(): string {
    return `media:${this.deps.kind}:to-delete`;
  }

  async storage(): Promise<Found | null> {
    const config = await this.deps.config();
    const signature = JSON.stringify(config);
    if (this.cached?.signature !== signature) {
      let found: ReturnType<typeof storeFor> | StorageSetupError;
      try {
        found = storeFor(config);
      } catch (error) {
        found =
          error instanceof StorageSetupError
            ? error
            : new StorageSetupError((error as Error).message);
      }
      this.cached = { signature, found };
    }
    if (this.cached.found instanceof StorageSetupError) throw this.cached.found;
    return this.cached.found;
  }

  private key(owner: string, name: string): string {
    return `media/${this.deps.kind}/${owner}/${name}`;
  }

  /** The owner and name of a file under this store's folder, or null for anything else. */
  private parts(file: string): { owner: string; name: string; file: string } | null {
    const relative = path.relative(path.resolve(this.deps.root), path.resolve(file));
    const [owner, name, ...rest] = relative.split(path.sep);
    if (rest.length || !owner || !name || !OWNER.test(owner) || !NAMES[this.deps.kind].test(name))
      return null;
    // The path made again from the checked names, inside this store's folder.
    return { owner, name, file: within(this.deps.root, owner, name) };
  }

  /** Where a moved file is: the storage named in its note, or null when it never moved. */
  private async movedTo(file: string): Promise<string | null> {
    return await fs.readFile(`${file}${NOTE}`, "utf8").then(
      (text) => text.trim() || null,
      () => null,
    );
  }

  private async locked<T>(file: string, work: () => Promise<T>): Promise<T> {
    const before = this.busy.get(file) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(work);
    this.busy.set(file, next);
    try {
      return await next;
    } finally {
      if (this.busy.get(file) === next) this.busy.delete(file);
    }
  }

  /**
   * Makes sure a file is on the disk before it is read: brought back from storage when it moved
   * there. A file that never moved and is missing stays missing (the caller's own "not found").
   */
  async local(given: string): Promise<void> {
    const parts = this.parts(given);
    if (!parts) return;
    const file = parts.file;
    const now = Date.now();
    const before = this.lastRead.get(file) ?? 0;
    this.lastRead.set(file, now);
    if (!this.busy.has(file) && (await exists(file))) {
      // Marked as used on the disk too, at most once an hour (this survives a restart).
      if (now - before > 60 * 60_000)
        await fs.utimes(file, new Date(now), new Date(now)).catch(() => undefined);
      return;
    }
    await this.locked(file, async () => {
      if (await exists(file)) return;
      const where = await this.movedTo(file);
      if (!where) return;
      let storage: Found | null;
      try {
        storage = await this.storage();
      } catch (error) {
        throw new ZelyqError(
          "runtime_unavailable",
          `This file is kept in storage and could not be fetched: ${(error as Error).message} (Server settings → Storage).`,
        );
      }
      if (!storage || storage.identity !== where) {
        throw new ZelyqError(
          "runtime_unavailable",
          "This file is kept in the storage this server used before. Set that storage up again under Server settings → Storage to open it.",
        );
      }
      const key = this.key(parts.owner, parts.name);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${randomUUID()}.fetch`;
      try {
        try {
          await storage.store.getFile(key, temp);
        } catch (error) {
          throw new ZelyqError(
            "runtime_unavailable",
            `This file is kept in storage and could not be fetched: ${(error as Error).message}`,
          );
        }
        await fs.chmod(temp, 0o600);
        // The person was deleted while it was fetched (their folder and its notes went): not put back.
        if (!(await this.movedTo(file))) return;
        await fs.rename(temp, file);
      } finally {
        await fs.rm(temp, { force: true });
      }
      await fs.rm(`${file}${NOTE}`, { force: true });
      // Back on the disk: the stored copy is no longer needed (storage is paid by what it holds).
      await this.deleteStored(storage, where, [key]);
    });
  }

  /**
   * Moves files nobody has read for `days` days (by the time they were last written or read) to
   * storage. Returns how many moved. 0 days: every file not read in the last few minutes.
   */
  async sweep(days: number): Promise<number> {
    const storage = await this.storage();
    if (!storage || days < 0) return 0;
    await this.retryOrphans(storage);
    const started = Date.now();
    const cutoff = Math.min(started - days * DAY_MS, started - IN_USE_MS);
    let moved = 0;
    for (const owner of await entries(this.deps.root)) {
      if (!OWNER.test(owner)) continue;
      for (const name of await entries(within(this.deps.root, owner))) {
        if (!NAMES[this.deps.kind].test(name)) continue;
        const file = within(this.deps.root, owner, name);
        try {
          if (await this.moveOne(file, owner, name, storage, started, cutoff)) moved += 1;
        } catch (error) {
          this.deps.log?.(
            `${this.deps.kind}: ${name} stays on this disk for now: ${(error as Error).message}`,
          );
        }
      }
    }
    if (moved > 0)
      this.deps.log?.(`${this.deps.kind}: ${moved} file(s) moved to ${storage.store.label}`);
    return moved;
  }

  private async moveOne(
    file: string,
    owner: string,
    name: string,
    storage: Found,
    started: number,
    cutoff: number,
  ): Promise<boolean> {
    return await this.locked(file, async () => {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) return false;
      // Written or read since the cutoff (a read marks the file, so this survives a restart).
      if (Math.max(stat.mtimeMs, this.lastRead.get(file) ?? 0) > cutoff) return false;
      const key = this.key(owner, name);
      const { bytes } = await storage.store.putFile(key, file);
      const stillThere = await fs.stat(file).catch(() => null);
      // Deleted while it was uploading (a person's whole folder may go at once), or read
      // meanwhile: the copy goes, the file stays as it is.
      if (!stillThere || (this.lastRead.get(file) ?? 0) >= started) {
        await this.deleteStored(storage, storage.identity, [key]);
        return false;
      }
      if (
        bytes !== stat.size ||
        stillThere.size !== stat.size ||
        (await storage.store.size(key)) !== stat.size
      ) {
        await this.deleteStored(storage, storage.identity, [key]);
        throw new Error("its copy in storage is not complete");
      }
      // This copy is the file now: a delete of the same key waiting on the list must never take it.
      await this.unlist(storage.identity, key);
      await fs.writeFile(`${file}${NOTE}`, storage.identity, { mode: 0o600 });
      await fs.rm(file);
      return true;
    });
  }

  /**
   * One file deleted (`remove` deletes it from the disk): waits for a move or fetch of the same
   * file, then its stored copy goes too.
   */
  async removed(given: string, remove: () => Promise<void>): Promise<void> {
    const parts = this.parts(given);
    if (!parts) return await remove();
    const file = parts.file;
    await this.locked(file, async () => {
      await remove();
      const where = await this.movedTo(file);
      await fs.rm(`${file}${NOTE}`, { force: true });
      if (where) {
        await this.deleteStored(await this.storage().catch(() => null), where, [
          this.key(parts.owner, parts.name),
        ]);
      }
    });
  }

  /** The notes of a person's moved files, read before their folder is deleted. */
  async notesOf(owner: string): Promise<Array<{ name: string; where: string }>> {
    if (!OWNER.test(owner)) return [];
    const notes: Array<{ name: string; where: string }> = [];
    for (const entry of await entries(within(this.deps.root, owner))) {
      if (!entry.endsWith(NOTE)) continue;
      const name = entry.slice(0, -NOTE.length);
      if (!NAMES[this.deps.kind].test(name)) continue;
      const where = await this.movedTo(within(this.deps.root, owner, name));
      if (where) notes.push({ name, where });
    }
    return notes;
  }

  /** A person deleted (after their folder went): every stored file of theirs goes too, in every storage noted. */
  async forgetOwner(owner: string, notes: Array<{ name: string; where: string }>): Promise<void> {
    if (!OWNER.test(owner)) return;
    const storage = await this.storage().catch(() => null);
    const byStorage = new Map<string, string[]>();
    for (const { name, where } of notes)
      byStorage.set(where, [...(byStorage.get(where) ?? []), this.key(owner, name)]);
    // Also whatever the current storage holds for them (a move under way when the folder went).
    if (storage) {
      const listed = await storage.store
        .list(`media/${this.deps.kind}/${owner}`)
        .catch(() => [] as string[]);
      byStorage.set(storage.identity, [
        ...new Set([...(byStorage.get(storage.identity) ?? []), ...listed]),
      ]);
    }
    for (const [where, keys] of byStorage)
      if (keys.length) await this.deleteStored(storage, where, keys);
  }

  /** Deletes stored copies; what cannot be deleted now (another storage, or unreachable) is kept on a list. */
  private async deleteStored(storage: Found | null, where: string, keys: string[]): Promise<void> {
    const left: string[] = [];
    for (const key of keys) {
      if (!storage || storage.identity !== where) left.push(key);
      else await storage.store.delete(key).catch(() => left.push(key));
    }
    if (!left.length) return;
    await this.orphansLocked(async () => {
      const list = await this.orphans();
      list.push({ storage: where, keys: left });
      await this.deps.store.settings.set(this.orphanKey, JSON.stringify(list));
    });
  }

  /** Takes a key off the to-delete list for a storage (it holds a file again). */
  private async unlist(where: string, key: string): Promise<void> {
    await this.orphansLocked(async () => {
      const list = await this.orphans();
      if (!list.some((entry) => entry.storage === where && entry.keys.includes(key))) return;
      const left = list
        .map((entry) =>
          entry.storage === where ? { ...entry, keys: entry.keys.filter((k) => k !== key) } : entry,
        )
        .filter((entry) => entry.keys.length > 0);
      await this.deps.store.settings.set(this.orphanKey, JSON.stringify(left));
    });
  }

  private async orphans(): Promise<Array<{ storage: string; keys: string[] }>> {
    try {
      return JSON.parse((await this.deps.store.settings.get(this.orphanKey)) ?? "[]");
    } catch {
      return [];
    }
  }

  private async orphansLocked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.orphanChain.catch(() => undefined).then(work);
    this.orphanChain = next;
    return await next;
  }

  /** Stored copies that could not be deleted before, tried again while their storage is the one set. */
  private async retryOrphans(storage: Found): Promise<void> {
    await this.orphansLocked(async () => {
      const list = await this.orphans();
      if (!list.length) return;
      const left: typeof list = [];
      for (const entry of list) {
        if (entry.storage !== storage.identity) {
          left.push(entry);
          continue;
        }
        const keys: string[] = [];
        for (const key of entry.keys) await storage.store.delete(key).catch(() => keys.push(key));
        if (keys.length) left.push({ storage: entry.storage, keys });
      }
      await this.deps.store.settings.set(this.orphanKey, JSON.stringify(left));
    });
  }
}

async function exists(file: string): Promise<boolean> {
  return await fs.access(file).then(
    () => true,
    () => false,
  );
}

async function entries(dir: string): Promise<string[]> {
  return await fs.readdir(dir).catch(() => [] as string[]);
}
