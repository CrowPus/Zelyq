import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZelyqError } from "@zelyq/core";
import { runCaptured } from "./local.js";
import type { ExecResult } from "./types.js";

/**
 * The strict sandbox: how a server shared by strangers runs their code.
 *
 * On a managed (cloud) server every team must be assumed hostile, and every
 * container that runs a team's code — an app's container, a pipeline run, a
 * pipeline's services — is held to the same rules:
 *
 * - It runs under a stronger runtime than plain Docker: `runsc` (gVisor), a
 *   kernel of its own between the code and the server's kernel.
 * - It joins a network whose bridge is named `zsbx…`, and a firewall Zelyq
 *   installs says what any `zsbx…` bridge may reach: the internet, and never
 *   this server itself, a private network, or a cloud metadata address.
 *   Replies to a connection made to the container still flow.
 * - Nothing starts until that firewall is in place: it fails closed.
 *
 * Self-hosted servers are unchanged unless their owner turns this on with
 * `ZELYQ_STRICT_SANDBOX=true`. A managed server cannot turn it off.
 */
export interface SandboxOptions {
  strict: boolean;
  /** The OCI runtime for team containers, e.g. `runsc`. Unset: the engine's default. */
  runtime?: string;
  /** Name servers for a runtime with its own network stack (gVisor). */
  dns: string[];
}

export const NO_SANDBOX: SandboxOptions = { strict: false, dns: [] };

/** The network app containers join in strict mode (its bridge is `zsbx0`). */
export const SANDBOX_NETWORK = "zelyq-sandbox";
const BRIDGE_PREFIX = "zsbx";
const DEFAULT_DNS = ["1.1.1.1", "8.8.8.8"];

/** Addresses a team's container may never reach, besides this server itself. */
export const SANDBOX_BLOCKED_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

/** Docker's own runtime: not a sandbox of its own. */
export function isPlainRuntime(runtime: string | undefined): boolean {
  return !runtime || /(^|\.)runc(\.|$)/.test(runtime) || runtime === "io.containerd.runc.v2";
}

/**
 * The sandbox a server's environment asks for, refused at start when it
 * would not hold: a managed server that could run a team's code outside a
 * gVisor container is not allowed to start at all.
 */
export function sandboxFromEnv(env: NodeJS.ProcessEnv, runtimeKind: string): SandboxOptions {
  const managed = Boolean(env.ZELYQ_ACCOUNTS_URL?.trim());
  const flag = env.ZELYQ_STRICT_SANDBOX?.trim().toLowerCase();
  if (flag && !["true", "false"].includes(flag)) {
    throw new Error(
      `ZELYQ_STRICT_SANDBOX must be true or false, got "${env.ZELYQ_STRICT_SANDBOX}"`,
    );
  }
  if (managed && flag === "false") {
    throw new Error(
      "ZELYQ_STRICT_SANDBOX cannot be false on a managed server (ZELYQ_ACCOUNTS_URL is set): strangers share it.",
    );
  }
  const strict = managed || flag === "true";
  const runtime = env.ZELYQ_CONTAINER_RUNTIME?.trim() || undefined;
  const dns = (env.ZELYQ_SANDBOX_DNS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!strict) return { strict, ...(runtime ? { runtime } : {}), dns: [] };

  if (runtimeKind !== "container") {
    throw new Error(
      `The strict sandbox needs ZELYQ_RUNTIME=container, got "${runtimeKind}": ` +
        "with any other runtime the agent's commands run outside a container.",
    );
  }
  if (managed && !isSandboxRuntime(runtime)) {
    throw new Error(
      "A managed server runs teams' code under gVisor: install it (see docs/strict-sandbox.md) and set ZELYQ_CONTAINER_RUNTIME=runsc.",
    );
  }
  if (env.ZELYQ_PIPELINE_LOCAL_RUNNER?.trim() === "host") {
    throw new Error(
      'ZELYQ_PIPELINE_LOCAL_RUNNER=host runs pipelines on the server itself, which the strict sandbox does not allow. Use "container" or "off".',
    );
  }
  for (const server of dns) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(server) && !/^[0-9a-f:]+$/i.test(server)) {
      throw new Error(`ZELYQ_SANDBOX_DNS must be addresses separated by commas, got "${server}"`);
    }
  }
  return {
    strict,
    ...(runtime ? { runtime } : {}),
    dns: dns.length ? dns : DEFAULT_DNS,
  };
}

/** A network's bridge name: `zsbx` + 11 hex characters (Linux allows 15). */
export function sandboxBridgeName(network: string): string {
  if (network === SANDBOX_NETWORK) return `${BRIDGE_PREFIX}0`;
  return `${BRIDGE_PREFIX}${createHash("sha256").update(network).digest("hex").slice(0, 11)}`;
}

/** `docker network create` options that put a network behind the sandbox firewall. */
export function sandboxNetworkArgs(network: string, sandbox: SandboxOptions): string[] {
  return sandbox.strict
    ? ["--opt", `com.docker.network.bridge.name=${sandboxBridgeName(network)}`]
    : [];
}

/**
 * `docker run` options every team container gets from the sandbox: its
 * runtime, and — under a runtime with its own network stack, which cannot use
 * Docker's built-in name server — a resolv.conf naming real ones.
 */
export async function sandboxRunArgs(sandbox: SandboxOptions): Promise<string[]> {
  const args = sandbox.runtime ? ["--runtime", sandbox.runtime] : [];
  if (sandbox.strict && !isPlainRuntime(sandbox.runtime)) {
    args.push("--volume", `${await resolvConf(sandbox.dns)}:/etc/resolv.conf:ro`);
  }
  return args;
}

async function resolvConf(servers: string[]): Promise<string> {
  const text = `${servers.map((server) => `nameserver ${server}`).join("\n")}\n`;
  const file = path.join(
    os.tmpdir(),
    `zelyq-sandbox-resolv-${createHash("sha256").update(text).digest("hex").slice(0, 8)}.conf`,
  );
  const current = await fs.readFile(file, "utf8").catch(() => null);
  if (current !== text) {
    const temporary = `${file}.${process.pid}`;
    await fs.writeFile(temporary, text, { mode: 0o644 });
    await fs.rename(temporary, file);
  }
  return file;
}

/** How long a checked firewall is trusted before it is checked (and repaired) again. */
const RECHECK_MS = 2 * 60_000;
const engineState = new Map<string, { ready: Promise<void>; checkedAt: number }>();

/**
 * Before a team container starts: the runtime is installed and the firewall
 * is in place. Checked again when the last check is more than two minutes
 * old, because something else on the server (a firewall reload) can remove
 * rules Zelyq installed. A failure is never remembered as success: nothing
 * starts while it fails.
 */
export function ensureSandbox(engine: string, sandbox: SandboxOptions): Promise<void> {
  if (!sandbox.strict) return Promise.resolve();
  const key = `${engine}\0${sandbox.runtime ?? ""}`;
  const known = engineState.get(key);
  if (known && Date.now() - known.checkedAt < RECHECK_MS) return known.ready;
  const ready = (async () => {
    await requireRuntime(engine, sandbox.runtime);
    await installSandboxFirewall(engine);
  })().catch((error: unknown) => {
    engineState.delete(key);
    throw error;
  });
  engineState.set(key, { ready, checkedAt: Date.now() });
  return ready;
}

/** For tests: forget what `ensureSandbox` already did. */
export function resetSandboxForTests(): void {
  engineState.clear();
}

/** A runtime that puts a kernel of its own between a team's code and the server's. */
export function isSandboxRuntime(runtime: string | undefined): boolean {
  return Boolean(runtime && /^(runsc|kata)([-.].*)?$/.test(runtime));
}

async function requireRuntime(engine: string, runtime: string | undefined): Promise<void> {
  if (isPlainRuntime(runtime)) return;
  const info = await runCaptured(engine, ["info", "--format", "{{json .Runtimes}}"], {
    timeoutMs: 15_000,
    maxOutputBytes: 200_000,
  });
  let names: string[] = [];
  try {
    names = Object.keys(JSON.parse(info.stdout) as Record<string, unknown>);
  } catch {
    // Not JSON: the engine did not answer, said below.
  }
  if (!names.includes(runtime as string)) {
    throw new ZelyqError(
      "runtime_unavailable",
      `The container runtime "${runtime}" is not installed in ${engine} on this server, so no team code can run. ` +
        "Install gVisor (see docs/strict-sandbox.md).",
    );
  }
}

/**
 * The firewall, built in new chains and swapped in, so a reinstall never
 * leaves a moment with no rules; it ends by checking every hook it needs is
 * really there. Runs under a lock (the server and the agent both install
 * it). iptables rules are not kept over a reboot; this runs again before the
 * first container after every start, and every two minutes after.
 */
export function sandboxFirewallScript(): string {
  const any = `${BRIDGE_PREFIX}+`;
  const fill = (cmd: string, chain: string, lines: string[]) =>
    [`${cmd} -N ${chain}`, ...lines.map((line) => `${cmd} -A ${chain} ${line}`)].join("\n");
  const swap = (cmd: string, hook: string, chain: string) =>
    [
      `${cmd} -I ${hook} 1 -i ${any} -j ${chain}-NEW`,
      `while ${cmd} -D ${hook} -i ${any} -j ${chain} 2>/dev/null; do :; done`,
      `${cmd} -F ${chain} 2>/dev/null || true`,
      `${cmd} -X ${chain} 2>/dev/null || true`,
      `${cmd} -E ${chain}-NEW ${chain}`,
    ].join("\n");
  const clean = (cmd: string, hook: string, chain: string) =>
    [
      `while ${cmd} -D ${hook} -i ${any} -j ${chain}-NEW 2>/dev/null; do :; done`,
      `${cmd} -F ${chain}-NEW 2>/dev/null || true`,
      `${cmd} -X ${chain}-NEW 2>/dev/null || true`,
    ].join("\n");
  const replies = "-m conntrack --ctstate ESTABLISHED,RELATED -j RETURN";
  const v4 = "iptables -w";
  const v6 = "ip6tables -w";
  return [
    "set -e",
    // Docker's own firewall must be the one these tools see (the same
    // iptables backend); otherwise rules would land where nothing reads them.
    `${v4} -C FORWARD -j DOCKER-USER`,
    // A half-finished earlier install.
    clean(v4, "DOCKER-USER", "ZELYQ-SBX-FWD"),
    clean(v4, "INPUT", "ZELYQ-SBX-IN"),
    clean(v6, "FORWARD", "ZELYQ-SBX6-FWD"),
    clean(v6, "INPUT", "ZELYQ-SBX6-IN"),
    // IPv4 a team's container sends through this server to elsewhere.
    fill(v4, "ZELYQ-SBX-FWD-NEW", [
      replies,
      // App containers never talk to another sandbox container (icc=false says the same).
      `-i ${BRIDGE_PREFIX}0 -o ${any} -j REJECT`,
      // A run and its own services: Docker's isolation keeps one run from another's.
      `-o ${any} -j RETURN`,
      ...SANDBOX_BLOCKED_RANGES.map((range) => `-d ${range} -j REJECT`),
    ]),
    // IPv4 to this server itself: only replies.
    fill(v4, "ZELYQ-SBX-IN-NEW", [replies, "-j REJECT"]),
    // IPv6: none of it. The bridges have link-local addresses even though
    // the networks are IPv4-only, and services listening on [::] would answer.
    fill(v6, "ZELYQ-SBX6-FWD-NEW", ["-j REJECT"]),
    fill(v6, "ZELYQ-SBX6-IN-NEW", [replies, "-j REJECT"]),
    swap(v4, "DOCKER-USER", "ZELYQ-SBX-FWD"),
    swap(v4, "INPUT", "ZELYQ-SBX-IN"),
    swap(v6, "FORWARD", "ZELYQ-SBX6-FWD"),
    swap(v6, "INPUT", "ZELYQ-SBX6-IN"),
    // Everything really in place.
    `${v4} -C FORWARD -j DOCKER-USER`,
    `${v4} -C DOCKER-USER -i ${any} -j ZELYQ-SBX-FWD`,
    `${v4} -C INPUT -i ${any} -j ZELYQ-SBX-IN`,
    `${v6} -C FORWARD -i ${any} -j ZELYQ-SBX6-FWD`,
    `${v6} -C INPUT -i ${any} -j ZELYQ-SBX6-IN`,
    "echo ZELYQ_SANDBOX_FIREWALL_OK",
  ].join("\n");
}

async function installSandboxFirewall(engine: string): Promise<void> {
  await withFirewallHelper(
    engine,
    async (execIn) => {
      const result = await execIn([
        "flock",
        "/zelyq-lock/firewall",
        "sh",
        "-c",
        sandboxFirewallScript(),
      ]);
      if (result.exitCode !== 0 || !result.stdout.includes("ZELYQ_SANDBOX_FIREWALL_OK")) {
        const why = result.stderr.trim().split("\n").pop() || "unknown error";
        throw new ZelyqError(
          "runtime_unavailable",
          `Could not install the sandbox firewall, so no team code can run: ${
            /DOCKER-USER/.test(why) && /FORWARD/.test(why)
              ? "Docker's firewall is not visible to iptables (nftables backend or Docker's own firewall off). " +
                why
              : why
          }`,
        );
      }
    },
    { lock: true },
  );
}

const FIREWALL_HELPER_IMAGE = "alpine";

/**
 * Runs `fn` inside a short-lived, privileged helper container with
 * `iptables` and `ipset` installed: the one way Zelyq touches the host's
 * firewall. Started, used, removed, every time. It is Zelyq's own, never a
 * team's, so it runs under the engine's default runtime on the host network.
 */
export async function withFirewallHelper<T>(
  engine: string,
  fn: (execIn: (args: string[]) => Promise<ExecResult>) => Promise<T>,
  options: { lock?: boolean } = {},
): Promise<T> {
  const helper = `zelyq-firewall-setup-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const started = await runCaptured(
    engine,
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      helper,
      "--network",
      "host",
      "--cap-add",
      "NET_ADMIN",
      // One lock file on the host for every Zelyq process installing rules.
      ...(options.lock
        ? ["--volume", `${path.join(os.tmpdir(), "zelyq-sandbox-lock")}:/zelyq-lock`]
        : []),
      FIREWALL_HELPER_IMAGE,
      "sh",
      "-c",
      // Stays up long enough for `fn`'s exec calls. Neither tool is in the
      // base image, so the first thing this container does is fetch them,
      // over the host's own network.
      "apk add --no-cache iptables ipset bind-tools >/dev/null 2>&1 && sleep 60",
    ],
    { timeoutMs: 60_000, maxOutputBytes: 5_000 },
  );
  if (started.exitCode !== 0) {
    throw new ZelyqError(
      "runtime_unavailable",
      `Could not start the firewall setup helper: ${
        started.stderr.trim().split("\n")[0] ||
        started.stdout.trim().split("\n")[0] ||
        "unknown error"
      }`,
    );
  }
  try {
    // Waiting for `apk add` to finish, not for the container to exist.
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      const probe = await runCaptured(engine, ["exec", helper, "which", "iptables"], {
        timeoutMs: 5_000,
        maxOutputBytes: 1_000,
      });
      if (probe.exitCode === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) {
      throw new ZelyqError(
        "runtime_unavailable",
        "The firewall setup helper could not install iptables/ipset in time.",
      );
    }
    return await fn((args) =>
      runCaptured(engine, ["exec", helper, ...args], {
        timeoutMs: 20_000,
        maxOutputBytes: 4_000,
      }),
    );
  } finally {
    await runCaptured(engine, ["rm", "-f", helper], { timeoutMs: 30_000, maxOutputBytes: 1_000 });
  }
}

/**
 * Creates a sandbox network if it is missing, and refuses one that exists
 * under that name without a `zsbx` bridge: its containers would be outside
 * the firewall.
 */
export async function ensureSandboxNetwork(
  engine: string,
  network: string,
  extraArgs: string[] = [],
): Promise<void> {
  const bridge = sandboxBridgeName(network);
  const inspect = () =>
    runCaptured(
      engine,
      [
        "network",
        "inspect",
        network,
        "--format",
        '{{index .Options "com.docker.network.bridge.name"}} {{index .Options "com.docker.network.bridge.enable_icc"}} {{.Internal}}',
      ],
      { timeoutMs: 10_000, maxOutputBytes: 2_000 },
    );
  let found = await inspect();
  if (found.exitCode !== 0) {
    const created = await runCaptured(
      engine,
      [
        "network",
        "create",
        "--opt",
        "com.docker.network.bridge.enable_icc=false",
        "--opt",
        `com.docker.network.bridge.name=${bridge}`,
        ...extraArgs,
        network,
      ],
      { timeoutMs: 30_000, maxOutputBytes: 2_000 },
    );
    found = await inspect();
    if (found.exitCode !== 0) {
      throw new ZelyqError(
        "runtime_unavailable",
        `Could not create the "${network}" network: ${created.stderr.trim() || "unknown error"}`,
      );
    }
  }
  const [actualBridge, icc, internal] = found.stdout.trim().split(/\s+/);
  const wantInternal = extraArgs.includes("--internal");
  if (actualBridge !== bridge || icc !== "false" || (wantInternal && internal !== "true")) {
    throw new ZelyqError(
      "runtime_unavailable",
      `The "${network}" network exists without the sandbox bridge ${bridge}, containers kept apart (icc=false)${
        wantInternal ? " or no way out (internal)" : ""
      }. Remove it (docker network rm ${network}) and Zelyq makes it again.`,
    );
  }
}
