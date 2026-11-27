import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { RUNNER_AGENT_SERVICE, type RunnerOs } from "@zelyq/core";
import type { RunnerRow, Store } from "@zelyq/db";
import type { RawData, WebSocket } from "ws";
import { type ExecOptions, type RunnerSession, SshError } from "./ssh.js";

/**
 * Runners that connect out to Zelyq (kind "agent", apps/runner). The machine opens one WebSocket
 * to /ws/runner-agent and keeps it; Zelyq sends each command down it and gets the output back.
 * Nothing on the machine listens, so it can sit behind NAT with no public address, like a GitHub
 * Actions or GitLab runner.
 *
 * Who it is: the machine made its own Ed25519 key and registered the public half once, with a
 * one-time code an admin made (runners.ts). Each connection then signs a fresh nonce from Zelyq;
 * anything else first is refused. Who Zelyq is: the machine connects over verified HTTPS only.
 *
 * The protocol (apps/runner/src/agent.ts is the other side):
 *   Zelyq → hello {nonce}           runner → auth {runnerId, signature, version, protocol, facts}
 *   Zelyq → ready {name}            then, any number at once:
 *   Zelyq → exec {id, command, stdin}, [stdin frames], stdin-end {id}, abort {id}, pause/resume {id}
 *   runner → [stdout / stderr frames], exit {id, code, signal}
 *   Zelyq → ping every 20 s; runner → pong. A minute of silence either way ends the connection.
 * Frames are binary: [type: 1 stdin, 2 stdout, 3 stderr][id: uint32][bytes].
 */

export const AGENT_SOCKET_PATH = "/ws/runner-agent";
export const AGENT_PROTOCOL = 1;
const FRAME = { stdin: 1, stdout: 2, stderr: 3 } as const;
const CHUNK = 64 * 1024;

export function agentAuthMessage(nonce: string, runnerId: string): Buffer {
  return Buffer.from(`zelyq-runner/v1\n${nonce}\n${runnerId}`, "utf8");
}

/** OpenSSH-style fingerprint of the agent's public key (base64 SPKI DER), as Runners shows it. */
export function agentKeyFingerprint(spkiBase64: string): string {
  return `SHA256:${createHash("sha256").update(Buffer.from(spkiBase64, "base64")).digest("base64").replace(/=+$/, "")}`;
}

/** A public key the runner sent: an Ed25519 key and nothing else, back as base64 SPKI DER. */
export function parseAgentPublicKey(spkiBase64: string): string {
  try {
    const key = createPublicKey({
      key: Buffer.from(spkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
    return key.export({ format: "der", type: "spki" }).toString("base64");
  } catch {
    throw new SshError("That is not the runner's public key.", "auth");
  }
}

function frame(type: number, id: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt8(type, 0);
  head.writeUInt32BE(id, 1);
  return Buffer.concat([head, payload]);
}

interface Pending {
  options: ExecOptions;
  resolve: (value: { code: number | null; signal: string | null }) => void;
  reject: (error: Error) => void;
  /** Zelyq asked the runner to hold this command's output until the reader catches up. */
  held: boolean;
  /** The command's input, when it is a stream; held while the runner's command reads slowly
   *  (heldByRunner) or the connection is behind (heldBySocket), and flowing only when neither. */
  input: NodeJS.ReadableStream | null;
  heldByRunner: boolean;
  heldBySocket: boolean;
  cleanup: () => void;
}

/** After a stop, how long the command may take to end before Zelyq stops waiting for it. */
const ABORT_GRACE_MS = 15_000;

/** One runner's connection, once it has proved who it is. */
class AgentLink {
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly socket: WebSocket,
    readonly runnerId: string,
    readonly fingerprint: string,
  ) {
    // However the socket ends, this link ends with it: nothing may wait on a dead connection.
    socket.on("close", () => this.end("it disconnected"));
    socket.on("error", () => this.end("connection error"));
  }

  get open(): boolean {
    return !this.closed && this.socket.readyState === this.socket.OPEN;
  }

  get running(): number {
    return this.pending.size;
  }

  private sendJson(value: unknown): void {
    if (this.open) this.socket.send(JSON.stringify(value));
  }

  exec(
    command: string,
    options: ExecOptions = {},
  ): Promise<{ code: number | null; signal: string | null }> {
    if (!this.open) {
      return Promise.reject(new SshError("The runner's connection to Zelyq was lost.", "lost"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let graceTimer: NodeJS.Timeout | null = null;
      const onAbort = () => {
        this.sendJson({ t: "abort", id });
        // Like closing an SSH channel: Zelyq stops waiting even if something on the machine
        // escaped the command's process group and keeps its output open.
        graceTimer ??= setTimeout(() => {
          const entry = this.pending.get(id);
          if (!entry) return;
          this.pending.delete(id);
          entry.cleanup();
          entry.options.stdout?.end();
          entry.resolve({ code: null, signal: "SIGKILL" });
        }, ABORT_GRACE_MS);
      };
      const onDrain = () => {
        const entry = this.pending.get(id);
        if (entry?.held) {
          entry.held = false;
          this.sendJson({ t: "resume", id });
        }
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      options.stdout?.on("drain", onDrain);
      const input = options.stdin;
      const stream =
        input !== undefined && typeof input !== "string" && !Buffer.isBuffer(input) ? input : null;
      this.pending.set(id, {
        options,
        resolve,
        reject,
        held: false,
        input: stream,
        heldByRunner: false,
        heldBySocket: false,
        cleanup: () => {
          if (graceTimer) clearTimeout(graceTimer);
          options.signal?.removeEventListener("abort", onAbort);
          options.stdout?.off("drain", onDrain);
        },
      });
      this.sendJson({ t: "exec", id, command, stdin: input !== undefined });
      if (options.signal?.aborted) onAbort();
      if (input === undefined) return;
      if (!stream) {
        const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input as string, "utf8");
        for (let at = 0; at < bytes.length; at += CHUNK) {
          if (this.open) this.socket.send(frame(FRAME.stdin, id, bytes.subarray(at, at + CHUNK)));
        }
        this.sendJson({ t: "stdin-end", id });
        return;
      }
      stream.on("data", (chunk: Buffer | string) => {
        if (!this.open) return;
        this.socket.send(
          frame(FRAME.stdin, id, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        // The connection is behind: wait for it to catch up.
        const entry = this.pending.get(id);
        if (entry && !entry.heldBySocket && this.socket.bufferedAmount > 4 * 1024 * 1024) {
          entry.heldBySocket = true;
          stream.pause();
          const wait = setInterval(() => {
            const still = this.pending.get(id);
            if (!still || !this.open) {
              clearInterval(wait);
              return;
            }
            if (this.socket.bufferedAmount < 1024 * 1024) {
              clearInterval(wait);
              still.heldBySocket = false;
              if (!still.heldByRunner) stream.resume();
            }
          }, 25);
        }
      });
      stream.on("end", () => this.sendJson({ t: "stdin-end", id }));
      stream.on("error", () => this.sendJson({ t: "stdin-end", id }));
    });
  }

  handle(data: RawData, binary: boolean): void {
    if (binary) {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
      if (bytes.length < 5) return;
      const type = bytes.readUInt8(0);
      const entry = this.pending.get(bytes.readUInt32BE(1));
      if (!entry) return;
      const payload = bytes.subarray(5);
      if (type === FRAME.stdout) {
        if (entry.options.stdout) {
          if (!entry.options.stdout.write(payload) && !entry.held) {
            entry.held = true;
            this.sendJson({ t: "pause", id: bytes.readUInt32BE(1) });
          }
        } else entry.options.onStdout?.(payload);
      } else if (type === FRAME.stderr) entry.options.onStderr?.(payload);
      return;
    }
    let message: {
      t?: string;
      id?: number;
      code?: number | null;
      signal?: string | null;
      error?: string;
    };
    try {
      message = JSON.parse(data.toString()) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    // The command on the machine reads its input slower than it arrives: hold the input.
    if (message.t === "stdin-pause" || message.t === "stdin-resume") {
      entry.heldByRunner = message.t === "stdin-pause";
      if (entry.heldByRunner) entry.input?.pause();
      else if (!entry.heldBySocket) entry.input?.resume();
      return;
    }
    if (message.t !== "exit") return;
    this.pending.delete(message.id);
    entry.cleanup();
    if (message.error && message.code === null) {
      entry.options.stdout?.end();
      entry.reject(
        new SshError(`The runner could not start the command: ${message.error}`, "lost"),
      );
      return;
    }
    if (entry.options.stdout) {
      entry.options.stdout.end(() =>
        entry.resolve({ code: message.code ?? null, signal: message.signal ?? null }),
      );
    } else entry.resolve({ code: message.code ?? null, signal: message.signal ?? null });
  }

  /** The connection ended: every command still waiting fails, as a lost SSH connection does. */
  end(why: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.cleanup();
      entry.options.stdout?.end();
      entry.reject(new SshError(`The runner's connection to Zelyq was lost (${why}).`, "lost"));
    }
    this.pending.clear();
  }

  close(code: number, reason: string): void {
    this.end(reason);
    try {
      this.socket.close(code, reason);
    } catch {
      // closed already
    }
  }
}

/** What a pipeline, deploy or Ops check holds while it uses an agent: the shared link, borrowed. */
class AgentSession implements RunnerSession {
  private done = false;
  constructor(private readonly link: AgentLink) {}

  get acceptedKeyFingerprint(): string {
    return this.link.fingerprint;
  }

  exec(command: string, options: ExecOptions = {}) {
    if (this.done) return Promise.reject(new SshError("This session was closed.", "lost"));
    return this.link.exec(command, options);
  }

  async capture(command: string, timeoutMs = 20_000, stdin?: string) {
    let stdout = "";
    let stderr = "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { code } = await this.exec(command, {
        stdin,
        signal: controller.signal,
        onStdout: (chunk) => {
          stdout += chunk.toString("utf8");
        },
        onStderr: (chunk) => {
          stderr += chunk.toString("utf8");
        },
      });
      return { code, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  }

  /** The connection stays: it is the runner's, not this session's. */
  close(): void {
    this.done = true;
  }
}

export interface AgentHello {
  version: string;
  facts: { hostname?: string; os?: string; arch?: string; user?: string };
}

export class AgentHub {
  private readonly links = new Map<string, AgentLink>();
  private readonly waiting = new Map<string, Set<() => void>>();

  constructor(
    private readonly store: Store,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  online(runnerId: string): boolean {
    return this.links.get(runnerId)?.open ?? false;
  }

  /** A session on the runner; waits up to `waitMs` for it to (re)connect, as after a restart. */
  async session(
    row: Pick<RunnerRow, "id" | "name" | "lastSeenAt"> & Partial<Pick<RunnerRow, "os">>,
    waitMs = 0,
  ): Promise<RunnerSession> {
    let link = this.links.get(row.id);
    if (!link?.open && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const set = this.waiting.get(row.id) ?? new Set();
        const done = () => {
          clearTimeout(timer);
          set.delete(done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        set.add(done);
        this.waiting.set(row.id, set);
      });
      link = this.links.get(row.id);
    }
    if (!link?.open) {
      throw new SshError(
        `${row.name} is not connected to Zelyq${row.lastSeenAt ? ` (last seen ${row.lastSeenAt})` : " yet"}. ` +
          `Check that its service runs on the machine: ${serviceCheck(row.os)}.`,
        "unreachable",
      );
    }
    return new AgentSession(link);
  }

  /** Removed, or reinstalled with a new key: the old connection ends now. */
  disconnect(runnerId: string, reason: string): void {
    const link = this.links.get(runnerId);
    if (!link) return;
    this.links.delete(runnerId);
    link.close(4403, reason);
  }

  /** A new connection to /ws/runner-agent: nothing is accepted from it until it signs Zelyq's nonce. */
  accept(socket: WebSocket): void {
    const nonce = randomBytes(32).toString("base64url");
    let link: AgentLink | null = null;
    let lastHeard = Date.now();
    let lastSaved = 0;
    const refuse = (code: number, reason: string) => {
      try {
        socket.close(code, reason);
      } catch {
        // gone already
      }
    };
    const signIn = setTimeout(() => refuse(4401, "No sign-in in time."), 15_000);
    const heartbeat = setInterval(() => {
      if (Date.now() - lastHeard > 60_000) {
        socket.terminate();
        return;
      }
      if (link) socket.send(JSON.stringify({ t: "ping" }));
      if (link && Date.now() - lastSaved > 60_000) {
        lastSaved = Date.now();
        void this.store.pipelines.runners
          .update(link.runnerId, { lastSeenAt: new Date().toISOString() })
          .catch(() => undefined);
      }
    }, 20_000);

    let tried = false;
    socket.on("message", (data: RawData, binary: boolean) => {
      lastHeard = Date.now();
      if (link) {
        link.handle(data, binary);
        return;
      }
      // Before signing in: one small text message, the sign-in, and nothing else.
      const size = Buffer.isBuffer(data) ? data.length : 0;
      if (tried || binary || size > 4096) return refuse(4401, "Sign in first.");
      tried = true;
      void this.signIn(socket, nonce, data.toString()).then(
        (signedIn) => {
          clearTimeout(signIn);
          link = signedIn;
          lastSaved = Date.now();
        },
        (error: Error & { code?: number }) =>
          refuse(error.code ?? 4401, error.message.slice(0, 120)),
      );
    });
    socket.on("close", () => {
      clearTimeout(signIn);
      clearInterval(heartbeat);
      if (!link) return;
      if (this.links.get(link.runnerId) === link) {
        this.links.delete(link.runnerId);
        void this.store.pipelines.runners
          .update(link.runnerId, { lastSeenAt: new Date().toISOString() })
          .catch(() => undefined);
      }
    });
    socket.on("error", () => undefined);
    socket.send(JSON.stringify({ t: "hello", nonce, protocol: AGENT_PROTOCOL }));
  }

  private async signIn(socket: WebSocket, nonce: string, text: string): Promise<AgentLink> {
    const fail = (message: string, code = 4401) => Object.assign(new Error(message), { code });
    let message: {
      t?: string;
      runnerId?: string;
      signature?: string;
      version?: string;
      protocol?: number;
      facts?: AgentHello["facts"];
    };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      throw fail("Sign in first.");
    }
    if (
      message.t !== "auth" ||
      typeof message.runnerId !== "string" ||
      typeof message.signature !== "string"
    ) {
      throw fail("Sign in first.");
    }
    if (message.protocol !== AGENT_PROTOCOL) {
      throw fail("This runner is a different version: run the install command again.", 4400);
    }
    // One answer for every refusal: it says nothing about which runners exist.
    const refused =
      "Zelyq does not know this runner with this key: it was removed or installed again elsewhere. Run its install command again.";
    const row = await this.store.pipelines.runners.findById(message.runnerId);
    if (!row || row.kind !== "agent" || !row.hostKey) throw fail(refused, 4403);
    const signedWith = row.hostKey;
    let ok = false;
    try {
      ok = verify(
        null,
        agentAuthMessage(nonce, row.id),
        createPublicKey({ key: Buffer.from(signedWith, "base64"), format: "der", type: "spki" }),
        Buffer.from(message.signature, "base64"),
      );
    } catch {
      ok = false;
    }
    if (!ok) throw fail(refused, 4403);
    const facts = message.facts ?? {};
    const clean = (value: unknown, max: number) =>
      typeof value === "string" ? value.replace(/[^\w.@:-]/g, "").slice(0, max) : "";
    const os = ["linux", "macos", "windows"].includes(String(facts.os)) ? String(facts.os) : row.os;
    const saved = await this.store.pipelines.runners.update(row.id, {
      lastSeenAt: new Date().toISOString(),
      agentVersion: clean(message.version, 32) || null,
      host: clean(facts.hostname, 253) || row.host,
      username: clean(facts.user, 64) || row.username,
      os,
    });
    // While this was saved, the runner may have been installed again elsewhere or removed, or
    // the connection may have dropped: then it is not signed in.
    if (!saved || saved.hostKey !== signedWith) throw fail(refused, 4403);
    if (socket.readyState !== socket.OPEN) throw fail("gone");

    // The newest connection wins: a restarted runner's old connection may not have noticed yet.
    this.links.get(row.id)?.close(4409, "Replaced by a newer connection.");
    const link = new AgentLink(
      socket,
      row.id,
      row.hostKeyFingerprint ?? agentKeyFingerprint(signedWith),
    );
    this.links.set(row.id, link);
    socket.send(JSON.stringify({ t: "ready", name: row.name }));
    this.log(`runner ${row.name} connected (${clean(message.version, 32)})`);
    for (const wake of this.waiting.get(row.id) ?? []) wake();
    return link;
  }

  /** How many commands each connected runner is running: for tests and the shutdown log. */
  get connected(): number {
    return [...this.links.values()].filter((link) => link.open).length;
  }
}

/** How to see the runner's service on the machine: its own system's way, or each one's when unknown. */
function serviceCheck(os: string | null | undefined): string {
  const known = RUNNER_AGENT_SERVICE[os as RunnerOs];
  if (known) return known.status;
  return `${RUNNER_AGENT_SERVICE.linux.status} (Linux), ${RUNNER_AGENT_SERVICE.macos.status} (macOS) or ${RUNNER_AGENT_SERVICE.windows.status} (Windows)`;
}
