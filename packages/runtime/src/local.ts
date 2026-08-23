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
import { allocatePort, releasePort, waitForPort } from "./ports.js";
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
const PREVIEW_READY_TIMEOUT_MS = 90_000;
const MAX_READABLE_FILE_BYTES = 2 * 1024 * 1024;
/** Sibling of the project roots, so nothing here lands inside a user's project. */
const PREVIEW_STATE_DIR = ".zelyq-previews";

/**
 * What one Zelyq process records so the others can find a preview it started.
 *
 * Status is deliberately *not* stored. A status written to disk goes stale the
 * moment the dev server dies; liveness is cheap to derive from the pid and the
 * port, and derived state cannot lie.
 */
interface PreviewRecord {
  pid: number;
  port: number;
  startedAt: string;
  /** Which Zelyq process spawned it. Useful when reading these by hand. */
  ownerPid: number;
}

interface PreviewProcess {
  child: ChildProcess;
  port: number;
  startedAt: string;
  logs: string[];
  status: Preview["status"];
  lastError: string | null;
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
    // The preview sidecar lives outside the project root, so deleting the root
    // would otherwise leave its log behind for a project that no longer exists.
    await fs.rm(this.previewLogFile(projectId), { force: true }).catch(() => undefined);
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
    const timeoutMs = options.timeoutMs ?? this.execTimeoutMs;
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const startedAt = Date.now();

    return await new Promise<ExecResult>((resolve) => {
      const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
      // Deliberately not a login shell. A login shell re-sources the user's
      // profile, which commonly re-points `node` and `npm` at a different
      // version than the one running Zelyq (nvm, asdf, volta). That produced a
      // real failure: project installs silently ran on an older npm whose
      // optional-dependency handling skips platform-specific native packages.
      const shellArgs =
        process.platform === "win32" ? ["/c", options.command] : ["-c", options.command];

      const child = spawn(shell, shellArgs, {
        cwd,
        env: {
          ...process.env,
          PATH: pathWithNodeFirst(),
          // Projects are development workloads even when Zelyq itself runs in
          // production. Inheriting NODE_ENV=production makes `npm install`
          // silently skip devDependencies, so the dev server is never installed
          // and every preview fails with "vite: not found".
          NODE_ENV: "development",
          ...options.env,
          // Keep tool output parseable: no spinners, no colour codes, no pagers.
          CI: "1",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          TERM: "dumb",
          PAGER: "cat",
        },
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
      }, timeoutMs);

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
          stderr: timedOut ? `${stderr}\n[timed out after ${timeoutMs}ms]` : stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
          truncated,
        });
      });
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
    await fs.writeFile(absolute, Buffer.from(content, encoding));
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
    const existing = this.previews.get(projectId);
    if (existing && existing.status !== "crashed") return this.toPreview(projectId, existing);

    // The agent and the server each construct their own driver, so a preview
    // one of them started lives in a Map the other cannot see. Without this the
    // agent's start_preview tool spawns a dev server the UI reports as stopped,
    // and starting it from the UI spawns a second one for the same project.
    const adopted = await this.adoptPreview(projectId);
    if (adopted) return adopted;

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
        };
        this.previews.set(projectId, preview);
        return this.toPreview(projectId, preview);
      }
    }

    const port = options.port ?? (await allocatePort(this.portRange));
    const command = options.command ?? (await this.detectDevCommand(root));

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
    };
    this.previews.set(projectId, preview);
    if (child.pid) {
      await this.writePreviewRecord(projectId, {
        pid: child.pid,
        port,
        startedAt: preview.startedAt,
        ownerPid: process.pid,
      });
    }

    const logFile = this.previewLogFile(projectId);
    await fs.writeFile(logFile, "").catch(() => undefined);

    const record = (chunk: Buffer) => {
      preview.logs.push(chunk.toString("utf8"));
      if (preview.logs.length > PREVIEW_LOG_LINES) {
        preview.logs.splice(0, preview.logs.length - PREVIEW_LOG_LINES);
      }
      // Teed to disk so the process that did not spawn this can still read it.
      void fs.appendFile(logFile, chunk).catch(() => undefined);
    };
    child.stdout?.on("data", record);
    child.stderr?.on("data", record);

    child.on("exit", (code) => {
      if (preview.status !== "stopped") {
        preview.status = "crashed";
        preview.lastError = `Dev server exited with code ${code}`;
      }
      releasePort(port);
      void this.clearPreviewRecord(projectId);
    });

    const ready = await waitForPort(port, PREVIEW_READY_TIMEOUT_MS);
    if (ready && preview.status === "starting") preview.status = "running";
    if (!ready && preview.status === "starting") {
      preview.status = "crashed";
      preview.lastError = "Dev server did not start listening in time";
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

  async createSnapshot(projectId: string, label: string): Promise<Snapshot> {
    const root = await this.requireRoot(projectId);
    const id = newId("snapshot");
    const target = path.join(this.snapshotDir(projectId), id);
    await fs.mkdir(target, { recursive: true });

    const files = await this.listFiles(projectId, { depth: 32 });
    let sizeBytes = 0;
    let fileCount = 0;

    for (const entry of files) {
      if (entry.type !== "file") continue;
      const source = resolveInside(root, entry.path);
      const destination = path.join(target, entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
      sizeBytes += entry.size ?? 0;
      fileCount += 1;
    }

    return {
      id,
      projectId,
      label,
      fileCount,
      sizeBytes,
      createdAt: new Date().toISOString(),
    };
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
    await fs.cp(source, root, { recursive: true });
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

  private async detectDevCommand(root: string): Promise<string> {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
      if (manifest?.scripts?.dev) return "npm run dev";
      if (manifest?.scripts?.start) return "npm start";
    } catch {
      // No package.json — fall through to a static server.
    }
    return "npx --yes serve -l $PORT .";
  }

  private previewStateFile(projectId: string): string {
    return path.join(this.workspaceDir, PREVIEW_STATE_DIR, `${projectId}.json`);
  }

  private previewLogFile(projectId: string): string {
    return path.join(this.workspaceDir, PREVIEW_STATE_DIR, `${projectId}.log`);
  }

  private async writePreviewRecord(projectId: string, record: PreviewRecord): Promise<void> {
    const file = this.previewStateFile(projectId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(record));
  }

  private async readPreviewRecord(projectId: string): Promise<PreviewRecord | null> {
    try {
      return JSON.parse(
        await fs.readFile(this.previewStateFile(projectId), "utf8"),
      ) as PreviewRecord;
    } catch {
      return null;
    }
  }

  private async clearPreviewRecord(projectId: string): Promise<void> {
    await fs.rm(this.previewStateFile(projectId), { force: true }).catch(() => undefined);
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
    return {
      projectId,
      status: listening ? "running" : "starting",
      url: listening ? `http://${this.previewHost}:${record.port}` : null,
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
      url: preview.status === "running" ? `http://${this.previewHost}:${preview.port}` : null,
      port: preview.port || null,
      pid: preview.child?.pid ?? null,
      startedAt: preview.startedAt,
      lastError: preview.lastError,
    };
  }
}

function stoppedPreview(projectId: string): Preview {
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
function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    killPidTree(child.pid);
  } catch {
    child.kill("SIGKILL");
  }
}

function killPidTree(pid: number): void {
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
function isProcessAlive(pid: number): boolean {
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
