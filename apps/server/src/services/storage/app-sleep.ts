import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import { FolderObjectStore, type ObjectStore, S3ObjectStore } from "./object-store.js";

const run = promisify(execFile);

/**
 * Apps nobody has opened for a while sleep in the server's storage (Server settings → Storage):
 * a bucket or a folder, not this disk. Asleep, an app is up to three packed files there — its own
 * files, its undo points and its chat attachments — and a small record here saying where they are.
 * Anything that reaches the app wakes it first (the runtime, the agent, attachments), so nobody
 * needs to know it slept: the first open just takes a few seconds longer.
 *
 * Safe by order:
 * - An app with any action running, or used since the sleep began, is not put to sleep.
 * - The packed copy is checked where it landed before anything else happens.
 * - The files are moved aside (one rename each, same disk) before the record is written, and moved
 *   back if anything fails; once the record is written, the stored copy is never deleted by a
 *   failure, and what was moved aside is only removed after. A restart in the middle is tidied up
 *   on the next start: moved-aside files with no record go back.
 * - The app's own folder stays (only what is in it moves), so a container that mounts it keeps
 *   seeing the same folder after a wake.
 * - On waking, the files are back in place before the record and the stored copy go.
 */

export type SleepPart = "app" | "undo" | "attachments";

export interface SleepRecord {
  /** Where, under the storage's own folder: apps/<id>/<stamp>/<part>.tar.gz */
  keys: Partial<Record<SleepPart, string>>;
  /** What the files take unpacked, for the team's storage. */
  bytes: Partial<Record<SleepPart, number>>;
  /** What the packed copies take in storage. */
  stored: number;
  at: string;
  /** The storage it went to, for messages: "bucket zelyq-apps (storage.googleapis.com)". */
  where: string;
  /** Which storage exactly (kind, address, bucket or folder, folder in it): waking needs the same one. */
  storage: string;
}

export interface StorageConfig {
  kind: "off" | "s3" | "folder";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  pathStyle: boolean;
  folder: string;
}

export interface AppSleepDeps {
  store: Store;
  /** The server's storage settings now (they can change without a restart). */
  config: () => Promise<StorageConfig>;
  workspaceDir: string;
  attachmentsDir: string;
  log?: (message: string) => void;
}

const recordKey = (projectId: string) => `project:${projectId}:asleep`;
const ORPHANS = "storage:to-delete";
/** Written into what a finished sleep moved aside, so it is never mistaken for an unfinished one. */
const DONE = ".zelyq-sleep-done";
/** No dots: the leftover folders below are named with dots around the id. */
const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Storage settings that cannot work, said so an admin can fix them. */
export class StorageSetupError extends Error {}

/** The storage the settings describe; null while it is off or not filled in. Throws StorageSetupError when wrong. */
export function storeFor(config: StorageConfig): { store: ObjectStore; identity: string } | null {
  const prefix = config.prefix.trim();
  if (prefix && !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/?$/.test(prefix.replace(/^\/+/, ""))) {
    throw new StorageSetupError(
      "The folder name in the storage may only have letters, digits, dots, dashes and underscores, with / between parts.",
    );
  }
  if (config.kind === "folder" && config.folder.trim()) {
    const folder = config.folder.trim();
    if (!path.isAbsolute(folder))
      throw new StorageSetupError(
        `The folder must be a full path, such as /mnt/zelyq-archive, not "${folder}".`,
      );
    return {
      store: new FolderObjectStore(path.resolve(folder), prefix),
      identity: `folder:${path.resolve(folder)}:${prefix}`,
    };
  }
  if (
    config.kind === "s3" &&
    config.bucket.trim() &&
    config.accessKeyId.trim() &&
    config.secretAccessKey
  ) {
    const endpoint = config.endpoint.trim();
    if (endpoint) {
      let url: URL | null = null;
      try {
        url = new URL(endpoint);
      } catch {
        url = null;
      }
      if (!url || !/^https?:$/.test(url.protocol)) {
        throw new StorageSetupError(
          `The bucket address must start with https://, such as https://storage.googleapis.com, not "${endpoint}".`,
        );
      }
    }
    const bucket = config.bucket.trim();
    return {
      store: new S3ObjectStore({
        endpoint,
        region: config.region.trim() || (endpoint ? "auto" : "us-east-1"),
        bucket,
        accessKeyId: config.accessKeyId.trim(),
        secretAccessKey: config.secretAccessKey,
        prefix,
        pathStyle: config.pathStyle,
      }),
      identity: `s3:${endpoint || "aws"}:${bucket}:${prefix}`,
    };
  }
  return null;
}

export class AppSleep {
  private readonly records = new Map<string, SleepRecord | null>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Opened while being put to sleep: the sleep stops. */
  private readonly wanted = new Set<string>();
  /** Runtime actions going on now, per app: an app in use never sleeps. */
  private readonly active = new Map<string, number>();
  /** When anything last reached an app, in this process. */
  private readonly lastAction = new Map<string, number>();
  private cached: {
    signature: string;
    found: ReturnType<typeof storeFor> | StorageSetupError;
  } | null = null;

  constructor(private readonly deps: AppSleepDeps) {}

  /** The storage, as set now; null while it is off or not filled in. Throws StorageSetupError when the settings cannot work. */
  async storage(): Promise<{ store: ObjectStore; identity: string } | null> {
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

  /** Whether an app sleeps in storage, and where. */
  async asleep(projectId: string): Promise<SleepRecord | null> {
    if (this.records.has(projectId)) return this.records.get(projectId) ?? null;
    const stored = await this.deps.store.settings.get(recordKey(projectId));
    let record: SleepRecord | null = null;
    try {
      record = stored ? (JSON.parse(stored) as SleepRecord) : null;
    } catch {
      record = null;
    }
    this.records.set(projectId, record);
    return record;
  }

  private async locked<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const before = this.locks.get(projectId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(work);
    this.locks.set(projectId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(projectId) === next) this.locks.delete(projectId);
    }
  }

  private roots(): Record<SleepPart, string> {
    return {
      app: this.deps.workspaceDir,
      undo: path.join(this.deps.workspaceDir, ".snapshots"),
      attachments: this.deps.attachmentsDir,
    };
  }

  /** A runtime action on an app begins: counted while it runs, and the app woken first. */
  async begin(projectId: string): Promise<void> {
    if (!ID.test(projectId)) return;
    this.active.set(projectId, (this.active.get(projectId) ?? 0) + 1);
    try {
      await this.ensureAwake(projectId);
    } catch (error) {
      this.end(projectId);
      throw error;
    }
  }

  /** Some work on an app's files outside the runtime (attachments): woken first, and counted while it runs. */
  async during<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    await this.begin(projectId);
    try {
      return await work();
    } finally {
      this.end(projectId);
    }
  }

  end(projectId: string): void {
    const left = (this.active.get(projectId) ?? 1) - 1;
    if (left > 0) this.active.set(projectId, left);
    else this.active.delete(projectId);
  }

  /** Brings an app back before anything reaches it. Quick when it is awake (one look in memory). */
  async ensureAwake(projectId: string): Promise<void> {
    if (!ID.test(projectId)) return;
    this.lastAction.set(projectId, Date.now());
    if (!this.locks.has(projectId) && (await this.asleep(projectId)) === null) return;
    this.wanted.add(projectId);
    try {
      await this.locked(projectId, () => this.wake(projectId));
    } finally {
      this.wanted.delete(projectId);
    }
  }

  private async wake(projectId: string): Promise<void> {
    const record = await this.asleep(projectId);
    if (!record) return;
    const stuck = (why: string) =>
      new ZelyqError(
        "runtime_unavailable",
        `This app is asleep in ${record.where} and could not be woken: ${why}`,
      );
    let storage: { store: ObjectStore; identity: string } | null;
    try {
      storage = await this.storage();
    } catch (error) {
      throw stuck(`${(error as Error).message} (Server settings → Storage)`);
    }
    if (!storage) {
      throw new ZelyqError(
        "runtime_unavailable",
        `This app is asleep in ${record.where}, but storage is not set up on this server any more. An admin can set it up again under Server settings → Storage.`,
      );
    }
    if (record.storage && storage.identity !== record.storage) {
      throw stuck(
        `storage now points to ${storage.store.label}. Set it back to ${record.where} under Server settings → Storage to open this app.`,
      );
    }
    const started = Date.now();
    const roots = this.roots();
    const work = await fs.mkdtemp(within(this.deps.workspaceDir, `.packing.${projectId}.`));
    try {
      for (const [part, key] of Object.entries(record.keys) as [SleepPart, string][]) {
        const packed = path.join(work, `${part}.tar.gz`);
        try {
          await storage.store.getFile(key, packed);
        } catch (error) {
          throw stuck((error as Error).message);
        }
        // Unpacked beside where it goes (same disk), then put in place: what was stored wins.
        await fs.mkdir(roots[part], { recursive: true });
        const unpacked = await fs.mkdtemp(within(roots[part], `.waking.${projectId}.`));
        try {
          await run("tar", ["-xzf", packed, "-C", unpacked]);
          await mergeInto(within(unpacked, projectId), within(roots[part], projectId));
        } finally {
          await fs.rm(unpacked, { recursive: true, force: true });
        }
      }
      await this.deps.store.settings.remove(recordKey(projectId));
      this.records.set(projectId, null);
      // Woken means used: it is not put straight back to sleep.
      await this.deps.store.settings.set(`project:${projectId}:used`, new Date().toISOString());
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
    // The copy in storage is no longer needed: storage is paid by what it holds.
    await this.deleteStored(storage, record.storage, Object.values(record.keys));
    this.deps.log?.(`app ${projectId} woke from ${record.where} in ${Date.now() - started} ms`);
  }

  /**
   * Puts an idle app to sleep. `prepare` runs first, under the app's lock (clearing reinstallable
   * packages); `stillIdle` is asked again after the upload, just before anything leaves this disk.
   * Returns the record, or null when it did not sleep (no storage, nothing there, in use).
   */
  async sleep(
    projectId: string,
    options: { stillIdle: () => Promise<boolean>; prepare?: () => Promise<void> },
  ): Promise<SleepRecord | null> {
    if (!ID.test(projectId)) return null;
    const storage = await this.storage();
    if (!storage) return null;
    return await this.locked(projectId, async () => {
      if ((await this.asleep(projectId)) || this.active.has(projectId)) return null;
      const started = Date.now();
      const inUse = async () =>
        this.wanted.has(projectId) ||
        this.active.has(projectId) ||
        (this.lastAction.get(projectId) ?? 0) >= started ||
        !(await options.stillIdle());
      if (await inUse()) return null;
      await options.prepare?.();
      const roots = this.roots();
      const own = within(roots.app, projectId);
      if (!(await exists(own))) return null;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const work = await fs.mkdtemp(within(this.deps.workspaceDir, `.packing.${projectId}.`));
      const uploaded: string[] = [];
      const moved: Array<{ from: string; aside: string; names: string[] }> = [];
      let committed = false;
      try {
        const record: SleepRecord = {
          keys: {},
          bytes: {},
          stored: 0,
          at: new Date().toISOString(),
          where: storage.store.label,
          storage: storage.identity,
        };
        for (const [part, root] of Object.entries(roots) as [SleepPart, string][]) {
          const folder = within(root, projectId);
          if (part !== "app" && (await entries(folder)).length === 0) continue;
          const packed = path.join(work, `${part}.tar.gz`);
          await run("tar", ["-czf", packed, "-C", root, projectId]);
          const key = `apps/${projectId}/${stamp}/${part}.tar.gz`;
          const { bytes } = await storage.store.putFile(key, packed);
          uploaded.push(key);
          // Checked where it landed, not trusted.
          if ((await storage.store.size(key)) !== bytes)
            throw new Error(`the copy of ${part} in storage is not complete`);
          record.keys[part] = key;
          record.bytes[part] = await sizeOf(folder);
          record.stored += bytes;
        }
        if (await inUse()) return null;
        // Moved aside, same disk: one rename each, and undone if any fails.
        for (const [part, root] of Object.entries(roots) as [SleepPart, string][]) {
          if (!record.keys[part]) continue;
          const from = within(root, projectId);
          const aside = within(root, `.sleeping.${projectId}.${stamp}`);
          await fs.mkdir(aside);
          const step = { from, aside, names: [] as string[] };
          moved.push(step);
          for (const name of await entries(from)) {
            await fs.rename(path.join(from, name), path.join(aside, name));
            step.names.push(name);
          }
        }
        await this.deps.store.settings.set(recordKey(projectId), JSON.stringify(record));
        this.records.set(projectId, record);
        committed = true;
        // From here the stored copy is the app: what was moved aside goes. It is marked done
        // first (a note inside, then a new name), so if removing it fails, a later tidy removes
        // it rather than putting old files back into an app that has woken since.
        for (const { aside } of moved) {
          await fs.writeFile(path.join(aside, DONE), record.at).catch(() => undefined);
          const done = aside.replace(`${path.sep}.sleeping.`, `${path.sep}.slept.`);
          const gone = (await fs
            .rename(aside, done)
            .then(() => done)
            .catch(() => aside)) as string;
          await fs.rm(gone, { recursive: true, force: true }).catch(() => undefined);
        }
        this.deps.log?.(
          `app ${projectId} is asleep in ${storage.store.label} (${record.stored} bytes)`,
        );
        return record;
      } catch (error) {
        if (!committed) {
          for (const { from, aside, names } of moved.reverse()) {
            for (const name of names)
              await fs.rename(path.join(aside, name), path.join(from, name)).catch(() => undefined);
            await fs.rmdir(aside).catch(() => undefined);
          }
        }
        throw error;
      } finally {
        if (!committed)
          for (const key of uploaded) await storage.store.delete(key).catch(() => undefined);
        await fs.rm(work, { recursive: true, force: true });
      }
    });
  }

  /** The app is being deleted: its stored copy goes too, without waking it. Kept on a list if that fails. */
  async forget(projectId: string): Promise<void> {
    if (!ID.test(projectId)) return;
    await this.locked(projectId, async () => {
      const record = await this.asleep(projectId);
      if (!record) return;
      const storage = await this.storage().catch(() => null);
      await this.deleteStored(storage, record.storage, Object.values(record.keys));
      await this.deps.store.settings.remove(recordKey(projectId));
      this.records.set(projectId, null);
      for (const root of [this.roots().undo, this.roots().attachments]) {
        await fs.rmdir(within(root, projectId)).catch(() => undefined);
      }
    });
  }

  /** Deletes stored copies; what cannot be deleted now (storage changed or unreachable) is kept on a list and tried again. */
  private async deleteStored(
    storage: { store: ObjectStore; identity: string } | null,
    identity: string | undefined,
    keys: string[],
  ): Promise<void> {
    await this.orphansLocked(() => this.deleteStoredNow(storage, identity, keys));
  }

  /** One change to the to-delete list at a time. */
  private orphanChain: Promise<unknown> = Promise.resolve();
  private async orphansLocked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.orphanChain.catch(() => undefined).then(work);
    this.orphanChain = next;
    return await next;
  }

  private async deleteStoredNow(
    storage: { store: ObjectStore; identity: string } | null,
    identity: string | undefined,
    keys: string[],
  ): Promise<void> {
    const left: string[] = [];
    for (const key of keys) {
      if (!storage || (identity && storage.identity !== identity)) {
        left.push(key);
        continue;
      }
      await storage.store.delete(key).catch(() => left.push(key));
    }
    if (left.length === 0) return;
    const list = await this.orphans();
    list.push({ storage: identity ?? storage?.identity ?? "", keys: left });
    await this.deps.store.settings.set(ORPHANS, JSON.stringify(list));
  }

  private async orphans(): Promise<Array<{ storage: string; keys: string[] }>> {
    try {
      return JSON.parse((await this.deps.store.settings.get(ORPHANS)) ?? "[]");
    } catch {
      return [];
    }
  }

  /**
   * After a restart, and before each round of sleeping: puts back files a sleep moved aside but
   * never recorded, removes the half-done remains of a sleep or wake, and deletes stored copies
   * that could not be deleted before.
   */
  async tidy(): Promise<void> {
    for (const root of Object.values(this.roots())) {
      for (const name of await entries(root)) {
        const match = /^\.(sleeping|slept|waking|packing)\.([A-Za-z0-9_-]{1,100})\./.exec(name);
        if (!match) continue;
        const [, kind, projectId] = match as unknown as [string, string, string];
        const leftover = within(root, name);
        try {
          await this.locked(projectId, async () => {
            if (!(await exists(leftover))) return;
            // Only a sleep that never finished (no note it was done, no record) is put back.
            if (
              kind === "sleeping" &&
              !(await exists(path.join(leftover, DONE))) &&
              !(await this.asleep(projectId))
            ) {
              await mergeInto(leftover, within(root, projectId));
              this.deps.log?.(
                `app ${projectId}: files moved aside by an unfinished sleep were put back`,
              );
            }
            await fs.rm(leftover, { recursive: true, force: true });
          });
        } catch (error) {
          // One leftover that cannot be handled does not stop the rest.
          this.deps.log?.(
            `app ${projectId}: could not tidy ${leftover}: ${(error as Error).message}`,
          );
        }
      }
    }
    await this.orphansLocked(() => this.retryOrphans());
  }

  private async retryOrphans(): Promise<void> {
    const list = await this.orphans();
    if (list.length === 0) return;
    const storage = await this.storage().catch(() => null);
    const left: typeof list = [];
    for (const entry of list) {
      if (!storage || storage.identity !== entry.storage) {
        left.push(entry);
        continue;
      }
      const keys: string[] = [];
      for (const key of entry.keys) await storage.store.delete(key).catch(() => keys.push(key));
      if (keys.length) left.push({ storage: entry.storage, keys });
    }
    await this.deps.store.settings.set(ORPHANS, JSON.stringify(left));
  }
}

/**
 * A path for an app's id (or a leftover's name) under one of Zelyq's own folders, refused if it
 * would lead anywhere else. Ids are checked when they arrive; this makes sure of it where paths are made.
 */
function within(root: string, name: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, name);
  if (!full.startsWith(base + path.sep)) throw new Error(`Not a name inside ${base}: ${name}`);
  return full;
}

async function exists(file: string): Promise<boolean> {
  return await fs.lstat(file).then(
    () => true,
    () => false,
  );
}

async function entries(dir: string): Promise<string[]> {
  return await fs.readdir(dir).catch(() => [] as string[]);
}

/**
 * Puts everything under `from` into `to`, which may already exist (an app's own folder stays while
 * it sleeps). Folders are merged; for anything else, what comes from `from` wins.
 */
async function mergeInto(from: string, to: string): Promise<void> {
  if (!(await exists(from))) return;
  if (!(await exists(to))) {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    return;
  }
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = within(from, entry.name);
    const target = within(to, entry.name);
    const there = await fs.lstat(target).catch(() => null);
    if (entry.isDirectory() && there?.isDirectory()) {
      await mergeInto(source, target);
      continue;
    }
    if (there?.isDirectory()) await fs.rm(target, { recursive: true, force: true });
    await fs.rename(source, target);
  }
  await fs.rm(from, { recursive: true, force: true });
}

/** Every file's size under a folder, as the disk counts it. */
async function sizeOf(root: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(root);
  return total;
}

/**
 * The runtime, with a sleeping app woken before anything reaches its files, and every action
 * counted while it runs (an app in use never sleeps): the server's every file, command, preview
 * and undo action goes through here. Deleting an app forgets its stored copy instead of waking it.
 */
export function wakingRuntime(driver: RuntimeDriver, sleep: AppSleep): RuntimeDriver {
  return new Proxy(driver, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (property === "removeProject") {
        return async (projectId: string) => {
          await sleep.forget(projectId);
          return await target.removeProject(projectId);
        };
      }
      if (typeof property !== "string" || !APP_ACTIONS.has(property)) return value.bind(target);
      return async (projectId: string, ...rest: unknown[]) => {
        await sleep.begin(projectId);
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).call(
            target,
            projectId,
            ...rest,
          );
        } finally {
          sleep.end(projectId);
        }
      };
    },
  });
}

/** Every runtime action that reaches an app's files (types.ts), each taking the app's id first. */
const APP_ACTIONS = new Set<string>([
  "ensureProject",
  "scaffold",
  "exec",
  "listFiles",
  "readFile",
  "writeFile",
  "deleteFile",
  "startPreview",
  "createSnapshot",
  "restoreSnapshot",
  "deleteSnapshot",
  "readSnapshotFile",
  "restoreSnapshotFile",
  "archive",
] satisfies (keyof RuntimeDriver)[]);
