import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { RunnerOs } from "@zelyq/core";
import ssh2, { type ClientChannel } from "ssh2";

const { Client } = ssh2;
type Client = InstanceType<typeof Client>;

/**
 * SSH to a runner. Two rules make it safe to send secrets over:
 *
 * - **The machine must prove it is the one we pinned.** CrowFlow accepted any
 *   host key, so anyone in the middle could pose as the VM and receive every
 *   secret a pipeline sends. Here a connection is refused unless the host key
 *   matches the pinned one — except for an explicit, unpinned *test*, whose
 *   only purpose is to show the fingerprint to an admin for confirmation.
 * - **Only the team's own keys are offered.** No fallback to the server
 *   operator's ~/.ssh, no passwords.
 */

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  /** Usable team keys, newest first. A rotating key is still offered. */
  keys: { privateKey: string; fingerprint: string }[];
  /** The pinned host key, base64. Null only for an unpinned test. */
  pinnedHostKey: string | null;
}

export class SshError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "auth" | "host_key_changed" | "lost" | "timeout",
  ) {
    super(message);
  }
}

/** OpenSSH's form: "SHA256:" + unpadded base64 of the key blob's SHA-256. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

export interface ExecOptions {
  stdin?: string | Buffer | Readable;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  /** Closes the channel; the caller stops the remote process tree itself. */
  signal?: AbortSignal;
}

export class SshSession {
  private constructor(
    private readonly client: Client,
    readonly hostKey: Buffer,
    readonly acceptedKeyFingerprint: string,
  ) {}

  get hostKeyFingerprint(): string {
    return hostKeyFingerprint(this.hostKey);
  }

  static open(target: SshTarget, options: { timeoutMs?: number } = {}): Promise<SshSession> {
    if (target.keys.length === 0) {
      return Promise.reject(new SshError("This team has no SSH key yet.", "auth"));
    }
    return new Promise((resolve, reject) => {
      const client = new Client();
      let seenHostKey: Buffer | null = null;
      let mismatch = false;
      let attempt = -1;
      let settled = false;
      const fail = (error: SshError) => {
        if (settled) return;
        settled = true;
        client.end();
        reject(error);
      };
      client.on("ready", () => {
        if (settled) return;
        settled = true;
        const key = target.keys[attempt] ?? target.keys[0];
        resolve(new SshSession(client, seenHostKey as Buffer, key?.fingerprint ?? ""));
      });
      client.on("error", (error: Error & { level?: string }) => {
        if (mismatch) {
          fail(
            new SshError(
              `${target.host}'s identity changed. Its host key is now ${hostKeyFingerprint(seenHostKey as Buffer)}. ` +
                "Confirm the new fingerprint in Runners only if you reinstalled that machine.",
              "host_key_changed",
            ),
          );
          return;
        }
        if (error.level === "client-authentication") {
          fail(
            new SshError(
              `${target.host} refused the team's SSH key for ${target.username}. Add the public key to that user's authorized_keys.` +
                (target.username === "root"
                  ? " Many servers (Google Cloud, AWS, Azure images) refuse SSH as root even with the right key — use your normal user instead."
                  : ""),
              "auth",
            ),
          );
          return;
        }
        fail(
          new SshError(
            `Could not reach ${target.host}:${target.port}: ${error.message}`,
            "unreachable",
          ),
        );
      });
      client.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        readyTimeout: options.timeoutMs ?? 15_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
        hostVerifier: (key: Buffer) => {
          seenHostKey = Buffer.from(key);
          if (target.pinnedHostKey === null) return true;
          const ok = seenHostKey.toString("base64") === target.pinnedHostKey;
          if (!ok) mismatch = true;
          return ok;
        },
        // Offer each team key in turn — newest first — and nothing else.
        authHandler: (_methodsLeft, _partialSuccess, next) => {
          attempt += 1;
          const key = target.keys[attempt];
          if (!key) return next(false as never);
          next({ type: "publickey", username: target.username, key: key.privateKey } as never);
        },
      });
    });
  }

  /** Runs a command; resolves with its exit code once it ends. */
  exec(
    command: string,
    options: ExecOptions = {},
  ): Promise<{ code: number | null; signal: string | null }> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream: ClientChannel) => {
        if (error) {
          reject(new SshError(`The connection was lost: ${error.message}`, "lost"));
          return;
        }
        let code: number | null = null;
        let signal: string | null = null;
        const onAbort = () => stream.close();
        options.signal?.addEventListener("abort", onAbort, { once: true });
        stream.on("data", (chunk: Buffer) => options.onStdout?.(chunk));
        stream.stderr.on("data", (chunk: Buffer) => options.onStderr?.(chunk));
        stream.on("exit", (exitCode: number | null, exitSignal?: string) => {
          code = exitCode;
          signal = exitSignal ?? null;
        });
        stream.on("close", () => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve({ code, signal });
        });
        const input = options.stdin;
        if (input === undefined) stream.end();
        else if (typeof input === "string" || Buffer.isBuffer(input)) stream.end(input);
        else input.pipe(stream);
      });
    });
  }

  /** Runs a short command and collects its output. */
  async capture(
    command: string,
    timeoutMs = 20_000,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    let stdout = "";
    let stderr = "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const { code } = await this.exec(command, {
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

  close(): void {
    this.client.end();
  }
}

export interface MachineFacts {
  os: RunnerOs;
  home: string;
  shells: string[];
  tools: string[];
  latencyMs: number;
}

/**
 * What the machine is, found by asking it rather than assumed. Every probe is
 * wrapped in `sh -c` on POSIX so a login shell such as fish does not change
 * how it is read.
 */
export async function probeMachine(session: SshSession): Promise<MachineFacts> {
  const started = Date.now();
  const uname = await session.capture("uname -s");
  const latencyMs = Date.now() - started;
  const kernel = uname.stdout.trim();
  if (uname.code === 0 && (kernel === "Linux" || kernel === "Darwin")) {
    const os: RunnerOs = kernel === "Darwin" ? "macos" : "linux";
    const home = (await session.capture(`sh -c 'printf %s "$HOME"'`)).stdout.trim();
    const found = (
      await session.capture(
        `sh -c 'for c in bash sh zsh pwsh git docker tar; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done'`,
      )
    ).stdout
      .split(/\s+/)
      .filter(Boolean);
    return {
      os,
      home,
      shells: found.filter((name) => ["bash", "sh", "zsh", "pwsh"].includes(name)),
      tools: found.filter((name) => ["git", "docker", "tar"].includes(name)),
      latencyMs,
    };
  }
  // Only Windows' cmd.exe answers this with Windows_NT; every other shell
  // prints it back unchanged. It is also how Zelyq knows the SSH server starts
  // commands in cmd.exe, which its Windows commands are written for.
  const cmdOs = (await session.capture("echo %OS%")).stdout.trim();
  if (!/Windows_NT/i.test(cmdOs)) {
    // Git for Windows, MSYS2 and Cygwin put a uname on PATH that says this.
    if (/^(MSYS|MINGW|CYGWIN)/i.test(kernel) || /\$env:OS|Windows/i.test(cmdOs)) {
      throw new SshError(
        `This is a Windows machine, but its SSH server starts commands in another shell (it answered "${kernel || cmdOs}"), not cmd.exe. ` +
          "Zelyq needs the standard one: in an administrator PowerShell on the machine, run " +
          "Remove-ItemProperty -Path HKLM:\\SOFTWARE\\OpenSSH -Name DefaultShell; Restart-Service sshd",
        "unreachable",
      );
    }
    throw new SshError(
      `Could not tell what ${kernel || "this machine"} is (it answered "${cmdOs.slice(0, 80)}"). Linux, macOS and Windows are supported.`,
      "unreachable",
    );
  }
  // Already in cmd.exe: a second "cmd /c" would leave a stray quote behind.
  const home = (await session.capture("echo %USERPROFILE%")).stdout.trim().replaceAll('"', "");
  const where = (await session.capture("where pwsh powershell git docker tar 2>nul")).stdout;
  const found = new Set(
    where
      .split(/\r?\n/)
      .map(
        (line) =>
          line
            .trim()
            .split("\\")
            .pop()
            ?.toLowerCase()
            .replace(/\.exe$/, "") ?? "",
      )
      .filter(Boolean),
  );
  return {
    os: "windows",
    home,
    shells: ["pwsh", "powershell"].filter((name) => found.has(name)),
    tools: ["git", "docker", "tar"].filter((name) => found.has(name)),
    latencyMs,
  };
}
