import type { FileContent, FileEntry, Preview, Snapshot } from "@zelyq/core";

/**
 * The single boundary between Zelyq and anything that touches a disk or spawns
 * a process.
 *
 * Every agent tool, every file API, and every preview goes through this
 * interface. That is what makes "runs locally, runs in the cloud" a
 * configuration choice instead of a fork: `local` implements it with
 * `child_process` and `fs`; `remote` implements it as HTTP calls to a runtime
 * host that does the same thing inside an isolated container.
 *
 * Implementations must guarantee:
 *   - every `path` is interpreted relative to the project root, and any path
 *     escaping that root is rejected rather than clamped;
 *   - `exec` always terminates, honouring `timeoutMs`;
 *   - operations on an unknown project throw `ZelyqError("not_found")`.
 */
export interface RuntimeDriver {
  readonly kind: RuntimeKind;

  /** Reachability and capability probe. Cheap enough to call on a health endpoint. */
  health(): Promise<RuntimeHealth>;

  /** Create the project root if absent and return where it lives. Idempotent. */
  ensureProject(projectId: string): Promise<ProjectRuntime>;

  /** Delete the project root and stop anything running for it. Idempotent. */
  removeProject(projectId: string): Promise<void>;

  /** Write a set of files in one call — used to lay down a template. */
  scaffold(projectId: string, files: ScaffoldFile[]): Promise<void>;

  exec(projectId: string, options: ExecOptions): Promise<ExecResult>;

  listFiles(projectId: string, options?: ListOptions): Promise<FileEntry[]>;
  readFile(projectId: string, path: string): Promise<FileContent>;
  writeFile(
    projectId: string,
    path: string,
    content: string,
    encoding?: "utf8" | "base64",
  ): Promise<void>;
  deleteFile(projectId: string, path: string): Promise<void>;

  startPreview(projectId: string, options?: PreviewOptions): Promise<Preview>;
  stopPreview(projectId: string): Promise<Preview>;
  previewStatus(projectId: string): Promise<Preview>;
  previewLogs(projectId: string, lines?: number): Promise<string>;

  createSnapshot(projectId: string, label: string): Promise<Snapshot>;
  restoreSnapshot(projectId: string, snapshotId: string): Promise<void>;
  /**
   * One file as it stood at a snapshot, for showing what a turn changed.
   * Throws `ZelyqError("not_found")` when the snapshot did not contain it —
   * which is how a file the turn *created* is recognised.
   */
  readSnapshotFile(projectId: string, snapshotId: string, path: string): Promise<FileContent>;

  /** Release timers, child processes, and sockets. Called on shutdown. */
  dispose(): Promise<void>;
}

export type RuntimeKind = "local" | "remote";

export interface RuntimeHealth {
  kind: RuntimeKind;
  ok: boolean;
  /** Human-readable detail for the health endpoint; never include secrets. */
  detail?: string;
  version?: string;
}

export interface ProjectRuntime {
  projectId: string;
  /** Absolute path for `local`; an opaque handle for `remote`. */
  root: string;
}

export interface ScaffoldFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
  /** Unix mode, e.g. 0o755 for scripts. Ignored where the target cannot honour it. */
  mode?: number;
}

export interface ExecOptions {
  command: string;
  /** Relative to the project root. Defaults to the root itself. */
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Bytes of combined stdout+stderr to keep. Output beyond this is truncated. */
  maxOutputBytes?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface ListOptions {
  /** Subdirectory to list, relative to the project root. */
  path?: string;
  /** How many levels deep to walk. 1 = immediate children. */
  depth?: number;
  /** Include entries normally hidden from the file tree (node_modules, .git, …). */
  includeIgnored?: boolean;
}

export interface PreviewOptions {
  /** Overrides the template's dev command. */
  command?: string;
  /** Ask for a specific port instead of one from the configured range. */
  port?: number;
  env?: Record<string, string>;
}

export interface RuntimeConfig {
  kind: RuntimeKind;
  /** Local: directory holding every project root. */
  workspaceDir: string;
  /** Remote: base URL of the runtime host. */
  url?: string;
  /** Remote: bearer token for the runtime host. */
  token?: string;
  execTimeoutMs: number;
  previewPortRange: [number, number];
  /**
   * Host used in preview URLs, and what project dev servers bind to.
   *
   * Defaults to loopback, which is right when the browser runs on the same
   * machine. Set it to a reachable address when Zelyq runs on a VM or a
   * container host, or previews will be advertised at an address the viewer's
   * browser cannot reach.
   */
  previewHost: string;
}
