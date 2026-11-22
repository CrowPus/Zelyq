import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type AgentRunnerInput,
  agentRunnerInputSchema,
  automaticConcurrency,
  newId,
  RUNNER_OS,
  type RunnerAgentInstall,
  type RunnerDisk,
  type RunnerOs,
  type RunnerSummary,
  type RunnerTestResult,
  type SshRunnerInput,
  type SshRunnerUpdate,
  sshRunnerInputSchema,
  sshRunnerUpdateSchema,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { RunnerRow, Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";
import type { UsageService } from "../usage.js";
import { type AgentHub, agentKeyFingerprint, parseAgentPublicKey } from "./agents.js";
import type { TeamSshKeyService } from "./keys.js";
import { shellCommand } from "./scripts.js";
import {
  hostKeyFingerprint,
  type MachineFacts,
  probeMachine,
  type RunnerSession,
  SshError,
  SshSession,
  type SshTarget,
} from "./ssh.js";

/** How long an install code works: long enough to open a terminal on the machine. */
const INSTALL_CODE_MS = 60 * 60 * 1000;

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/**
 * SSH runners: the team's own machines (VMs, a Mac mini, a Windows box) that
 * pipelines run on. Adding one is three steps an admin sees in the page:
 *
 * 1. copy the team's public key into that machine's authorized_keys;
 * 2. add the runner (host, port, user);
 * 3. Test connection — the machine shows its fingerprint, the admin confirms
 *    it, and from then on the runner only talks to that exact machine.
 *
 * A runner is not used until its fingerprint is confirmed.
 *
 * Runners of kind "agent" go the other way: the machine connects out to Zelyq (agents.ts), so it
 * needs nothing open. An admin adds one here and gets a one-time install code; the machine makes
 * its own key and registers it with that code, and from then on only that key signs it in.
 */
export class RunnerService {
  /** What the team's plan allows (set by the app); none: no limits. */
  limits?: Pick<UsageService, "check">;
  /** The runner program machines download (its SHA-256), and Zelyq's public address if set. */
  agentProgram: { sha256: string } | null = null;
  publicUrl: string | null = null;
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly keys: TeamSshKeyService,
    readonly agents: AgentHub,
  ) {}

  async list(user: User, teamId: string): Promise<RunnerSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const rows = await this.store.pipelines.runners.listForTeam(teamId);
    return Promise.all(rows.map((row) => this.present(row)));
  }

  async get(user: User, teamId: string, runnerId: string): Promise<RunnerSummary> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    return this.present(await this.find(teamId, runnerId));
  }

  async create(user: User, teamId: string, raw: SshRunnerInput): Promise<RunnerSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    await this.limits?.check(teamId, "machines");
    const input = sshRunnerInputSchema.parse(raw);
    if (input.name === "local")
      throw ZelyqError.badRequest('"local" is the name of the built-in local runner.');
    if (await this.store.pipelines.runners.findByName(teamId, input.name)) {
      throw new ZelyqError("conflict", `There is already a runner called ${input.name}.`);
    }
    const now = new Date().toISOString();
    const row: RunnerRow = {
      id: newId("runner"),
      teamId,
      kind: "ssh",
      name: input.name,
      host: input.host,
      port: input.port ?? 22,
      username: input.username,
      labels: JSON.stringify(uniqueLabels(input.labels ?? [])),
      description: input.description ?? null,
      enabled: true,
      maxConcurrent: input.maxConcurrent ?? 0,
      cpus: null,
      memoryMb: null,
      os: null,
      shells: "[]",
      tools: "[]",
      hostKey: null,
      hostKeyFingerprint: null,
      lastTestAt: null,
      lastTestOk: null,
      lastLatencyMs: null,
      lastTestMessage: null,
      acceptedKeyFingerprint: null,
      agentCodeHash: null,
      agentCodeExpiresAt: null,
      lastSeenAt: null,
      agentVersion: null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.pipelines.runners.create(row);
    await this.access.recordChange(user, {
      teamId,
      action: "runner.added",
      detail: { label: row.name, host: `${row.username}@${row.host}:${row.port}` },
    });
    return this.present(row);
  }

  /**
   * A runner that connects out to Zelyq. It exists at once (pipelines can name it); it is used
   * once its machine has registered with the install code returned here, shown only this once.
   */
  async createAgent(
    user: User,
    teamId: string,
    raw: AgentRunnerInput,
    origin: string | null,
  ): Promise<{ runner: RunnerSummary; install: RunnerAgentInstall }> {
    await this.access.requireTeamRole(user, teamId, "admin");
    await this.limits?.check(teamId, "machines");
    const input = agentRunnerInputSchema.parse(raw);
    // Everything the install command needs is there, before anything is made.
    this.install("check", null, origin);
    if (input.name === "local")
      throw ZelyqError.badRequest('"local" is the name of the built-in local runner.');
    if (await this.store.pipelines.runners.findByName(teamId, input.name)) {
      throw new ZelyqError("conflict", `There is already a runner called ${input.name}.`);
    }
    const now = new Date().toISOString();
    const code = randomBytes(24).toString("base64url");
    const row: RunnerRow = {
      id: newId("runner"),
      teamId,
      kind: "agent",
      name: input.name,
      // The machine says its name and user when it connects.
      host: "",
      port: 0,
      username: "",
      labels: JSON.stringify(uniqueLabels(input.labels ?? [])),
      description: input.description ?? null,
      enabled: true,
      maxConcurrent: input.maxConcurrent ?? 0,
      cpus: null,
      memoryMb: null,
      os: null,
      shells: "[]",
      tools: "[]",
      hostKey: null,
      hostKeyFingerprint: null,
      lastTestAt: null,
      lastTestOk: null,
      lastLatencyMs: null,
      lastTestMessage: null,
      acceptedKeyFingerprint: null,
      agentCodeHash: hashCode(code),
      agentCodeExpiresAt: new Date(Date.now() + INSTALL_CODE_MS).toISOString(),
      lastSeenAt: null,
      agentVersion: null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.pipelines.runners.create(row);
    await this.access.recordChange(user, {
      teamId,
      action: "runner.added",
      detail: { label: row.name, host: "connects to Zelyq" },
    });
    return { runner: await this.present(row), install: this.install(code, row, origin) };
  }

  /**
   * A new install code for an agent runner: to install it on another machine, or again after the
   * machine was rebuilt. The machine that registers with it replaces the one before, whose
   * connection ends then.
   */
  async newInstallCode(
    user: User,
    teamId: string,
    runnerId: string,
    origin: string | null,
  ): Promise<RunnerAgentInstall> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.find(teamId, runnerId);
    if (row.kind !== "agent") throw ZelyqError.badRequest(`${row.name} is an SSH runner.`);
    this.install("check", null, origin);
    const code = randomBytes(24).toString("base64url");
    const updated = (await this.store.pipelines.runners.update(row.id, {
      agentCodeHash: hashCode(code),
      agentCodeExpiresAt: new Date(Date.now() + INSTALL_CODE_MS).toISOString(),
      updatedAt: new Date().toISOString(),
    })) as RunnerRow;
    await this.access.recordChange(user, {
      teamId,
      action: "runner.updated",
      detail: { label: row.name, fields: ["install code"] },
    });
    return this.install(code, updated, origin);
  }

  private install(code: string, row: RunnerRow | null, origin: string | null): RunnerAgentInstall {
    if (!this.agentProgram)
      throw new ZelyqError("internal", "The runner program is not built on this server.");
    const url = (this.publicUrl ?? origin ?? "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(url)) {
      throw ZelyqError.badRequest("Zelyq does not know its own address: set ZELYQ_PUBLIC_URL.");
    }
    return {
      code,
      expiresAt: row?.agentCodeExpiresAt ?? "",
      url,
      agentSha256: this.agentProgram.sha256,
    };
  }

  /**
   * The machine's side of the install: no user, only the one-time code. The code is spent here,
   * and the key it registers is the only one that signs this runner in from now on.
   */
  async registerAgent(input: {
    code: string;
    publicKey: string;
    version: string;
    facts: { hostname?: string; os?: string; user?: string };
  }): Promise<{ runnerId: string; name: string }> {
    const code = typeof input.code === "string" ? input.code.trim() : "";
    const refused = () =>
      ZelyqError.badRequest(
        "That install code is not valid any more (it works once, for an hour). Make a new one in Pipelines → Runners.",
      );
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) throw refused();
    const hash = hashCode(code);
    const row = await this.store.pipelines.runners.findByAgentCode(hash);
    if (
      !row ||
      row.kind !== "agent" ||
      !row.agentCodeHash ||
      !timingSafeEqual(Buffer.from(row.agentCodeHash), Buffer.from(hash)) ||
      !row.agentCodeExpiresAt ||
      Date.parse(row.agentCodeExpiresAt) < Date.now()
    ) {
      throw refused();
    }
    let key: string;
    try {
      key = parseAgentPublicKey(String(input.publicKey ?? ""));
    } catch {
      throw ZelyqError.badRequest("That is not the runner's public key.");
    }
    const clean = (value: unknown, max: number) =>
      typeof value === "string" ? value.replace(/[^\w.@:-]/g, "").slice(0, max) : "";
    const fingerprint = agentKeyFingerprint(key);
    const os = ["linux", "macos", "windows"].includes(String(input.facts?.os))
      ? String(input.facts.os)
      : null;
    const claimed = await this.store.pipelines.runners.claimAgentCode(row.id, hash, {
      hostKey: key,
      hostKeyFingerprint: fingerprint,
      agentCodeHash: null,
      agentCodeExpiresAt: null,
      host: clean(input.facts?.hostname, 253),
      username: clean(input.facts?.user, 64),
      os,
      agentVersion: clean(input.version, 32) || null,
      updatedAt: new Date().toISOString(),
    });
    // Another machine spent the code a moment earlier.
    if (!claimed) throw refused();
    // A machine installed before with another key: it is not this runner any more.
    this.agents.disconnect(row.id, "This runner was installed on another machine.");
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId: row.teamId,
      projectId: null,
      userId: null,
      actorName: `Runner “${row.name}”`,
      actorEmail: "",
      action: "runner.agent_registered",
      detail: { label: row.name, fingerprint, host: clean(input.facts?.hostname, 253) },
      createdAt: new Date().toISOString(),
    });
    return { runnerId: row.id, name: row.name };
  }

  /**
   * How pipelines, deploys and Ops reach a runner: over SSH, or down the connection an agent
   * made. Work that can wait (a run, a deploy) gives `waitMs` for an agent that is reconnecting
   * after a restart or a network blip; a page asking now does not wait.
   */
  async session(row: RunnerRow, waitMs = 0): Promise<RunnerSession> {
    if (row.kind === "agent") return this.agents.session(row, waitMs);
    return SshSession.open(await this.target(row));
  }

  async update(
    user: User,
    teamId: string,
    runnerId: string,
    raw: SshRunnerUpdate,
  ): Promise<RunnerSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const input = sshRunnerUpdateSchema.parse(raw);
    const row = await this.find(teamId, runnerId);
    if (
      row.kind === "agent" &&
      (input.host !== undefined || input.port !== undefined || input.username !== undefined)
    ) {
      throw ZelyqError.badRequest(
        `${row.name} connects to Zelyq itself: it has no address, port or SSH user to change.`,
      );
    }
    if (input.name && input.name !== row.name) {
      if (input.name === "local")
        throw ZelyqError.badRequest('"local" is the name of the built-in local runner.');
      if (await this.store.pipelines.runners.findByName(teamId, input.name)) {
        throw new ZelyqError("conflict", `There is already a runner called ${input.name}.`);
      }
    }
    const patch: Partial<RunnerRow> = { updatedAt: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.username !== undefined) patch.username = input.username;
    if (input.labels !== undefined) patch.labels = JSON.stringify(uniqueLabels(input.labels));
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.maxConcurrent !== undefined) patch.maxConcurrent = input.maxConcurrent;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    const moved =
      (input.host !== undefined && input.host !== row.host) ||
      (input.port !== undefined && input.port !== row.port);
    if (input.host !== undefined) patch.host = input.host;
    if (input.port !== undefined) patch.port = input.port;
    // A different address may be a different machine: confirm it again.
    if (moved)
      Object.assign(patch, {
        hostKey: null,
        hostKeyFingerprint: null,
        os: null,
        cpus: null,
        memoryMb: null,
        lastTestOk: null,
      });
    // The last test was of the old address or user; it says nothing now.
    if (moved || (input.username !== undefined && input.username !== row.username)) {
      Object.assign(patch, {
        lastTestAt: null,
        lastTestOk: null,
        lastTestMessage: null,
        lastLatencyMs: null,
      });
    }
    const updated = (await this.store.pipelines.runners.update(row.id, patch)) as RunnerRow;
    await this.access.recordChange(user, {
      teamId,
      action: "runner.updated",
      detail: { label: updated.name, fields: Object.keys(input) },
    });
    return this.present(updated);
  }

  async remove(user: User, teamId: string, runnerId: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.find(teamId, runnerId);
    // A waiting run's files are on this machine too.
    if ((await this.store.pipelines.runs.countRunningOn(row.id, ["running", "waiting"])) > 0) {
      throw new ZelyqError(
        "conflict",
        `${row.name} is running a pipeline. Cancel it or wait, then remove the runner.`,
      );
    }
    await this.store.pipelines.runners.remove(row.id);
    if (row.kind === "agent") this.agents.disconnect(row.id, "This runner was removed in Zelyq.");
    await this.access.recordChange(user, {
      teamId,
      action: "runner.removed",
      detail: { label: row.name },
    });
  }

  /**
   * Connects and looks at the machine. Before a fingerprint is pinned this is
   * the only connection allowed to an unknown host key, and it sends nothing
   * but probes. A pinned runner whose key changed reports the new fingerprint
   * so an admin can decide; it is never accepted silently.
   */
  async test(user: User, teamId: string, runnerId: string): Promise<RunnerTestResult> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.find(teamId, runnerId);
    if (row.kind === "agent") return this.testAgent(row);
    const keys = await this.keys.credentials(teamId);
    const base = { host: row.host, port: row.port, username: row.username, keys };
    let session: SshSession | null = null;
    let result: RunnerTestResult;
    try {
      try {
        session = await SshSession.open({ ...base, pinnedHostKey: row.hostKey });
      } catch (error) {
        if (!(error instanceof SshError) || error.kind !== "host_key_changed") throw error;
        session = await SshSession.open({ ...base, pinnedHostKey: null });
      }
      const facts = await probeMachine(session);
      const fingerprint = session.hostKeyFingerprint;
      const needsConfirmation = session.hostKey.toString("base64") !== row.hostKey;
      result = {
        ok: !needsConfirmation,
        hostKeyFingerprint: fingerprint,
        needsConfirmation,
        latencyMs: facts.latencyMs,
        os: facts.os,
        shells: facts.shells,
        tools: facts.tools,
        message: needsConfirmation
          ? row.hostKey
            ? `The machine's identity changed to ${fingerprint}. Confirm only if you reinstalled or replaced it.`
            : `Connected. Check that ${fingerprint} is this machine's fingerprint, then confirm it.`
          : `Connected to ${describe(facts)} in ${facts.latencyMs} ms.`,
      };
      await this.store.pipelines.runners.update(row.id, {
        os: facts.os,
        shells: JSON.stringify(facts.shells),
        tools: JSON.stringify(facts.tools),
        cpus: facts.cpus,
        memoryMb: facts.memoryMb,
        acceptedKeyFingerprint: session.acceptedKeyFingerprint,
        lastTestAt: new Date().toISOString(),
        lastTestOk: result.ok,
        lastLatencyMs: facts.latencyMs,
        lastTestMessage: result.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        ok: false,
        hostKeyFingerprint: null,
        needsConfirmation: false,
        latencyMs: null,
        os: null,
        shells: [],
        tools: [],
        message,
      };
      await this.store.pipelines.runners.update(row.id, {
        lastTestAt: new Date().toISOString(),
        lastTestOk: false,
        lastLatencyMs: null,
        lastTestMessage: message,
      });
    } finally {
      session?.close();
    }
    return result;
  }

  /** An agent: asks the machine over its own connection. Its key was registered with the code. */
  private async testAgent(row: RunnerRow): Promise<RunnerTestResult> {
    let result: RunnerTestResult;
    let session: RunnerSession | null = null;
    try {
      if (!row.hostKey) {
        throw new SshError(
          `${row.name} is not installed yet: run the install command on the machine.`,
          "unreachable",
        );
      }
      session = await this.agents.session(row, 0);
      const facts = await probeMachine(session);
      result = {
        ok: true,
        hostKeyFingerprint: row.hostKeyFingerprint,
        needsConfirmation: false,
        latencyMs: facts.latencyMs,
        os: facts.os,
        shells: facts.shells,
        tools: facts.tools,
        message: `Connected to ${describe(facts)} in ${facts.latencyMs} ms.`,
      };
      await this.store.pipelines.runners.update(row.id, {
        os: facts.os,
        shells: JSON.stringify(facts.shells),
        tools: JSON.stringify(facts.tools),
        cpus: facts.cpus,
        memoryMb: facts.memoryMb,
        acceptedKeyFingerprint: session.acceptedKeyFingerprint,
        lastTestAt: new Date().toISOString(),
        lastTestOk: true,
        lastLatencyMs: facts.latencyMs,
        lastTestMessage: result.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = {
        ok: false,
        hostKeyFingerprint: row.hostKeyFingerprint,
        needsConfirmation: false,
        latencyMs: null,
        os: null,
        shells: [],
        tools: [],
        message,
      };
      await this.store.pipelines.runners.update(row.id, {
        lastTestAt: new Date().toISOString(),
        lastTestOk: false,
        lastLatencyMs: null,
        lastTestMessage: message,
      });
    } finally {
      session?.close();
    }
    return result;
  }

  /**
   * Pins the machine's host key — only if it still shows the fingerprint the
   * admin was shown and confirmed, so nothing can slip in between.
   */
  async confirmHostKey(
    user: User,
    teamId: string,
    runnerId: string,
    fingerprint: string,
  ): Promise<RunnerSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.find(teamId, runnerId);
    if (row.kind === "agent") {
      throw ZelyqError.badRequest(
        `${row.name}'s key was registered with its install code: there is nothing to confirm.`,
      );
    }
    const keys = await this.keys.credentials(teamId);
    const session = await SshSession.open({
      host: row.host,
      port: row.port,
      username: row.username,
      keys,
      pinnedHostKey: null,
    });
    let facts: MachineFacts;
    try {
      if (session.hostKeyFingerprint !== fingerprint.trim()) {
        throw ZelyqError.badRequest(
          `The machine now shows ${session.hostKeyFingerprint}, not the fingerprint you confirmed. Test the connection again.`,
        );
      }
      facts = await probeMachine(session);
    } finally {
      session.close();
    }
    const updated = (await this.store.pipelines.runners.update(row.id, {
      hostKey: session.hostKey.toString("base64"),
      hostKeyFingerprint: hostKeyFingerprint(session.hostKey),
      os: facts.os,
      shells: JSON.stringify(facts.shells),
      tools: JSON.stringify(facts.tools),
      cpus: facts.cpus,
      memoryMb: facts.memoryMb,
      acceptedKeyFingerprint: session.acceptedKeyFingerprint,
      lastTestAt: new Date().toISOString(),
      lastTestOk: true,
      lastLatencyMs: facts.latencyMs,
      lastTestMessage: `Connected to ${describe(facts)} in ${facts.latencyMs} ms.`,
      updatedAt: new Date().toISOString(),
    })) as RunnerRow;
    await this.access.recordChange(user, {
      teamId,
      action: "runner.host_key_confirmed",
      detail: {
        label: row.name,
        fingerprint: updated.hostKeyFingerprint,
        previous: row.hostKeyFingerprint,
      },
    });
    return this.present(updated);
  }

  /** How much the tools and caches Zelyq keeps on the machine use, and the room left. */
  async disk(user: User, teamId: string, runnerId: string): Promise<RunnerDisk> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.find(teamId, runnerId);
    const session = await this.session(row);
    try {
      const windows = row.os === "windows";
      // Windows gets its script as input: a | inside a cmd.exe command line is not safe.
      const result = windows
        ? await capturing(
            session,
            shellCommand("powershell"),
            [
              "$z = Join-Path $env:USERPROFILE 'zelyq'",
              "function size($p) { if (Test-Path $p) { [int64](Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Sum Length).Sum } else { 0 } }",
              "$d = Get-PSDrive -Name $env:SystemDrive.Substring(0,1)",
              "Write-Output ('{0} {1} {2} {3}' -f (size (Join-Path $z 'tools')), (size (Join-Path $z 'cache')), $d.Free, ($d.Free + $d.Used))",
              "",
            ].join("\r\n"),
          )
        : await session.capture(
            `sh -c 'k() { [ -d "$1" ] && du -sk "$1" | cut -f1 || echo 0; }; set -- $(df -kP "$HOME" | tail -1); echo "$(( $(k "$HOME/zelyq/tools") * 1024 )) $(( $(k "$HOME/zelyq/cache") * 1024 )) $(( $4 * 1024 )) $(( $2 * 1024 ))"'`,
            60_000,
          );
      const [tools, cache, free, total] = result.stdout.trim().split(/\s+/).map(Number);
      return {
        toolsBytes: tools || 0,
        cacheBytes: cache || 0,
        freeBytes: Number.isFinite(free) ? (free ?? null) : null,
        totalBytes: Number.isFinite(total) ? (total ?? null) : null,
      };
    } finally {
      session.close();
    }
  }

  /** Removes the tools or the caches Zelyq keeps on the machine; the next run fetches again. */
  async clearDisk(
    user: User,
    teamId: string,
    runnerId: string,
    what: "tools" | "cache",
  ): Promise<RunnerDisk> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.find(teamId, runnerId);
    if ((await this.store.pipelines.runs.countRunningOn(row.id, ["running", "waiting"])) > 0) {
      throw new ZelyqError(
        "conflict",
        `${row.name} has a run in progress. Clear it once the run ends.`,
      );
    }
    const session = await this.session(row);
    try {
      if (row.os === "windows") {
        await capturing(
          session,
          shellCommand("powershell"),
          `Remove-Item -LiteralPath (Join-Path (Join-Path $env:USERPROFILE 'zelyq') '${what}') -Recurse -Force -ErrorAction SilentlyContinue\r\n`,
        );
      } else {
        await session.capture(`rm -rf "$HOME/zelyq/${what}"`, 120_000);
      }
    } finally {
      session.close();
    }
    await this.access.recordChange(user, {
      teamId,
      action: "runner.updated",
      detail: { label: row.name, cleared: what },
    });
    return this.disk(user, teamId, runnerId);
  }

  /** How the engine reaches a runner. Server-internal. */
  async target(row: RunnerRow): Promise<SshTarget> {
    if (!row.hostKey)
      throw ZelyqError.badRequest(`${row.name}'s fingerprint has not been confirmed yet.`);
    return {
      host: row.host,
      port: row.port,
      username: row.username,
      keys: await this.keys.credentials(row.teamId),
      pinnedHostKey: row.hostKey,
    };
  }

  private async find(teamId: string, runnerId: string): Promise<RunnerRow> {
    const row = await this.store.pipelines.runners.findById(runnerId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Runner", runnerId);
    return row;
  }

  private async present(row: RunnerRow): Promise<RunnerSummary> {
    return {
      id: row.id,
      teamId: row.teamId,
      kind: row.kind === "agent" ? "agent" : "ssh",
      online: row.kind === "agent" && this.agents.online(row.id),
      lastSeenAt: row.lastSeenAt,
      agentVersion: row.agentVersion,
      installPending:
        row.kind === "agent" &&
        !!row.agentCodeExpiresAt &&
        Date.parse(row.agentCodeExpiresAt) > Date.now(),
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      labels: parseList(row.labels),
      description: row.description,
      enabled: row.enabled,
      maxConcurrent: row.maxConcurrent,
      concurrency: runnerConcurrency(row),
      cpus: row.cpus,
      memoryMb: row.memoryMb,
      os: (RUNNER_OS as readonly string[]).includes(row.os ?? "") ? (row.os as RunnerOs) : null,
      shells: parseList(row.shells),
      tools: parseList(row.tools),
      hostKeyFingerprint: row.hostKeyFingerprint,
      lastTest: row.lastTestAt
        ? {
            at: row.lastTestAt,
            ok: row.lastTestOk === true,
            latencyMs: row.lastLatencyMs,
            message: row.lastTestMessage,
          }
        : null,
      acceptedKeyFingerprint: row.acceptedKeyFingerprint,
      busyRuns: await this.store.pipelines.runs.countRunningOn(row.id),
      createdAt: row.createdAt,
    };
  }
}

/**
 * Where people reach the machine, when Zelyq knows it: an SSH runner's address. A runner that
 * connects to Zelyq has none Zelyq could know (its host is only the name it gives itself): its
 * environments say their address.
 */
export function runnerAddress(runner: Pick<RunnerRow, "kind" | "host">): string | null {
  return runner.kind === "agent" ? null : runner.host || null;
}

export function parseList(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** How many runs a runner takes at once: the number set, or the automatic one. */
export function runnerConcurrency(
  row: Pick<RunnerRow, "maxConcurrent" | "cpus" | "memoryMb">,
): number {
  return row.maxConcurrent > 0 ? row.maxConcurrent : automaticConcurrency(row.cpus, row.memoryMb);
}

function uniqueLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))];
}

function describe(facts: MachineFacts): string {
  const os = facts.os === "macos" ? "macOS" : facts.os === "windows" ? "Windows" : "Linux";
  return `${os} (${[...facts.shells, ...facts.tools].join(", ") || "no tools found"})`;
}

/** Runs a command with a script on its input, and collects what it prints. */
async function capturing(
  session: RunnerSession,
  command: string,
  stdin: string,
): Promise<{ stdout: string }> {
  let stdout = "";
  await session.exec(command, {
    stdin,
    onStdout: (chunk) => {
      stdout += chunk.toString("utf8");
    },
  });
  return { stdout };
}
