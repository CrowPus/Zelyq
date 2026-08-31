import { type ChildProcess, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type FileContent,
  type FileEntry,
  newId,
  type Preview,
  type Snapshot,
  ZelyqError,
} from "@zelyq/core";
import { assertRealPathInside, isIgnored, resolveInside, toPosix } from "./paths.js";
import { allocatePort, previewUrl, releasePort, waitForPort } from "./ports.js";
import type {
  ExecOptions,
  ExecResult,
  ListOptions,
  PreviewOptions,
  ProjectRuntime,
  RuntimeConfig,
  RuntimeDriver,
  RuntimeHealth,
  ScaffoldFile,
} from "./types.js";

const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;
const PREVIEW_LOG_LINES = 500;

function normalizePreviewPort(port: number | undefined): number | undefined {
  if (port === undefined) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw ZelyqError.badRequest("Invalid preview port. Expected an integer between 1 and 65535.");
  }
  return port;
}
export const PREVIEW_READY_TIMEOUT_MS = 90_000;
const MAX_READABLE_FILE_BYTES = 2 * 1024 * 1024;
/** Sibling of the project roots, so nothing here lands inside a user's project. */
const PREVIEW_STATE_DIR = ".zelyq-previews";
/** Names the snapshot a new one should try to reuse files from. */
const LATEST_SNAPSHOT = ".latest";
/** What each snapshot recorded about the originals it copied: path → [size, mtimeMs]. */
const SNAPSHOT_MANIFEST = ".manifest.json";

type SnapshotManifest = Record<string, [number, number]>;

async function readManifest(snapshotDir: string): Promise<SnapshotManifest> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(snapshotDir, SNAPSHOT_MANIFEST), "utf8"),
    ) as SnapshotManifest;
  } catch {
    // No manifest means a snapshot from before this existed; copy everything.
    return {};
  }
}

/**
 * What one Zelyq process records so the others can find a preview it started.
 *
 * Status is deliberately *not* stored. A status written to disk goes stale the
 * moment the dev server dies; liveness is cheap to derive from the pid and the
 * port, and derived state cannot lie.
 */
export interface PreviewRecord {
  pid: number;
  port: number;
  startedAt: string;
  /** Which Zelyq process spawned it. Useful when reading these by hand. */
  ownerPid: number;
  /**
   * A fingerprint of the public Supabase env the preview was
   * started with (URL + publishable key), so a re-link is detected and the
   * dev server restarted. Absent for a preview started without a linked
   * backend. Public values only; never a credential.
   */
  supabaseEnv?: string;
}

/**
 * Where a preview's on-disk state lives — a sibling of the project roots, so
 * nothing here lands inside a user's project or its bind mount.
 *
 * Free functions, parameterised by `workspaceDir`, rather than driver methods:
 * every driver that runs a preview process shares this file layout, so a
 * record one of them writes is readable by the others instead of each keeping
 * a layout of its own that can drift.
 */
export function previewStateFile(workspaceDir: string, projectId: string): string {
  return path.join(workspaceDir, PREVIEW_STATE_DIR, `${projectId}.json`);
}
export function previewLogFile(workspaceDir: string, projectId: string): string {
  return path.join(workspaceDir, PREVIEW_STATE_DIR, `${projectId}.log`);
}
export async function writePreviewRecord(
  workspaceDir: string,
  projectId: string,
  record: PreviewRecord,
): Promise<void> {
  const file = previewStateFile(workspaceDir, projectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(record));
}
export async function readPreviewRecord(
  workspaceDir: string,
  projectId: string,
): Promise<PreviewRecord | null> {
  try {
    return JSON.parse(
      await fs.readFile(previewStateFile(workspaceDir, projectId), "utf8"),
    ) as PreviewRecord;
  } catch {
    return null;
  }
}
export async function clearPreviewRecord(workspaceDir: string, projectId: string): Promise<void> {
  await fs.rm(previewStateFile(workspaceDir, projectId), { force: true }).catch(() => undefined);
}

interface PreviewProcess {
  child: ChildProcess;
  port: number;
  startedAt: string;
  logs: string[];
  status: Preview["status"];
  lastError: string | null;
  /** See `PreviewRecord.supabaseEnv`. */
  supabaseEnv: string;
}

/**
 * A stable string identifying the public Supabase config a preview runs with,
 * so a change (link, re-link, unlink) triggers a restart. Only the public URL
 * and publishable key — a credential is never in a preview env.
 */
function supabaseEnvFingerprint(env?: Record<string, string>): string {
  if (!env?.VITE_SUPABASE_URL) return "";
  return `${env.VITE_SUPABASE_URL}|${env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""}`;
}

/**
 * Runs everything on this machine: project files under `workspaceDir`, shell
 * commands as child processes, dev servers as long-lived children.
 *
 * This is the zero-setup path — no Docker, no runtime host, no network. It is
 * also the least isolated one: a command here has the permissions of the user
 * running Zelyq. See SECURITY.md for when that is and is not acceptable.
 */
export class LocalRuntimeDriver implements RuntimeDriver {
  readonly kind = "local" as const;

  private readonly workspaceDir: string;
  private readonly execTimeoutMs: number;
  private readonly portRange: [number, number];
  private readonly previewHost: string;
  /** Loopback previews bind loopback; anything else has to accept remote clients. */
  private readonly previewBindHost: string;
  /** See `RuntimeConfig.previewUrlTemplate`. */
  private readonly previewUrlTemplate: string | undefined;
  private readonly previews = new Map<string, PreviewProcess>();

  constructor(config: RuntimeConfig) {
    this.workspaceDir = path.resolve(config.workspaceDir);
    this.execTimeoutMs = config.execTimeoutMs;
    this.portRange = config.previewPortRange;
    this.previewHost = config.previewHost || "127.0.0.1";
    this.previewBindHost =
      this.previewHost === "127.0.0.1" || this.previewHost === "localhost"
        ? "127.0.0.1"
        : "0.0.0.0";
    this.previewUrlTemplate = config.previewUrlTemplate || undefined;
  }

  /** The address a browser should load a running preview at. */
  private previewUrlFor(port: number): string {
    return previewUrl(this.previewUrlTemplate, this.previewHost, port);
  }

  async health(): Promise<RuntimeHealth> {
    try {
      await fs.mkdir(this.workspaceDir, { recursive: true });
      await fs.access(this.workspaceDir);
      return {
        kind: this.kind,
        ok: true,
        detail: `workspace ${this.workspaceDir}`,
        version: process.version,
      };
    } catch (error) {
      return { kind: this.kind, ok: false, detail: (error as Error).message };
    }
  }

  async ensureProject(projectId: string): Promise<ProjectRuntime> {
    const root = this.rootFor(projectId);
    await fs.mkdir(root, { recursive: true });
    return { projectId, root };
  }

  async removeProject(projectId: string): Promise<void> {
    await this.stopPreview(projectId).catch(() => undefined);
    await fs.rm(this.rootFor(projectId), { recursive: true, force: true });
    // The preview sidecar and the snapshots both live outside the project root,
    // so deleting the root leaves them behind for a project that no longer
    // exists. Snapshots are the expensive one: a copy of the tree per turn.
    await fs.rm(this.previewLogFile(projectId), { force: true }).catch(() => undefined);
    await fs
      .rm(this.snapshotDir(projectId), { recursive: true, force: true })
      .catch(() => undefined);
  }

  async scaffold(projectId: string, files: ScaffoldFile[]): Promise<void> {
    const { root } = await this.ensureProject(projectId);
    for (const file of files) {
      const target = resolveInside(root, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, { encoding: file.encoding ?? "utf8" });
      if (file.mode !== undefined) await fs.chmod(target, file.mode);
    }
  }

  async exec(projectId: string, options: ExecOptions): Promise<ExecResult> {
    const root = await this.requireRoot(projectId);
    const cwd = options.cwd ? resolveInside(root, options.cwd) : root;

    // Deliberately not a login shell. A login shell re-sources the user's
    // profile, which commonly re-points `node` and `npm` at a different
    // version than the one running Zelyq (nvm, asdf, volta). That produced a
    // real failure: project installs silently ran on an older npm whose
    // optional-dependency handling skips platform-specific native packages.
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs =
      process.platform === "win32" ? ["/c", options.command] : ["-c", options.command];

    return await runCaptured(shell, shellArgs, {
      cwd,
      env: {
        ...process.env,
        PATH: pathWithNodeFirst(),
        ...agentCommandEnv(options.env),
      },
      timeoutMs: options.timeoutMs ?? this.execTimeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    });
  }

  async listFiles(projectId: string, options: ListOptions = {}): Promise<FileEntry[]> {
    const root = await this.requireRoot(projectId);
    const start = options.path ? resolveInside(root, options.path) : root;
    const maxDepth = options.depth ?? 8;
    const entries: FileEntry[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;
      const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const dirent of dirents.sort(compareDirents)) {
        if (!options.includeIgnored && isIgnored(dirent.name)) continue;
        const absolute = path.join(dir, dirent.name);
        const relative = toPosix(path.relative(root, absolute));

        if (dirent.isDirectory()) {
          entries.push({ path: relative, name: dirent.name, type: "directory" });
          await walk(absolute, depth + 1);
        } else if (dirent.isFile()) {
          const stat = await fs.stat(absolute).catch(() => null);
          entries.push({
            path: relative,
            name: dirent.name,
            type: "file",
            size: stat?.size ?? 0,
            modifiedAt: stat?.mtime.toISOString(),
          });
        }
      }
    };

    await walk(start, 1);
    return entries;
  }

  async readFile(projectId: string, filePath: string): Promise<FileContent> {
    const root = await this.requireRoot(projectId);
    const absolute = resolveInside(root, filePath);
    await assertRealPathInside(root, absolute);

    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) throw ZelyqError.notFound("File", filePath);
    if (stat.isDirectory()) throw ZelyqError.badRequest(`${filePath} is a directory`);

    if (stat.size > MAX_READABLE_FILE_BYTES) {
      const head = await readHead(absolute, MAX_READABLE_FILE_BYTES);
      return { path: toPosix(filePath), content: head, encoding: "utf8", truncated: true };
    }

    const buffer = await fs.readFile(absolute);
    if (isBinary(buffer)) {
      return {
        path: toPosix(filePath),
        content: buffer.toString("base64"),
        encoding: "base64",
        truncated: false,
      };
    }
    return {
      path: toPosix(filePath),
      content: buffer.toString("utf8"),
      encoding: "utf8",
      truncated: false,
    };
  }

  async writeFile(
    projectId: string,
    filePath: string,
    content: string,
    encoding: "utf8" | "base64" = "utf8",
  ): Promise<void> {
    const root = await this.requireRoot(projectId);
    const absolute = resolveInside(root, filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await assertRealPathInside(root, absolute);
    // Never write *through* a symlink at the destination, and replace
    // atomically. `lstat` catches a planted link that resolves back
    // inside the root (which `assertRealPathInside` alone would allow); the
    // temp-write + `rename` makes the swap atomic and, because `rename`
    // operates on the link entry rather than its target, also symlink-safe
    // by construction.
    const existing = await fs.lstat(absolute).catch(() => null);
    if (existing?.isSymbolicLink()) {
      throw ZelyqError.badRequest(`Refusing to write through a symlink: ${filePath}`);
    }
    const tmp = `${absolute}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await fs.writeFile(tmp, Buffer.from(content, encoding), { flag: "wx" });
      await fs.rename(tmp, absolute);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async deleteFile(projectId: string, filePath: string): Promise<void> {
    const root = await this.requireRoot(projectId);
    const absolute = resolveInside(root, filePath);
    if (absolute === path.resolve(root)) {
      throw ZelyqError.badRequest("Refusing to delete the project root");
    }
    await assertRealPathInside(root, absolute);
    await fs.rm(absolute, { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  async startPreview(projectId: string, options: PreviewOptions = {}): Promise<Preview> {
    // The caller (a preview route or the agent tool) may pass a
    // linked project's public Supabase config in `options.env`. A running
    // preview started with different values is stale: linking or re-linking a
    // backend has to actually reach the dev server, so restart when it changes.
    const wantSupabaseEnv = supabaseEnvFingerprint(options.env);

    const existing = this.previews.get(projectId);
    if (existing && existing.status !== "crashed") {
      if (existing.supabaseEnv === wantSupabaseEnv) return this.toPreview(projectId, existing);
      await this.stopPreview(projectId);
    }

    // The agent and the server each construct their own driver, so a preview
    // one of them started lives in a Map the other cannot see. Without this the
    // agent's start_preview tool spawns a dev server the UI reports as stopped,
    // and starting it from the UI spawns a second one for the same project.
    const adopted = await this.adoptPreview(projectId);
    if (adopted) {
      const record = await this.readPreviewRecord(projectId);
      const adoptedEnv = record?.supabaseEnv ?? "";
      if (adopted.status === "crashed" || adoptedEnv === wantSupabaseEnv) return adopted;
      // Stale backend config on an adopted preview: end it and start fresh.
      if (record?.pid) killPidTree(record.pid);
      await this.clearPreviewRecord(projectId);
    }

    const root = await this.requireRoot(projectId);

    // A dev server with no dependencies installed fails in a way that reads
    // like a code error, so install first and surface that separately.
    const hasModules = await fs
      .access(path.join(root, "node_modules"))
      .then(() => true)
      .catch(() => false);
    if (!hasModules) {
      const install = await this.exec(projectId, {
        // --include=dev is belt and braces alongside the NODE_ENV default in
        // exec: the dev server itself is a devDependency.
        command: "npm install --no-audit --no-fund --include=dev",
        timeoutMs: 10 * 60_000,
      });
      if (install.exitCode !== 0) {
        const preview: PreviewProcess = {
          child: null as unknown as ChildProcess,
          port: 0,
          startedAt: new Date().toISOString(),
          logs: [install.stdout, install.stderr].filter(Boolean),
          status: "crashed",
          lastError: `Dependency install failed (exit ${install.exitCode})`,
          supabaseEnv: wantSupabaseEnv,
        };
        this.previews.set(projectId, preview);
        return this.toPreview(projectId, preview);
      }
    }

    const requestedPort = normalizePreviewPort(options.port);
    const port = requestedPort ?? (await allocatePort(this.portRange));
    const command =
      options.command ?? (await this.detectDevCommand(root, port, this.previewBindHost));

    const child = spawn(
      process.platform === "win32" ? "cmd.exe" : "/bin/bash",
      process.platform === "win32" ? ["/c", command] : ["-c", command],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: pathWithNodeFirst(),
          NODE_ENV: "development",
          ...options.env,
          PORT: String(port),
          HOST: this.previewBindHost,
          NO_COLOR: "1",
          FORCE_COLOR: "0",
        },
        detached: process.platform !== "win32",
      },
    );

    const preview: PreviewProcess = {
      child,
      port,
      startedAt: new Date().toISOString(),
      logs: [],
      status: "starting",
      lastError: null,
      supabaseEnv: wantSupabaseEnv,
    };
    this.previews.set(projectId, preview);
    if (child.pid) {
      await this.writePreviewRecord(projectId, {
        pid: child.pid,
        port,
        startedAt: preview.startedAt,
        ownerPid: process.pid,
        ...(wantSupabaseEnv ? { supabaseEnv: wantSupabaseEnv } : {}),
      });
    }

    const logFile = this.previewLogFile(projectId);
    await fs.writeFile(logFile, "").catch(() => undefined);

    // A dev server announces where it is listening, and that line is the only
    // trustworthy statement of where it actually went — the config that decided
    // it may be anywhere in the project. Watching for it turns ninety seconds of
    // silence into an answer within a few.
    let elsewhere: number | null = null;
    let noticed: () => void = () => undefined;
    const wentElsewhere = new Promise<void>((resolve) => {
      noticed = resolve;
    });

    const record = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      preview.logs.push(text);
      if (preview.logs.length > PREVIEW_LOG_LINES) {
        preview.logs.splice(0, preview.logs.length - PREVIEW_LOG_LINES);
      }
      // Teed to disk so the process that did not spawn this can still read it.
      void fs.appendFile(logFile, chunk).catch(() => undefined);

      if (elsewhere === null) {
        const announced = announcedPort(text);
        if (announced !== null && announced !== port) {
          elsewhere = announced;
          noticed();
        }
      }
    };
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);

    child.on("exit", (code) => {
      // Never overwrite an explanation we already have. The first failure is
      // the one that explains the others, and "exited with code null" on top of
      // it just buries the useful sentence.
      if (preview.status !== "stopped" && preview.status !== "crashed") {
        preview.status = "crashed";
        preview.lastError = `Dev server exited with code ${code}`;
      }
      releasePort(port);
      void this.clearPreviewRecord(projectId);
    });

    const ready = await Promise.race([
      waitForPort(port, PREVIEW_READY_TIMEOUT_MS),
      // A short grace after a stray URL: something else in the output may
      // simply have mentioned a port, and our own server may still be a second
      // away. Three seconds, not ninety.
      wentElsewhere.then(() => waitForPort(port, 3_000)),
    ]);

    if (ready && preview.status === "starting") preview.status = "running";
    if (!ready && preview.status === "starting") {
      preview.status = "crashed";
      preview.lastError =
        elsewhere === null
          ? "Dev server did not start listening in time"
          : `The dev server started on port ${elsewhere}, not the ${port} Zelyq assigned it. ` +
            "That usually means the project's own config sets a fixed port.";

      // Whatever it is doing, it is not serving this preview. Left alive it
      // holds a port and keeps a live pid in the record file — which reads back
      // as a preview that is still starting, so the spinner never stops.
      killTree(child);
      releasePort(port);
      await this.clearPreviewRecord(projectId);
    }

    return this.toPreview(projectId, preview);
  }

  async stopPreview(projectId: string): Promise<Preview> {
    const preview = this.previews.get(projectId);
    if (preview) {
      preview.status = "stopped";
      if (preview.child) killTree(preview.child);
      releasePort(preview.port);
      this.previews.delete(projectId);
      await this.clearPreviewRecord(projectId);
      return stoppedPreview(projectId);
    }

    // Spawned by the other process. Both run on this machine as the same user,
    // so stopping it by process group is legitimate — and leaving it running
    // because the wrong process asked would hold the port forever.
    const record = await this.readPreviewRecord(projectId);
    if (record && isProcessAlive(record.pid)) killPidTree(record.pid);
    await this.clearPreviewRecord(projectId);
    return stoppedPreview(projectId);
  }

  async previewStatus(projectId: string): Promise<Preview> {
    const preview = this.previews.get(projectId);

    // A live entry of our own is the best answer. A dead one is not: this
    // process may hold a crashed record from a failed attempt while another
    // process has a preview running perfectly well, and reporting our corpse
    // told the user their dev server had stopped when it had not.
    if (preview && preview.status !== "crashed" && preview.status !== "stopped") {
      return this.toPreview(projectId, preview);
    }

    const adopted = await this.adoptPreview(projectId);
    if (adopted) return adopted;

    // Nothing is running anywhere, so our own record — with its error — is the
    // most useful thing we have.
    return preview ? this.toPreview(projectId, preview) : stoppedPreview(projectId);
  }

  async previewLogs(projectId: string, lines = 200): Promise<string> {
    // Our own buffer first, but only if it holds anything. An empty buffer used
    // to win over a file full of the output the user was asking for, which is
    // how "no output yet" appeared next to a dev server that had printed plenty.
    const buffered = this.previews.get(projectId)?.logs.join("") ?? "";
    const text =
      buffered.trim() !== ""
        ? buffered
        : await fs.readFile(this.previewLogFile(projectId), "utf8").catch(() => "");
    return text.split("\n").slice(-lines).join("\n");
  }

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  /**
   * Copies the project, reusing whatever has not changed since the last snapshot.
   *
   * One of these is taken before every agent turn. Copying the whole tree each
   * time was fine when a project meant a ten-file template; against a real
   * repository — a few hundred files is ordinary — it is a full copy per prompt,
   * and a disk that fills without anybody noticing.
   *
   * So an unchanged file is hard-linked from the previous snapshot instead of
   * copied. Size and modification time decide "unchanged", which is what git and
   * rsync use for the same judgement. The links point at *earlier snapshots*,
   * never at the working tree, so an ordinary write to a project file can never
   * reach back and alter a snapshot that shares its content.
   */
  async createSnapshot(projectId: string, label: string): Promise<Snapshot> {
    const root = await this.requireRoot(projectId);
    const id = newId("snapshot");
    const target = path.join(this.snapshotDir(projectId), id);
    await fs.mkdir(target, { recursive: true });

    const previous = await this.latestSnapshotPath(projectId);
    const priorManifest = previous ? await readManifest(previous) : {};
    const manifest: SnapshotManifest = {};
    const files = await this.listFiles(projectId, { depth: 32 });
    let sizeBytes = 0;
    let fileCount = 0;

    for (const entry of files) {
      if (entry.type !== "file") continue;
      const source = resolveInside(root, entry.path);
      const destination = path.join(target, entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });

      const live = await fs.stat(source).catch(() => null);
      if (live) manifest[entry.path] = [live.size, live.mtimeMs];

      // Compared against what the last snapshot recorded about the *originals*,
      // not against the copies it made. A copy's timestamp is the time of the
      // copy, and no amount of restamping round-trips a filesystem's
      // nanosecond precision, so comparing copies never finds a match.
      let reused = false;
      const prior = priorManifest[entry.path];
      if (previous && live && prior && prior[0] === live.size && prior[1] === live.mtimeMs) {
        // A hard link, so the bytes are stored once however many snapshots
        // contain them.
        reused = await fs
          .link(path.join(previous, entry.path), destination)
          .then(() => true)
          .catch(() => false);
      }
      if (!reused) await fs.copyFile(source, destination);

      sizeBytes += entry.size ?? 0;
      fileCount += 1;
    }

    await fs
      .writeFile(path.join(target, SNAPSHOT_MANIFEST), JSON.stringify(manifest))
      .catch(() => undefined);
    await fs
      .writeFile(path.join(this.snapshotDir(projectId), LATEST_SNAPSHOT), id)
      .catch(() => undefined);

    return {
      id,
      projectId,
      label,
      fileCount,
      sizeBytes,
      createdAt: new Date().toISOString(),
    };
  }

  /** The snapshot most recently taken, if it is still on disk. */
  private async latestSnapshotPath(projectId: string): Promise<string | null> {
    const dir = this.snapshotDir(projectId);
    const id = await fs.readFile(path.join(dir, LATEST_SNAPSHOT), "utf8").catch(() => "");
    if (!id.trim()) return null;
    const candidate = path.join(dir, id.trim());
    return (await fs
      .stat(candidate)
      .then((entry) => entry.isDirectory())
      .catch(() => false))
      ? candidate
      : null;
  }

  async readSnapshotFile(
    projectId: string,
    snapshotId: string,
    filePath: string,
  ): Promise<FileContent> {
    const root = path.join(this.snapshotDir(projectId), snapshotId);
    const absolute = resolveInside(root, filePath);
    await assertRealPathInside(root, absolute);

    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat || stat.isDirectory()) throw ZelyqError.notFound("File", filePath);

    const buffer = await fs.readFile(absolute);
    if (isBinary(buffer)) {
      return {
        path: toPosix(filePath),
        content: buffer.toString("base64"),
        encoding: "base64",
        truncated: false,
      };
    }
    return {
      path: toPosix(filePath),
      content: buffer.toString("utf8"),
      encoding: "utf8",
      truncated: false,
    };
  }

  async restoreSnapshot(projectId: string, snapshotId: string): Promise<void> {
    const root = await this.requireRoot(projectId);
    const source = path.join(this.snapshotDir(projectId), snapshotId);
    const exists = await fs
      .access(source)
      .then(() => true)
      .catch(() => false);
    if (!exists) throw ZelyqError.notFound("Snapshot", snapshotId);

    // Replace tracked files only. node_modules and other ignored directories
    // are expensive to copy and safe to leave in place.
    for (const entry of await this.listFiles(projectId, { depth: 32 })) {
      if (entry.type === "file") await fs.rm(resolveInside(root, entry.path), { force: true });
    }
    // The manifest is bookkeeping about the snapshot, not part of the project.
    // Copying it back would leave a stray file in the user's tree every time
    // they undid a turn.
    await fs.cp(source, root, {
      recursive: true,
      filter: (from) => path.basename(from) !== SNAPSHOT_MANIFEST,
    });
  }

  async dispose(): Promise<void> {
    for (const projectId of [...this.previews.keys()]) {
      await this.stopPreview(projectId).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private rootFor(projectId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
      throw ZelyqError.badRequest(`Unsafe project id: ${projectId}`);
    }
    return path.join(this.workspaceDir, projectId);
  }

  private async requireRoot(projectId: string): Promise<string> {
    const root = this.rootFor(projectId);
    const exists = await fs
      .access(root)
      .then(() => true)
      .catch(() => false);
    if (!exists) throw ZelyqError.notFound("Project workspace", projectId);
    return root;
  }

  private snapshotDir(projectId: string): string {
    return path.join(this.workspaceDir, ".snapshots", projectId);
  }

  /**
   * The command that starts the dev server, with the port passed the way the
   * tool in front of us actually accepts it.
   *
   * `PORT` in the environment is not enough and never was. Vite does not read
   * it. A real repository sets its port in `vite.config.ts` — often with
   * `strictPort` — and ignores anything we put in the environment. That went
   * unnoticed for months because every project previewed here came from Zelyq's
   * own template, whose config reads `process.env.PORT` because we wrote it that
   * way. The first repository somebody else wrote pinned itself to 8080 and the
   * preview waited ninety seconds for a port nothing was listening on.
   *
   * A command-line flag beats a config file, which is what a command line is
   * for.
   */
  private async detectDevCommand(root: string, port: number, host: string): Promise<string> {
    return await detectDevCommand(root, port, host);
  }

  private previewLogFile(projectId: string): string {
    return previewLogFile(this.workspaceDir, projectId);
  }

  private async writePreviewRecord(projectId: string, record: PreviewRecord): Promise<void> {
    await writePreviewRecord(this.workspaceDir, projectId, record);
  }

  private async readPreviewRecord(projectId: string): Promise<PreviewRecord | null> {
    return await readPreviewRecord(this.workspaceDir, projectId);
  }

  private async clearPreviewRecord(projectId: string): Promise<void> {
    await clearPreviewRecord(this.workspaceDir, projectId);
  }

  /**
   * Reports a preview this process did not start, if one is genuinely alive.
   *
   * Also the restart story: a record whose process is gone is swept here, so a
   * crashed or orphaned dev server stops being reported as running rather than
   * lingering until someone notices the port is held.
   */
  private async adoptPreview(projectId: string): Promise<Preview | null> {
    const record = await this.readPreviewRecord(projectId);
    if (!record) return null;

    if (!isProcessAlive(record.pid)) {
      await this.clearPreviewRecord(projectId);
      return null;
    }

    const listening = await waitForPort(record.port, 500);

    // A live process on a dead port is not a preview that is still starting,
    // once it has had long enough to start. Reporting it as "starting" forever
    // is how a spinner becomes permanent: a dev server that went to its own
    // hardcoded port stayed alive, so this kept answering "starting" and the
    // user watched it turn until they gave up.
    const age = Date.now() - new Date(record.startedAt).getTime();
    if (!listening && Number.isFinite(age) && age > PREVIEW_READY_TIMEOUT_MS) {
      return {
        projectId,
        status: "crashed",
        url: null,
        port: record.port,
        pid: record.pid,
        startedAt: record.startedAt,
        lastError: `The dev server is running but nothing is listening on port ${record.port}.`,
      };
    }

    return {
      projectId,
      status: listening ? "running" : "starting",
      url: listening ? this.previewUrlFor(record.port) : null,
      port: record.port,
      pid: record.pid,
      startedAt: record.startedAt,
      lastError: null,
    };
  }

  private toPreview(projectId: string, preview: PreviewProcess): Preview {
    return {
      projectId,
      status: preview.status,
      url: preview.status === "running" && preview.port ? this.previewUrlFor(preview.port) : null,
      port: preview.port || null,
      pid: preview.child?.pid ?? null,
      startedAt: preview.startedAt,
      lastError: preview.lastError,
    };
  }
}

/**
 * The port a dev server says it is listening on, read from its own output.
 *
 * Vite, Next, react-scripts and serve all print a URL as they come up. That line
 * is the only reliable statement of where the server actually is, and it was
 * sitting in the log file the whole time a user was being told "did not start
 * listening in time".
 */
/**
 * The environment every agent command runs with, wherever it runs.
 *
 * Each line here was a real failure once, so both the local driver and the
 * container driver take it from the same place rather than keeping two copies
 * that drift.
 */
export function agentCommandEnv(extra?: Record<string, string>): Record<string, string> {
  return {
    // Projects are development workloads even when Zelyq itself runs in
    // production. Inheriting NODE_ENV=production makes `npm install` silently
    // skip devDependencies, so the dev server is never installed and every
    // preview fails with "vite: not found".
    NODE_ENV: "development",
    ...extra,
    // Keep tool output parseable: no spinners, no colour codes, no pagers.
    CI: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    TERM: "dumb",
    PAGER: "cat",
  };
}

export interface CapturedRun {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

/**
 * Spawn a process, capture bounded output, and never reject.
 *
 * Shared by the local driver, which spawns a shell, and the container driver,
 * which spawns `docker exec`. The capture rules — a byte ceiling, a timeout
 * that kills the whole process group, exit 124 for a timeout and 127 for a
 * process that could not start — are contract, not detail: the agent reads
 * these values and decides what to do next.
 */
export function runCaptured(
  command: string,
  args: string[],
  options: CapturedRun,
): Promise<ExecResult> {
  const startedAt = Date.now();
  const maxBytes = options.maxOutputBytes;

  return new Promise<ExecResult>((resolve) => {
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
      // Own process group, so a timeout kills the whole tree rather than
      // leaving orphaned grandchildren holding ports.
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const append = (target: "out" | "err", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (target === "out") {
        if (stdout.length + text.length > maxBytes) {
          stdout = (stdout + text).slice(0, maxBytes);
          truncated = true;
        } else stdout += text;
      } else {
        if (stderr.length + text.length > maxBytes) {
          stderr = (stderr + text).slice(0, maxBytes);
          truncated = true;
        } else stderr += text;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => append("out", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("err", chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: stderr + String(error),
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 0),
        stdout,
        stderr: timedOut ? `${stderr}\n[timed out after ${options.timeoutMs}ms]` : stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        truncated,
      });
    });
  });
}

/**
 * The command to start a project's dev server, and the port/host flags to make
 * it listen where it was told to.
 *
 * No `this` dependency — shared as a free function so the container driver can
 * detect the same command without going through a `LocalRuntimeDriver`.
 */
export async function detectDevCommand(root: string, port: number, host: string): Promise<string> {
  let manifest: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null = null;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  } catch {
    // No package.json — fall through to a static server.
  }

  const script = manifest?.scripts?.dev ? "dev" : manifest?.scripts?.start ? "start" : null;
  if (!script) return `npx --yes serve -l ${port} .`;

  const body = manifest?.scripts?.[script] ?? "";
  const deps = { ...manifest?.dependencies, ...manifest?.devDependencies };
  const runner = script === "dev" ? "npm run dev" : "npm start";

  // --strictPort is deliberate. The port was allocated free, so a refusal
  // means something is genuinely wrong and should be said out loud rather
  // than drifted around onto a port nobody is watching.
  if (/\bvite\b/.test(body) || "vite" in deps) {
    return `${runner} -- --port ${port} --host ${host} --strictPort`;
  }
  if (/\bnext\b/.test(body) || "next" in deps) {
    return `${runner} -- --port ${port} --hostname ${host}`;
  }

  // Expo (managed) serves web through Metro on the dev-server port since
  // SDK 50 — one port, iframe-able like any other preview. It takes `--port`;
  // it has no equivalent of Vite's `--host <addr>` / `--strictPort` (its
  // `--host` picks lan/tunnel/localhost, not an address), so binding is left
  // to the PORT/HOST env `startPreview` already sets. The template's own
  // `dev` script carries `CI=1` so Expo does not prompt.
  if (/\bexpo\b/.test(body) || "expo" in deps) {
    return `${runner} -- --port ${port}`;
  }

  // react-scripts and anything unrecognised: PORT and HOST in the environment,
  // as before. This list is not exhaustive and is not pretending to be — if a
  // tool lands somewhere else, startPreview reads the port out of its own
  // output and says so, which is what makes an incomplete list safe.
  return runner;
}

export function announcedPort(text: string): number | null {
  const match = text.match(/https?:\/\/[^\s/]+:(\d{2,5})\b/);
  if (!match?.[1]) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
}

export function stoppedPreview(projectId: string): Preview {
  return {
    projectId,
    status: "stopped",
    url: null,
    port: null,
    pid: null,
    startedAt: null,
    lastError: null,
  };
}

function compareDirents(
  a: { name: string; isDirectory(): boolean },
  b: { name: string; isDirectory(): boolean },
): number {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Killing the process group matters: `npm run dev` spawns the real dev server
 * as a grandchild, and killing only npm leaves the port held forever.
 */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    killPidTree(child.pid);
  } catch {
    child.kill("SIGKILL");
  }
}

export function killPidTree(pid: number): void {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  process.kill(-pid, "SIGTERM");
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, 3000).unref();
}

/** Signal 0 tests for existence without delivering anything. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

async function readHead(absolute: string, bytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of createReadStream(absolute, { end: bytes })) {
    chunks.push(chunk as Buffer);
    total += (chunk as Buffer).length;
    if (total >= bytes) break;
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Puts the Node that is running Zelyq first on the PATH, so `node`, `npm`, and
 * `npx` inside a project are the same versions the server itself runs on rather
 * than whatever a system package manager installed years ago.
 */
function pathWithNodeFirst(): string {
  const nodeDir = path.dirname(process.execPath);
  const current = process.env.PATH ?? "";
  if (current.split(path.delimiter).includes(nodeDir)) return current;
  return current ? `${nodeDir}${path.delimiter}${current}` : nodeDir;
}

/** Default workspace location when none is configured. */
export function defaultWorkspaceDir(): string {
  return path.join(os.homedir(), ".zelyq", "workspace");
}
