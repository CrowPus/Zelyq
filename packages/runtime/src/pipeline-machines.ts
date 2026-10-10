import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import type { Readable } from "node:stream";
import { ZelyqError } from "@zelyq/core";

/**
 * Where a pipeline's steps run when they do not run over SSH: the server's
 * own "local" runner. The pipeline engine treats this exactly like an SSH
 * machine — it hands over a command and a stdin, and gets output and an exit
 * code back — so every step script is the same on both.
 *
 * Two kinds:
 *
 * - **container** (the default): a fresh container per run, removed when the
 *   run ends. Nothing on the server is mounted into it; an app's files reach
 *   it through stdin. It shares the projects' network so the same egress
 *   rules — including the cloud-metadata block — apply.
 * - **host**: straight on the server, as the user Zelyq runs as. Only for an
 *   instance whose admin turned it on, on a machine they trust with it.
 */

export interface PipelineExecOptions {
  stdin?: string | Buffer | Readable;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  signal?: AbortSignal;
}

export interface PipelineMachine {
  os: "linux" | "macos" | "windows";
  /** The run's folder on that machine. */
  workspace: string;
  exec(command: string, options?: PipelineExecOptions): Promise<{ code: number | null }>;
  close(): Promise<void>;
}

/** Projects' network — see `container.ts`; its firewall rules cover this too. */
const PROJECT_NETWORK = "zelyq-projects";
const RUN_LABEL = "zelyq.pipeline-run";

function pipe(child: ChildProcess, options: PipelineExecOptions): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const onAbort = () => child.kill("SIGKILL");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk));
    child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk));
    child.on("error", (error) => {
      options.onStderr?.(Buffer.from(`${error.message}\n`));
    });
    child.on("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code });
    });
    const input = options.stdin;
    child.stdin?.on("error", () => undefined);
    if (input === undefined) child.stdin?.end();
    else if (typeof input === "string" || Buffer.isBuffer(input)) child.stdin?.end(input);
    else if (child.stdin) input.pipe(child.stdin);
  });
}

function capture(
  command: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, out: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** Whether a container engine answers on this server. */
export async function containerEngineAvailable(engine = "docker"): Promise<boolean> {
  return (await capture(engine, ["version", "--format", "{{.Server.Version}}"], 10_000)).code === 0;
}

export interface PipelineContainerOptions {
  runId: string;
  image: string;
  engine?: string;
  memory?: string;
  cpus?: string;
}

/** A fresh container for one run. */
export async function startPipelineContainer(
  options: PipelineContainerOptions,
): Promise<PipelineMachine> {
  const engine = options.engine ?? "docker";
  const name = `zelyq-run-${options.runId.replace(/[^A-Za-z0-9_-]/g, "").slice(-24)}`;
  const network =
    (await capture(engine, ["network", "inspect", PROJECT_NETWORK], 10_000)).code === 0;
  const started = await capture(
    engine,
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--label",
      `${RUN_LABEL}=${options.runId}`,
      "--init",
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "NET_RAW",
      "--pids-limit",
      "4096",
      "--memory",
      options.memory ?? "4g",
      "--cpus",
      options.cpus ?? "2",
      ...(network ? ["--network", PROJECT_NETWORK] : []),
      "--entrypoint",
      "tail",
      options.image,
      "-f",
      "/dev/null",
    ],
    // A first run pulls the image.
    600_000,
  );
  if (started.code !== 0) {
    throw new ZelyqError(
      "runtime_unavailable",
      `The local runner could not start a container from ${options.image}: ${started.out.trim().split("\n").pop()}`,
    );
  }
  return {
    os: "linux",
    workspace: "/zelyq/run",
    exec: (command, execOptions = {}) =>
      pipe(
        spawn(engine, ["exec", "-i", name, "sh", "-c", command], {
          stdio: ["pipe", "pipe", "pipe"],
        }),
        execOptions,
      ),
    close: async () => {
      await capture(engine, ["rm", "-f", name], 60_000);
    },
  };
}

/** Removes run containers a previous server process left behind. */
export async function removeStalePipelineContainers(engine = "docker"): Promise<number> {
  const listed = await capture(engine, ["ps", "-aq", "--filter", `label=${RUN_LABEL}`], 15_000);
  if (listed.code !== 0) return 0;
  const ids = listed.out.split(/\s+/).filter(Boolean);
  if (ids.length > 0) await capture(engine, ["rm", "-f", ...ids], 60_000);
  return ids.length;
}

/**
 * Runs on the server itself. Each command gets its own process group, so the
 * stop command a step records can end everything it started.
 */
export async function hostPipelineMachine(workspace: string): Promise<PipelineMachine> {
  await fs.mkdir(workspace, { recursive: true });
  const platform = os.platform();
  return {
    os: platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux",
    workspace,
    exec: (command, execOptions = {}) =>
      pipe(
        spawn(command, {
          shell: true,
          cwd: workspace,
          detached: platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        }),
        execOptions,
      ),
    close: async () => undefined,
  };
}
