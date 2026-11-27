#!/usr/bin/env node
/**
 * The Zelyq runner: a machine that runs a team's pipelines and deploys by connecting OUT to Zelyq,
 * the way GitHub Actions and GitLab runners do. Nothing on the machine is open to the internet: it
 * keeps one HTTPS (WebSocket) connection to Zelyq, and Zelyq sends each command down it.
 *
 *   zelyq-runner register --url https://zelyq.example.com --code <one-time code>
 *   zelyq-runner run
 *   zelyq-runner --version
 *
 * One file, Node 22 or newer, nothing else: the install command Zelyq shows downloads it and a Node
 * of its own. Its key is made here and never leaves the machine; Zelyq knows only the public half.
 *
 * What it does with a command is what an SSH server does: `$SHELL -c <command>` as this user, in the
 * home folder, with the output streamed back. On Windows, as Windows' own OpenSSH server does, the
 * command runs in cmd.exe: Zelyq's Windows commands are written for it. A command stops when Zelyq says so, and every command
 * stops when the connection to Zelyq is lost (nobody is listening to it any more).
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSION = "1.0.0";
/** Changes only when an older Zelyq could not understand this runner (or the other way round). */
export const PROTOCOL = 1;

/** Binary frames: [type][id: uint32][bytes]. */
export const FRAME = { stdin: 1, stdout: 2, stderr: 3 } as const;

/** What the runner signs to prove it holds its key: Zelyq's fresh nonce, bound to this runner. */
export function authMessage(nonce: string, runnerId: string): Buffer {
  return Buffer.from(`zelyq-runner/v1\n${nonce}\n${runnerId}`, "utf8");
}

export function frame(type: number, id: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(id, 1);
  return Buffer.concat([head, payload]);
}

export function unframe(data: Buffer): { type: number; id: number; payload: Buffer } | null {
  if (data.length < 5) return null;
  return { type: data.readUInt8(0), id: data.readUInt32BE(1), payload: data.subarray(5) };
}

/** The text without slashes at its end (a loop, not a regex: no slow cases on many slashes). */
function trimSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 47) end--;
  return text.slice(0, end);
}

/** https only, except on this machine itself (a Zelyq on localhost). */
export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${raw} is not an address. Use your Zelyq's address, https://…`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(
      "Zelyq's address must start with https:// (commands come down this connection).",
    );
  }
  url.pathname = trimSlashes(url.pathname);
  url.search = "";
  url.hash = "";
  return url;
}

/** Zelyq's address without a trailing slash, to put paths after. */
export function baseUrl(url: URL): string {
  return trimSlashes(url.href);
}

export function socketUrl(base: URL): string {
  return `${baseUrl(base)}/ws/runner-agent`.replace(/^http/, "ws");
}

interface Config {
  url: string;
  runnerId: string;
  name: string;
}

function stateDir(): string {
  return process.env.ZELYQ_RUNNER_HOME || path.join(os.homedir(), ".zelyq-runner");
}

/** Where the log also goes (`run --log <file>`): a Windows task has no screen to print to. */
let logFile: string | null = null;
const LOG_LIMIT = 1024 * 1024;

function log(line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`;
  process.stdout.write(text);
  if (!logFile) return;
  try {
    // One old file is kept beside it, so the log never grows past twice the limit.
    if (existsSync(logFile) && statSync(logFile).size > LOG_LIMIT)
      renameSync(logFile, `${logFile}.old`);
    appendFileSync(logFile, text);
  } catch {
    // A log that cannot be written must not stop the runner.
  }
}

const WINDOWS = process.platform === "win32";

/**
 * How a command starts. Windows: in cmd.exe, the way Windows OpenSSH starts it, with the command
 * passed as written (`/s /c "…"` keeps its own quotes). Elsewhere: `$SHELL -c`, in a process group
 * of its own so a stop reaches what it started.
 */
export function commandLine(
  command: string,
  shell: string,
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[]; windowsVerbatimArguments: boolean; detached: boolean } {
  if (platform === "win32") {
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `"${command}"`],
      windowsVerbatimArguments: true,
      detached: false,
    };
  }
  return { file: shell, args: ["-c", command], windowsVerbatimArguments: false, detached: true };
}

/**
 * Who the runner runs as. os.userInfo() throws for a user with no account on the machine (a container
 * started with --user 1234, for one): then the USER setting, or the number.
 */
export function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER || process.env.LOGNAME || String(process.getuid?.() ?? "unknown");
  }
}

/** The machine, as Zelyq shows it in Runners. */
export function machineFacts(): Record<string, string | number | null> {
  return {
    hostname: os.hostname(),
    os:
      process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux",
    arch: process.arch,
    user: currentUser(),
  };
}

// ------------------------------------------------------------------ register

async function register(args: Map<string, string>): Promise<void> {
  const url = checkUrl(args.get("url") ?? "");
  const code = (args.get("code") ?? "").trim();
  if (!code) throw new Error("--code: the one-time code Zelyq showed with the install command.");
  const dir = stateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  // A new key every time it is installed: the old one stops working once this one is registered.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const response = await fetch(`${baseUrl(url)}/api/runner-agent/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": `zelyq-runner/${VERSION}` },
    body: JSON.stringify({
      code,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      version: VERSION,
      protocol: PROTOCOL,
      facts: machineFacts(),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    runnerId?: string;
    name?: string;
    message?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.runnerId) {
    throw new Error(
      body.error?.message || body.message || `Zelyq refused the code (${response.status}).`,
    );
  }
  const keyFile = path.join(dir, "key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  // mode applies only to a new file: a reinstall over an old one keeps it private too.
  chmodSync(keyFile, 0o600);
  const config: Config = { url: baseUrl(url), runnerId: body.runnerId, name: body.name ?? "" };
  writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(path.join(dir, "config.json"), 0o600);
  log(`Registered with ${url.host} as the runner ${config.name}.`);
}

// ----------------------------------------------------------------------- run

interface Running {
  child: ChildProcess;
  pausedByZelyq: boolean;
  stdinHeld: boolean;
  killTimer: NodeJS.Timeout | null;
}

/** What the commands see: this user's environment, without the runner's own settings. */
function commandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("ZELYQ_RUNNER_") && !key.startsWith("NODE_")) env[key] = value;
  }
  return env;
}

function stopTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (WINDOWS) {
    // Windows has no process groups to signal: taskkill /T ends the command and what it started.
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).on("error", () => child.kill(signal));
    } catch {
      child.kill(signal);
    }
    return;
  }
  try {
    // detached: the command leads its own process group, so its children stop with it.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // gone already
    }
  }
}

/** Holds one connection to Zelyq: signs in, then runs what it is sent until the connection ends. */
export class Link {
  private readonly running = new Map<number, Running>();
  private socketPaused = false;
  private pump: NodeJS.Timeout | null = null;
  private lastPing = Date.now();
  private watchdog: NodeJS.Timeout | null = null;
  /** Set once Zelyq accepts the runner; a refusal says why. */
  ready = false;
  refused: string | null = null;
  /** Called when the connection went silent: the attempt is over even if no close comes. */
  onDead: (() => void) | null = null;

  constructor(
    private readonly socket: WebSocket,
    private readonly config: Config,
    private readonly key: KeyObject,
    private readonly shell: string = process.env.SHELL || "/bin/sh",
  ) {
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => this.onMessage(event.data));
    socket.addEventListener("close", (event) => {
      if (event.code === 4401 || event.code === 4403 || event.code === 4404) {
        this.refused = event.reason || "Zelyq refused this runner.";
      }
      this.end();
    });
    this.watchdog = setInterval(() => {
      // Zelyq says something at least every 20 s; silence for a minute is a dead connection.
      // A half-open connection may never say it closed: stop waiting for it here.
      if (Date.now() - this.lastPing > 60_000) {
        try {
          socket.close(4000, "silent");
        } catch {
          // closing already
        }
        this.end();
        this.onDead?.();
      }
    }, 10_000);
  }

  private send(value: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value));
  }

  private sendData(type: number, id: number, chunk: Buffer): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(frame(type, id, chunk));
    // Zelyq reads slower than the command writes: hold every command until the connection catches up.
    if (!this.socketPaused && this.socket.bufferedAmount > 4 * 1024 * 1024) {
      this.socketPaused = true;
      for (const run of this.running.values()) this.pauseOutput(run, true);
      this.pump = setInterval(() => {
        if (this.socket.bufferedAmount > 1024 * 1024) return;
        this.socketPaused = false;
        if (this.pump) clearInterval(this.pump);
        this.pump = null;
        for (const run of this.running.values())
          if (!run.pausedByZelyq) this.pauseOutput(run, false);
      }, 25);
    }
  }

  private pauseOutput(run: Running, pause: boolean): void {
    for (const stream of [run.child.stdout, run.child.stderr]) {
      if (!stream) continue;
      if (pause) stream.pause();
      else stream.resume();
    }
  }

  private onMessage(data: unknown): void {
    this.lastPing = Date.now();
    if (typeof data !== "string") {
      const parsed = unframe(Buffer.from(data as ArrayBuffer));
      if (!parsed || parsed.type !== FRAME.stdin) return;
      const run = this.running.get(parsed.id);
      const stdin = run?.child.stdin;
      if (!run || !stdin || stdin.destroyed) return;
      // The command reads slower than Zelyq sends: ask Zelyq to hold its input until it catches up.
      if (!stdin.write(parsed.payload) && !run.stdinHeld) {
        run.stdinHeld = true;
        this.send({ t: "stdin-pause", id: parsed.id });
        stdin.once("drain", () => {
          run.stdinHeld = false;
          this.send({ t: "stdin-resume", id: parsed.id });
        });
      }
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = typeof message.id === "number" ? message.id : -1;
    switch (message.t) {
      case "hello": {
        const nonce = String(message.nonce ?? "");
        this.send({
          t: "auth",
          runnerId: this.config.runnerId,
          signature: sign(null, authMessage(nonce, this.config.runnerId), this.key).toString(
            "base64",
          ),
          version: VERSION,
          protocol: PROTOCOL,
          facts: machineFacts(),
        });
        return;
      }
      case "ready":
        this.ready = true;
        log(
          `Connected to ${new URL(this.config.url).host} as ${String(message.name ?? this.config.name)}.`,
        );
        return;
      case "ping":
        this.send({ t: "pong" });
        return;
      case "exec":
        if (this.ready) this.exec(id, String(message.command ?? ""), message.stdin === true);
        return;
      case "stdin-end":
        this.running.get(id)?.child.stdin?.end();
        return;
      case "abort": {
        const run = this.running.get(id);
        if (run) this.abort(run);
        return;
      }
      case "pause":
      case "resume": {
        const run = this.running.get(id);
        if (!run) return;
        run.pausedByZelyq = message.t === "pause";
        if (!this.socketPaused) this.pauseOutput(run, run.pausedByZelyq);
        return;
      }
      default:
        return;
    }
  }

  private exec(id: number, command: string, hasStdin: boolean): void {
    let child: ChildProcess;
    try {
      const line = commandLine(command, this.shell);
      child = spawn(line.file, line.args, {
        cwd: os.homedir(),
        env: commandEnv(),
        detached: line.detached,
        windowsVerbatimArguments: line.windowsVerbatimArguments,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      this.send({ t: "exit", id, code: null, signal: null, error: (error as Error).message });
      return;
    }
    const run: Running = { child, pausedByZelyq: false, stdinHeld: false, killTimer: null };
    this.running.set(id, run);
    if (!hasStdin) child.stdin?.end();
    child.stdin?.on("error", () => undefined);
    child.stdout?.on("data", (chunk: Buffer) => this.sendData(FRAME.stdout, id, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.sendData(FRAME.stderr, id, chunk));
    if (this.socketPaused) this.pauseOutput(run, true);
    let spawnError: string | null = null;
    child.on("error", (error) => {
      spawnError = error.message;
    });
    // "close": after the output is all read, so Zelyq has every byte before the exit.
    child.on("close", (code, signal) => {
      if (run.killTimer) clearTimeout(run.killTimer);
      this.running.delete(id);
      this.send({ t: "exit", id, code, signal, ...(spawnError ? { error: spawnError } : {}) });
    });
  }

  private abort(run: Running): void {
    stopTree(run.child, "SIGTERM");
    run.killTimer ??= setTimeout(() => {
      stopTree(run.child, "SIGKILL");
      // Something that left the command's process group may still hold its output open: stop
      // reading, so the command counts as ended.
      setTimeout(() => {
        run.child.stdout?.destroy();
        run.child.stderr?.destroy();
      }, 3_000);
    }, 5_000);
  }

  /** The connection is gone: nothing is listening to the commands any more, so they stop. */
  private end(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.pump) clearInterval(this.pump);
    this.watchdog = null;
    this.pump = null;
    for (const run of this.running.values()) this.abort(run);
  }

  get busy(): number {
    return this.running.size;
  }
}

function loadConfig(): { config: Config; key: KeyObject } {
  const dir = stateDir();
  const configPath = path.join(dir, "config.json");
  if (!existsSync(configPath)) {
    throw new Error(
      `Not registered yet (${configPath} is missing). Run the install command Zelyq shows in Pipelines → Runners.`,
    );
  }
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  checkUrl(config.url);
  const key = createPrivateKey(readFileSync(path.join(dir, "key.pem")));
  return { config, key };
}

/** Connects, and connects again whenever the connection ends, waiting longer each time it fails. */
async function run(): Promise<void> {
  const { config, key } = loadConfig();
  const fingerprint = `SHA256:${createHash("sha256")
    .update(createPublicKey(key).export({ type: "spki", format: "der" }))
    .digest("base64")
    .replace(/=+$/, "")}`;
  log(`Zelyq runner ${VERSION}: ${config.name} (${fingerprint}), for ${config.url}.`);
  let failures = 0;
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      stopping = true;
      log("Stopping.");
      process.exit(0);
    });
  }
  while (!stopping) {
    const started = Date.now();
    const outcome = await new Promise<{ ready: boolean; refused: string | null; why: string }>(
      (resolve) => {
        let socket: WebSocket;
        try {
          socket = new WebSocket(socketUrl(new URL(config.url)));
        } catch (error) {
          resolve({ ready: false, refused: null, why: (error as Error).message });
          return;
        }
        const link = new Link(socket, config, key);
        let why = "";
        link.onDead = () => resolve({ ready: link.ready, refused: null, why: "Zelyq went silent" });
        socket.addEventListener("error", (event) => {
          why = (event as ErrorEvent).message || "connection failed";
        });
        socket.addEventListener("close", (event) =>
          resolve({
            ready: link.ready,
            refused: link.refused,
            why: why || `closed (${event.code})`,
          }),
        );
      },
    );
    // A connection that worked for a while starts the waiting over.
    failures = outcome.ready && Date.now() - started > 30_000 ? 0 : failures + 1;
    let wait = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
    if (outcome.refused) {
      log(
        `Zelyq refused this runner: ${outcome.refused} If it was removed or reinstalled elsewhere, run the install command again.`,
      );
      wait = 5 * 60_000;
    } else {
      log(`Disconnected: ${outcome.why}. Connecting again in ${Math.round(wait / 1000)} s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, wait * (0.8 + Math.random() * 0.4)));
  }
}

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) continue;
    const [name, inline] = arg.slice(2).split("=", 2) as [string, string | undefined];
    out.set(name, inline ?? argv[++i] ?? "");
  }
  return out;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--version" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (typeof WebSocket === "undefined") {
    throw new Error(`The Zelyq runner needs Node 22 or newer (this is ${process.version}).`);
  }
  if (command === "register") {
    await register(parseArgs(rest));
    return 0;
  }
  if (command === "run") {
    const log = parseArgs(rest).get("log");
    if (log) logFile = path.resolve(log);
    await run();
    return 0;
  }
  process.stderr.write(
    "Usage: zelyq-runner register --url https://… --code …   |   zelyq-runner run [--log <file>]   |   zelyq-runner --version\n",
  );
  return 2;
}

// Run as a program (not when a test imports it).
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked && (invoked.endsWith("agent.js") || invoked.endsWith("zelyq-runner.mjs"))) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code !== 0) process.exit(code);
    },
    (error: Error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    },
  );
}
