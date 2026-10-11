import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import {
  type PipelineFile,
  type PipelineShell,
  type PipelineStep,
  type PipelineTool,
  stepKind,
  vaultReferenceName,
} from "@zelyq/core";
import type { PipelineRunRow } from "@zelyq/db";
import type { PipelineMachine } from "@zelyq/runtime";
import type { DeployService } from "../deploy.js";
import {
  checkoutCommands,
  isPosix,
  prepareCommand,
  shellCommand,
  unpackCommand,
} from "./scripts.js";
import type { ToolService } from "./tools.js";

/**
 * The step kinds a pipeline file can use, one handler each. The engine gives
 * every handler the same things — the machine, the step's folder and
 * variables, and ways to run a command whose output lands in the step's log —
 * so a handler only says *what* to run, never how the log, Cancel or timeouts
 * work.
 */

/** A machine a run is on: a VM over SSH, a fresh container, or this server. */
export type Machine = PipelineMachine & {
  kind: "ssh" | "container" | "host";
  /** Shells found on the machine; null when not known. */
  shells: string[] | null;
  /** The machine's own Zelyq folder (tools, caches, runs). */
  zelyqDir: string;
};

/** What earlier steps leave for later ones. */
export interface RunState {
  /** Folders in front of PATH, newest setup first. */
  path: string[];
  /** Variables such as JAVA_HOME. */
  env: Record<string, string>;
  /** Work done after the last step, only when the run passed (saving caches). */
  post: ((
    machine: Machine,
    log: { add(stepId: null, stream: "system", text: string): void },
  ) => Promise<void>)[];
}

export interface StepResult {
  code: number | null;
  ended: "cancelled" | "timed_out" | null;
}

type Executed = StepResult & { stdout: string };

export interface StepContext {
  run: PipelineRunRow;
  file: PipelineFile;
  step: PipelineStep;
  stepId: string;
  machine: Machine;
  shell: PipelineShell;
  /** The step's folder (the run's folder, or its working-directory). */
  dir: string;
  env: Record<string, string>;
  state: RunState;
  secrets: Map<string, string>;
  /** A line in the step's log, in Zelyq's own voice. */
  system(text: string): void;
  /** Runs a command; with `quiet`, its output is returned rather than logged. */
  exec(
    command: string,
    stdin?: string | Buffer | Readable,
    options?: { quiet?: boolean },
  ): Promise<Executed>;
  /** Runs commands in the step's shell, folder and variables, like a run: step. */
  script(commands: string, env?: Record<string, string>): Promise<Executed>;
  tools: ToolService;
  /** The local runner's caches, on this server. */
  cacheDir: string;
  deploys: DeployService;
  /** A line in the step's log, with its stream. */
  line(stream: "out" | "err" | "system", text: string): void;
  /** Aborted when the run is cancelled or times out. */
  signal: AbortSignal;
  /** Where a `download` step's artifact is kept on this server. */
  findArtifact(
    from: string,
    name: string,
  ): Promise<{ path: string; label: string } | { error: string }>;
  archive(projectId: string): Promise<Buffer>;
  appId(app: string): Promise<string>;
}

const OK: StepResult = { code: 0, ended: null };
const FAILED: StepResult = { code: 1, ended: null };

export async function runStepKind(context: StepContext): Promise<StepResult> {
  switch (stepKind(context.step)) {
    case "checkout":
      return checkout(context);
    case "setup":
      return setup(context);
    case "cache":
      return cache(context);
    case "docker":
      return docker(context);
    case "deploy":
      return deploy(context);
    case "download":
      return download(context);
    default:
      return context.script(context.step.run ?? "");
  }
}

function sep(machine: Machine): string {
  return machine.os === "windows" ? "\\" : "/";
}

function join(machine: Machine, ...parts: string[]): string {
  const s = sep(machine);
  return parts
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part.replaceAll(/[\\/]/g, s)))
    .join(s);
}

function sq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function psq(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ------------------------------------------------------------------ checkout

async function checkout(context: StepContext): Promise<StepResult> {
  const { file, machine, run, dir } = context;
  if (file.source?.app) {
    const archive = await context.archive(await context.appId(file.source.app));
    await machine.exec(prepareCommand(machine.os, dir));
    context.system(`Copying ${file.source.app} (${formatBytes(archive.length)}).`);
    return context.exec(unpackCommand(machine.os, dir), archive);
  }
  if (!file.source?.repo) {
    context.system("checkout needs a source: in the file (an app or a repo).");
    return FAILED;
  }
  await machine.exec(prepareCommand(machine.os, dir));
  const ref = run.ref ?? file.source.ref ?? null;
  const steps = checkoutCommands({ shell: context.shell, repo: file.source.repo, ref });
  const tokenName = file.source.token ? vaultReferenceName(file.source.token) : null;
  context.system(`Fetching ${file.source.repo}${ref ? ` at ${ref}` : ""}.`);
  return context.script(
    steps.commands,
    steps.env(tokenName ? (context.secrets.get(tokenName) ?? null) : null),
  );
}

// --------------------------------------------------------------------- setup

const TOOL_TITLES: Record<PipelineTool, string> = {
  node: "Node",
  python: "Python",
  java: "Java",
  go: "Go",
};

/** The command that proves a tool works, run once it is on PATH. */
const VERSION_COMMANDS: Record<PipelineTool, string> = {
  node: "node --version",
  python: "python --version",
  java: "java -version",
  go: "go version",
};

export interface LocatedTool {
  version: string;
  home: string;
  bins: string[];
  homeVariable: string | null;
}

/** Puts a tool on PATH (and its home variable) for the rest of the run. */
export function applyTool(tool: LocatedTool, _machine: Machine, state: RunState): void {
  state.path.unshift(...tool.bins);
  if (tool.homeVariable) state.env[tool.homeVariable] = tool.home;
}

async function setup(context: StepContext): Promise<StepResult> {
  const wanted = context.step.setup;
  if (!wanted) return FAILED;
  const title = TOOL_TITLES[wanted.tool];
  const located = await context.tools.ensure(context, wanted);
  if ("error" in located) {
    context.system(located.error);
    return FAILED;
  }
  applyTool(located, context.machine, context.state);
  context.system(`${title} ${located.version} is on PATH for the rest of the run.`);
  return context.script(VERSION_COMMANDS[wanted.tool]);
}

// --------------------------------------------------------------------- cache

/** Which files decide a cache, when the step does not say. */
const DEFAULT_KEYS: Record<string, string[]> = {
  node_modules: [
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
  ],
  ".venv": ["requirements.txt", "poetry.lock", "uv.lock", "Pipfile.lock"],
  venv: ["requirements.txt", "poetry.lock", "uv.lock", "Pipfile.lock"],
  ".m2": ["pom.xml"],
  repository: ["pom.xml"],
  ".gradle": ["build.gradle", "build.gradle.kts", "gradle.lockfile", "settings.gradle"],
  vendor: ["composer.lock", "go.sum", "Gemfile.lock"],
  ".pnpm-store": ["pnpm-lock.yaml"],
};

/** Caches larger than this are not kept. */
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
/** Saved copies kept per pipeline, branch and folder. */
const KEEP_CACHES = 3;

function slug(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "_";
}

async function cache(context: StepContext): Promise<StepResult> {
  const wanted = context.step.cache;
  if (!wanted) return FAILED;
  const { machine, run, file } = context;
  const name =
    wanted.path
      .replace(/^~[\\/]/, "")
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() ?? wanted.path;
  const keyFiles = wanted.key ?? DEFAULT_KEYS[name] ?? null;
  if (!keyFiles) {
    context.system(
      `Say which files decide this cache, for example: cache: {path: ${wanted.path}, key: package-lock.json}`,
    );
    return FAILED;
  }

  // Where the folder is on the machine, and what decides its key.
  const windows = machine.os === "windows";
  const target = wanted.path.startsWith("~")
    ? windows
      ? `$env:USERPROFILE${wanted.path.slice(1).replaceAll("/", "\\")}`
      : `$HOME${wanted.path.slice(1)}`
    : join(machine, context.dir, wanted.path);
  const hashes = await context.exec(
    shellCommand(windows ? "powershell" : "sh"),
    windows
      ? [
          `Set-Location -LiteralPath ${psq(context.dir)}`,
          ...keyFiles.map(
            (f) =>
              `if (Test-Path -LiteralPath ${psq(f)}) { ${psq(`${f} `)} + (Get-FileHash -Algorithm SHA256 -LiteralPath ${psq(f)}).Hash.ToLower() }`,
          ),
          "",
        ].join("\r\n")
      : [
          `cd ${sq(context.dir)} || exit 1`,
          ...keyFiles.map(
            (f) =>
              `[ -f ${sq(f)} ] && printf '%s %s\\n' ${sq(f)} "$( (sha256sum ${sq(f)} 2>/dev/null || shasum -a 256 ${sq(f)}) | cut -d' ' -f1)"`,
          ),
          "true",
          "",
        ].join("\n"),
    { quiet: true },
  );
  if (hashes.ended) return hashes;
  const lines = hashes.stdout.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    context.system(`None of ${keyFiles.join(", ")} is in the step's folder; nothing to cache.`);
    return OK;
  }
  const key = createHash("sha256")
    .update([machine.os, wanted.path, ...lines.sort()].join("\n"))
    .digest("hex")
    .slice(0, 24);
  const defaultScope = slug(file.source?.ref ?? "default");
  const scope = slug(run.branch ?? file.source?.ref ?? "default");
  const scopes = scope === defaultScope ? [scope] : [scope, defaultScope];
  const entry = (s: string) => [run.pipelineId, s, slug(wanted.path), `${key}.tar.gz`];

  // The archive holds just that folder, by its name, under its parent.
  const parentOf = `"$(dirname ${target.startsWith("$HOME") ? `"${target}"` : sq(target)})"`;
  const base = name;

  if (machine.kind === "ssh") {
    const root = join(machine, machine.zelyqDir, "cache");
    const candidates = scopes.map((s) => join(machine, root, ...entry(s)));
    const restore = await context.exec(
      shellCommand(windows ? "powershell" : "sh"),
      cacheRestoreScript(machine.os, target, candidates),
      { quiet: true },
    );
    if (restore.ended) return restore;
    if (restore.code !== 0) {
      context.system(`Could not restore the cache of ${wanted.path}; going on without it.`);
    }
    const hit = restore.stdout.trim();
    if (hit) {
      context.system(
        `Cache hit: ${wanted.path}${hit.includes(`${sep(machine)}${defaultScope}${sep(machine)}`) && scope !== defaultScope ? ` (from ${file.source?.ref ?? "default"})` : ""}.`,
      );
      return OK;
    }
    context.system(`Cache miss: ${wanted.path}. It will be saved if the run passes.`);
    const destination = candidates[0] as string;
    context.state.post.push(async (onMachine, log) => {
      const folder = join(onMachine, root, ...entry(scope).slice(0, 3));
      // Sent as the shell's input, so no quoting through cmd.exe or ssh.
      const saved = await onMachine
        .exec(shellCommand(windows ? "powershell" : "sh"), {
          stdin: cacheSaveScript(machine.os, target, base, folder, destination),
        })
        .catch(() => ({ code: 1 }));
      log.add(
        null,
        "system",
        saved.code === 0
          ? `Saved the cache of ${wanted.path}.`
          : saved.code === 3
            ? `The cache of ${wanted.path} was not saved: there is no such folder.`
            : saved.code === 4
              ? `The cache of ${wanted.path} was not saved: it is larger than 2 GB.`
              : `The cache of ${wanted.path} could not be saved.`,
      );
    });
    return OK;
  }

  // The local runner: caches live on this server and are streamed in and out.
  const candidates = scopes.map((s) => path.join(context.cacheDir, ...entry(s)));
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat) continue;
    const restored = await context.exec(
      `p=${parentOf}; mkdir -p "$p" && tar -xzf - -C "$p"`,
      createReadStream(candidate),
      { quiet: true },
    );
    if (restored.ended) return restored;
    if (restored.code === 0) {
      await fs.utimes(candidate, new Date(), new Date()).catch(() => undefined);
      context.system(`Cache hit: ${wanted.path} (${formatBytes(stat.size)}).`);
      return OK;
    }
  }
  context.system(`Cache miss: ${wanted.path}. It will be saved if the run passes.`);
  const destination = candidates[0] as string;
  context.state.post.push(async (onMachine, log) => {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const part = `${destination}.part`;
    const output = createWriteStream(part);
    let size = 0;
    const tooBig = new AbortController();
    const packed = await onMachine
      .exec(
        `t=${target.startsWith("$HOME") ? `"${target}"` : sq(target)}; [ -d "$t" ] || exit 3; tar -czf - -C "$(dirname "$t")" ${sq(base)}`,
        {
          signal: tooBig.signal,
          onStdout: (chunk) => {
            size += chunk.length;
            if (size > MAX_CACHE_BYTES) tooBig.abort();
            else output.write(chunk);
          },
        },
      )
      .catch(() => ({ code: null }));
    await new Promise((resolve) => output.end(resolve));
    if (packed.code !== 0 || tooBig.signal.aborted) {
      await fs.rm(part, { force: true });
      log.add(
        null,
        "system",
        tooBig.signal.aborted
          ? `The cache of ${wanted.path} was not saved: it is larger than 2 GB.`
          : packed.code === 3
            ? `The cache of ${wanted.path} was not saved: there is no such folder.`
            : `The cache of ${wanted.path} could not be saved.`,
      );
      return;
    }
    await fs.rename(part, destination);
    const folder = path.dirname(destination);
    const kept = await Promise.all(
      (await fs.readdir(folder))
        .filter((entryName) => entryName.endsWith(".tar.gz"))
        .map(async (entryName) => ({
          file: path.join(folder, entryName),
          at: (await fs.stat(path.join(folder, entryName))).mtimeMs,
        })),
    );
    for (const old of kept.sort((a, b) => b.at - a.at).slice(KEEP_CACHES)) {
      await fs.rm(old.file, { force: true });
    }
    log.add(null, "system", `Saved the cache of ${wanted.path} (${formatBytes(size)}).`);
  });
  return OK;
}

// -------------------------------------------------------------------- docker

/** The registry an image lives in: its first part when that is a host name. */
export function registryOf(image: string): string | null {
  const first = image.split("/")[0] ?? "";
  return image.includes("/") &&
    (first.includes(".") || first.includes(":") || first === "localhost")
    ? first
    : null;
}

async function docker(context: StepContext): Promise<StepResult> {
  const spec = context.step.docker;
  if (!spec) return FAILED;
  if (context.machine.kind === "container") {
    context.system(
      "docker steps need a machine with Docker. The local runner's container has none: use an SSH runner (runs-on: [docker]) or ask an instance admin.",
    );
    return FAILED;
  }
  const password = spec.login
    ? context.secrets.get(vaultReferenceName(spec.login.password) ?? "")
    : null;
  const registry = spec.login?.registry ?? registryOf(spec.image);
  const short = context.stepId.replace(/^[a-z]+_/, "").slice(0, 12);
  const posix = isPosix(context.shell);
  const env: Record<string, string> = password ? { ZELYQ_REGISTRY_PASSWORD: password } : {};

  if (posix) {
    // Inside double quotes, so $ZELYQ_RUN_NUMBER in a tag is filled in.
    const dq = (value: string) => `"${value.replaceAll(/["\\`]/g, "\\$&")}"`;
    const refs = spec.tags.map((tag) => dq(`${spec.image}:${tag}`));
    const lines = [
      'command -v docker >/dev/null 2>&1 || { echo "Docker is not installed on this machine." >&2; exit 1; }',
      'docker info >/dev/null 2>&1 || { echo "This user cannot use Docker. Add it to the docker group (run the machine setup command again), or start Docker." >&2; exit 1; }',
    ];
    if (spec.login) {
      lines.push(
        // A login of this step only: its own Docker config folder, removed at the end.
        `export DOCKER_CONFIG="$ZELYQ_WORKSPACE/.zelyq-docker-${short}"`,
        'mkdir -p "$DOCKER_CONFIG"',
        `trap 'rm -rf "$DOCKER_CONFIG"' EXIT`,
        '[ -d "$HOME/.docker/cli-plugins" ] && ln -s "$HOME/.docker/cli-plugins" "$DOCKER_CONFIG/cli-plugins"',
        `printf '%s' "$ZELYQ_REGISTRY_PASSWORD" | docker login ${registry ? sq(registry) : ""} --username ${sq(spec.login.username)} --password-stdin`,
      );
    }
    lines.push(
      [
        "docker build",
        `-f ${sq(spec.file ?? "Dockerfile")}`,
        ...refs.map((ref) => `-t ${ref}`),
        ...Object.entries(spec["build-args"] ?? {}).map(
          ([k, v]) => `--build-arg ${dq(`${k}=${v}`)}`,
        ),
        sq(spec.context ?? "."),
      ].join(" "),
    );
    if (spec.push) {
      for (const ref of refs) lines.push(`docker push ${ref}`);
      lines.push(
        `echo "Pushed $(docker inspect --format '{{index .RepoDigests 0}}' ${refs[0]} 2>/dev/null || echo ${refs[0]})"`,
      );
    }
    return context.script(lines.join("\n"), env);
  }

  // PowerShell: $NAME in a tag becomes $env:NAME.
  const ps = (value: string) =>
    `"${value
      .replaceAll("`", "``")
      .replaceAll('"', '`"')
      .replaceAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, "$($env:$1)")}"`;
  const refs = spec.tags.map((tag) => ps(`${spec.image}:${tag}`));
  const lines = [
    "if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is not installed on this machine.' }",
    "docker info *> $null; if ($LASTEXITCODE -ne 0) { throw 'This user cannot use Docker. Start Docker Desktop, or add the user to docker-users.' }",
    spec.login
      ? `$env:DOCKER_CONFIG = Join-Path $env:ZELYQ_WORKSPACE '.zelyq-docker-${short}'`
      : "",
    spec.login ? "New-Item -ItemType Directory -Force -Path $env:DOCKER_CONFIG | Out-Null" : "",
    "try {",
    spec.login
      ? `  $env:ZELYQ_REGISTRY_PASSWORD | docker login ${registry ? psq(registry) : ""} --username ${psq(spec.login.username)} --password-stdin`
      : "",
    `  docker build -f ${psq(spec.file ?? "Dockerfile")} ${refs.map((ref) => `-t ${ref}`).join(" ")} ${Object.entries(
      spec["build-args"] ?? {},
    )
      .map(([k, v]) => `--build-arg ${ps(`${k}=${v}`)}`)
      .join(" ")} ${psq(spec.context ?? ".")}`,
    ...(spec.push ? refs.map((ref) => `  docker push ${ref}`) : []),
    "} finally {",
    spec.login
      ? "  Remove-Item -Recurse -Force -LiteralPath $env:DOCKER_CONFIG -ErrorAction SilentlyContinue"
      : "",
    "}",
  ].filter(Boolean);
  return context.script(lines.join("\r\n"), env);
}

/** A cache folder as the shell writes it: `$HOME/…`/`$env:USERPROFILE\…` stay unquoted for the shell to fill in. */
function targetIn(os: string, target: string): string {
  if (os === "windows") return target.startsWith("$env:") ? `"${target}"` : psq(target);
  return target.startsWith("$HOME") ? `"${target}"` : sq(target);
}

/**
 * Unpacks the first saved copy that exists into the folder's parent, and
 * prints which one it was (nothing on a miss). Exported for the machine tests.
 */
export function cacheRestoreScript(os: string, target: string, candidates: string[]): string {
  if (os === "windows") {
    return [
      "$ErrorActionPreference = 'Stop'",
      `$p = Split-Path -Parent ${targetIn(os, target)}`,
      ...candidates.map(
        (c) =>
          `if (Test-Path -LiteralPath ${psq(c)}) { New-Item -ItemType Directory -Force -Path $p | Out-Null; tar -xzf ${psq(c)} -C $p; if ($LASTEXITCODE -ne 0) { exit 1 }; (Get-Item -LiteralPath ${psq(c)}).LastWriteTime = Get-Date; Write-Output ${psq(c)}; exit 0 }`,
      ),
      "exit 0",
      "",
    ].join("\r\n");
  }
  return [
    "set -e",
    `p="$(dirname ${targetIn(os, target)})"`,
    ...candidates.map(
      (c) =>
        `if [ -f ${sq(c)} ]; then mkdir -p "$p"; tar -xzf ${sq(c)} -C "$p"; touch ${sq(c)}; echo ${sq(c)}; exit 0; fi`,
    ),
    "exit 0",
    "",
  ].join("\n");
}

/**
 * Packs the folder into `destination` (via a .part file, so a half-written
 * cache is never used) and keeps only the newest few. Exit 3: no such folder;
 * 4: larger than the limit. Exported for the machine tests.
 */
export function cacheSaveScript(
  os: string,
  target: string,
  base: string,
  folder: string,
  destination: string,
): string {
  if (os === "windows") {
    return [
      `$t = ${targetIn(os, target)}`,
      "if (-not (Test-Path -LiteralPath $t)) { exit 3 }",
      "$size = (Get-ChildItem -LiteralPath $t -Recurse -File -Force | Measure-Object -Sum Length).Sum",
      `if ($size -gt ${MAX_CACHE_BYTES}) { exit 4 }`,
      `New-Item -ItemType Directory -Force -Path ${psq(folder)} | Out-Null`,
      `tar -czf ${psq(`${destination}.part`)} -C (Split-Path -Parent $t) ${psq(base)}`,
      "if ($LASTEXITCODE -ne 0) { exit 1 }",
      `Move-Item -Force -LiteralPath ${psq(`${destination}.part`)} -Destination ${psq(destination)}`,
      `Get-ChildItem -LiteralPath ${psq(folder)} -Filter *.tar.gz | Sort-Object LastWriteTime -Descending | Select-Object -Skip ${KEEP_CACHES} | Remove-Item -Force`,
      "exit 0",
      "",
    ].join("\r\n");
  }
  return [
    "set -e",
    `t=${targetIn(os, target)}`,
    '[ -d "$t" ] || exit 3',
    `[ "$(du -sk "$t" | cut -f1)" -le ${MAX_CACHE_BYTES / 1024} ] || exit 4`,
    `mkdir -p ${sq(folder)}`,
    `tar -czf ${sq(`${destination}.part`)} -C "$(dirname "$t")" ${sq(base)}`,
    `mv ${sq(`${destination}.part`)} ${sq(destination)}`,
    `ls -t ${sq(folder)}/*.tar.gz 2>/dev/null | tail -n +${KEEP_CACHES + 1} | while read -r old; do rm -f "$old"; done`,
    "exit 0",
    "",
  ].join("\n");
}

// -------------------------------------------------------------------- deploy

/** An app's name on a machine: lower-case letters, digits and '-'. */
export function appSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 40) || "app"
  );
}

async function deploy(context: StepContext): Promise<StepResult> {
  const spec = context.step.deploy;
  if (!spec) return FAILED;
  const { machine, run, file } = context;
  const environment = await context.deploys.environmentFor(run.teamId, spec.to);
  if ("error" in environment) {
    context.system(environment.error);
    return FAILED;
  }
  const app = spec.app ?? appSlug(file.source?.app ?? file.name);

  // The step's folder, packed where the run is and streamed to the environment's machine.
  const source = new PassThrough();
  const windows = machine.os === "windows";
  const packing = machine
    .exec(
      windows
        ? `cd /d "${context.dir}" && tar -czf - --exclude=node_modules --exclude=.git .`
        : `cd ${sq(context.dir)} && tar -czf - --exclude=./node_modules --exclude=./.git .`,
      {
        onStdout: (chunk) => {
          source.write(chunk);
        },
        signal: context.signal,
      },
    )
    .catch(() => ({ code: null }))
    .finally(() => source.end());

  const result = await context.deploys.deploy({
    teamId: run.teamId,
    environment,
    app,
    port: spec.port,
    hostPort: spec["host-port"] ?? spec.port,
    healthPath: spec.health,
    healthTimeoutS: spec["health-timeout"] ?? 60,
    url: spec.url ?? null,
    runId: run.id,
    triggeredBy: run.triggeredBy,
    source,
    reuse: null,
    onLine: (stream, text) => context.line(stream, text),
    signal: context.signal,
  });
  source.resume();
  await packing;
  if (context.signal.aborted) return { code: null, ended: "cancelled" };
  return result.ok ? OK : FAILED;
}

// ------------------------------------------------------------------ download

/** Unpacks an artifact another run kept into the step's folder (or `path:`). */
async function download(context: StepContext): Promise<StepResult> {
  const spec = context.step.download;
  if (!spec) return FAILED;
  const found = await context.findArtifact(spec.from, spec.artifact);
  if ("error" in found) {
    context.system(found.error);
    return FAILED;
  }
  const { machine } = context;
  const target = spec.path ? join(machine, context.dir, spec.path) : context.dir;
  await machine.exec(prepareCommand(machine.os, target));
  context.system(`Unpacking ${found.label}.`);
  return context.exec(unpackCommand(machine.os, target), createReadStream(found.path));
}
