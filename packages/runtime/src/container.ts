import type { FileContent, FileEntry, Preview, Snapshot } from "@zelyq/core";
import { ZelyqError } from "@zelyq/core";
import { agentCommandEnv, LocalRuntimeDriver, runCaptured } from "./local.js";
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

/**
 * Agent commands run inside a container, one per project.
 *
 * Zelyq runs code a language model wrote. Until now that code ran as the
 * server's own user — `SECURITY.md` says so plainly — which is why the product
 * has only ever been safe for one trusted developer on one machine.
 *
 * **The container is an execution jail, not a storage layer.** Of the twenty
 * methods on `RuntimeDriver`, exactly two spawn a process. The rest read and
 * write files under the project root, and they keep doing that on the host,
 * directly and unchanged, against a directory the container has bind-mounted.
 * Reimplementing the filesystem across a container boundary would have been
 * weeks of work and a new class of bug for no benefit.
 *
 * Composition rather than inheritance, which is a change from what `023`
 * proposed. Reading the code showed inheritance would need six private fields
 * made protected and a `readonly kind` widened on the base class, to save a
 * dozen one-line delegations. The delegations are also honest: what is
 * isolated, and what is not, is visible in this file rather than implied by
 * what a subclass forgot to override.
 *
 * ## What this does not do yet
 *
 * **Egress is not filtered.** A container on the default bridge can still reach
 * the network the host sits on, including the cloud metadata endpoint that
 * hands out instance credentials on most providers. That is the third step of
 * `023` and nothing here should be described as a completed sandbox until it
 * lands.
 *
 * **The preview still runs on the host.** `startPreview` is delegated
 * unchanged, so `npm run dev` — which executes project code — is not yet
 * jailed. That is step two. Until then this driver narrows the blast radius of
 * agent shell commands and nothing more.
 */

const DEFAULT_IMAGE = "node:22-bookworm-slim";
const DEFAULT_MEMORY = "2g";
const DEFAULT_CPUS = "2";
const DEFAULT_PIDS = 512;
/** Long enough for `docker run` to pull on a cold cache. */
const ENGINE_TIMEOUT_MS = 300_000;

export interface ContainerOptions {
  image?: string;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
  /** The `docker` binary, or a drop-in such as `podman`. */
  engine?: string;
}

export class ContainerRuntimeDriver implements RuntimeDriver {
  readonly kind = "container" as const;

  private readonly local: LocalRuntimeDriver;
  private readonly image: string;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly pidsLimit: number;
  private readonly engine: string;
  private readonly execTimeoutMs: number;
  /** Projects whose container this process has already started. */
  private readonly started = new Set<string>();

  constructor(config: RuntimeConfig, options: ContainerOptions = {}) {
    this.local = new LocalRuntimeDriver(config);
    this.execTimeoutMs = config.execTimeoutMs;
    this.image = options.image ?? DEFAULT_IMAGE;
    this.memory = options.memory ?? DEFAULT_MEMORY;
    this.cpus = options.cpus ?? DEFAULT_CPUS;
    this.pidsLimit = options.pidsLimit ?? DEFAULT_PIDS;
    this.engine = options.engine ?? "docker";
  }

  async health(): Promise<RuntimeHealth> {
    const local = await this.local.health();
    if (!local.ok) return { ...local, kind: this.kind };

    const probe = await this.engineRun(["version", "--format", "{{.Server.Version}}"], 10_000);
    if (probe.exitCode !== 0) {
      return {
        kind: this.kind,
        ok: false,
        detail:
          `${this.engine} is not usable: ${firstLine(probe.stderr) || firstLine(probe.stdout)}. ` +
          "Agent commands cannot run without a container engine.",
      };
    }
    return {
      kind: this.kind,
      ok: true,
      detail: `${local.detail} · ${this.engine} ${firstLine(probe.stdout)} · image ${this.image}`,
      version: process.version,
    };
  }

  /**
   * A command inside the project's container.
   *
   * The environment comes from `agentCommandEnv`, the same source the local
   * driver uses, so the two cannot drift. `PATH` is deliberately *not* carried
   * over from the host — the container has its own node, and pointing at the
   * host's would name paths that do not exist inside it.
   */
  async exec(projectId: string, options: ExecOptions): Promise<ExecResult> {
    const { root } = await this.local.ensureProject(projectId);
    await this.ensureContainer(projectId, root);

    // Refused rather than resolved on the host: a `cwd` that escaped the
    // project would be silently created inside the container, which reads as
    // an empty directory rather than as the error it is.
    const cwd = containerCwd(options.cwd);
    const env = agentCommandEnv(options.env);

    const args = ["exec", "--workdir", cwd];
    for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
    args.push(containerName(projectId), "/bin/bash", "-c", options.command);

    return await runCaptured(this.engine, args, {
      timeoutMs: options.timeoutMs ?? this.execTimeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? 200_000,
    });
  }

  async removeProject(projectId: string): Promise<void> {
    await this.destroyContainer(projectId);
    await this.local.removeProject(projectId);
  }

  async dispose(): Promise<void> {
    // Sequential on purpose: a machine with many projects should not be asked
    // to tear down fifty containers at once while it is already shutting down.
    for (const projectId of [...this.started]) {
      await this.destroyContainer(projectId).catch(() => undefined);
    }
    await this.local.dispose();
  }

  // -------------------------------------------------------------------------
  // Delegated to the host, unchanged. These read and write files under the
  // project root — the same directory the container has mounted — so there is
  // nothing to gain by routing them through it.
  // -------------------------------------------------------------------------

  ensureProject(projectId: string): Promise<ProjectRuntime> {
    return this.local.ensureProject(projectId);
  }
  scaffold(projectId: string, files: ScaffoldFile[]): Promise<void> {
    return this.local.scaffold(projectId, files);
  }
  listFiles(projectId: string, options?: ListOptions): Promise<FileEntry[]> {
    return this.local.listFiles(projectId, options);
  }
  readFile(projectId: string, path: string): Promise<FileContent> {
    return this.local.readFile(projectId, path);
  }
  writeFile(
    projectId: string,
    path: string,
    content: string,
    encoding?: "utf8" | "base64",
  ): Promise<void> {
    return this.local.writeFile(projectId, path, content, encoding);
  }
  deleteFile(projectId: string, path: string): Promise<void> {
    return this.local.deleteFile(projectId, path);
  }
  createSnapshot(projectId: string, label: string): Promise<Snapshot> {
    return this.local.createSnapshot(projectId, label);
  }
  restoreSnapshot(projectId: string, snapshotId: string): Promise<void> {
    return this.local.restoreSnapshot(projectId, snapshotId);
  }
  readSnapshotFile(projectId: string, snapshotId: string, path: string): Promise<FileContent> {
    return this.local.readSnapshotFile(projectId, snapshotId, path);
  }

  /**
   * Still the host's, and therefore still unjailed. Step two of `023` moves the
   * dev server inside; until it does, this is delegated rather than quietly
   * reimplemented, so the gap is visible here instead of being discovered.
   */
  startPreview(projectId: string, options?: PreviewOptions): Promise<Preview> {
    return this.local.startPreview(projectId, options);
  }
  stopPreview(projectId: string): Promise<Preview> {
    return this.local.stopPreview(projectId);
  }
  previewStatus(projectId: string): Promise<Preview> {
    return this.local.previewStatus(projectId);
  }
  previewLogs(projectId: string, lines?: number): Promise<string> {
    return this.local.previewLogs(projectId, lines);
  }

  // -------------------------------------------------------------------------

  /** Idempotent: adopts a container left behind by a previous process. */
  private async ensureContainer(projectId: string, root: string): Promise<void> {
    if (this.started.has(projectId)) return;

    const name = containerName(projectId);
    const running = await this.engineRun(
      ["inspect", "--format", "{{.State.Running}}", name],
      10_000,
    );
    if (running.exitCode === 0 && running.stdout.trim() === "true") {
      this.started.add(projectId);
      return;
    }
    // Present but stopped — a machine that rebooted, or a previous crash.
    if (running.exitCode === 0) await this.engineRun(["rm", "-f", name], 30_000);

    const created = await this.engineRun(this.runArgs(name, root), ENGINE_TIMEOUT_MS);
    if (created.exitCode !== 0) {
      throw new ZelyqError(
        "runtime_unavailable",
        `Could not start a container for this project: ${
          firstLine(created.stderr) || firstLine(created.stdout) || "unknown error"
        }`,
      );
    }
    this.started.add(projectId);
  }

  /**
   * Every flag here is a decision, and the first one is the one that breaks.
   */
  private runArgs(name: string, root: string): string[] {
    return [
      "run",
      "--detach",
      "--name",
      name,
      // Files the agent writes must be owned by the user Zelyq runs as. Without
      // this they come out root-owned on the host and Zelyq can no longer read
      // its own workspace — the single most common way this design fails.
      "--user",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      // The project, and nothing else on the host.
      "--volume",
      `${root}:/workspace`,
      "--workdir",
      "/workspace",
      // A runaway build cannot take the machine with it.
      "--memory",
      this.memory,
      "--cpus",
      this.cpus,
      "--pids-limit",
      String(this.pidsLimit),
      // No route from "runs a command" to "is root on the host".
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      // Nothing outside the project survives the container.
      "--read-only",
      "--tmpfs",
      "/tmp:exec,mode=1777,size=512m",
      // A read-only root filesystem still has to leave npm somewhere to write.
      // Both must be under the tmpfs; pointing them at the project would put
      // the package cache in the user's repository.
      "--env",
      "HOME=/tmp",
      "--env",
      "npm_config_cache=/tmp/.npm",
      this.image,
      // Something that stays up so `exec` has a container to enter. `sleep
      // infinity` is a bash builtin loop here, not a binary, so it survives an
      // image without coreutils.
      "/bin/bash",
      "-c",
      "while true; do sleep 3600; done",
    ];
  }

  private async destroyContainer(projectId: string): Promise<void> {
    this.started.delete(projectId);
    await this.engineRun(["rm", "-f", containerName(projectId)], 60_000);
  }

  private engineRun(args: string[], timeoutMs: number): Promise<ExecResult> {
    return runCaptured(this.engine, args, { timeoutMs, maxOutputBytes: 20_000 });
  }
}

/**
 * Project ids are `prj_` plus hex, so this is already safe for a container
 * name. Sanitised anyway: a name is passed to the engine as an argument, and a
 * rule that holds today because of a format decision elsewhere is not a rule.
 */
export function containerName(projectId: string): string {
  return `zelyq-${projectId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
}

/**
 * A working directory inside the container.
 *
 * The path is resolved against `/workspace`, and anything that climbs out of it
 * is refused rather than clamped. Clamping would silently run the command
 * somewhere the caller did not ask for, and the caller is a language model.
 */
export function containerCwd(cwd?: string): string {
  if (!cwd || cwd === "." || cwd === "./") return "/workspace";
  const parts: string[] = [];
  for (const segment of cwd.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) throw ZelyqError.badRequest(`Path escapes the project: ${cwd}`);
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (cwd.startsWith("/")) throw ZelyqError.badRequest(`Path must be relative: ${cwd}`);
  return parts.length ? `/workspace/${parts.join("/")}` : "/workspace";
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}
