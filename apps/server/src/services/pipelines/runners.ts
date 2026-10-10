import {
  newId,
  RUNNER_OS,
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
import type { TeamSshKeyService } from "./keys.js";
import {
  hostKeyFingerprint,
  type MachineFacts,
  probeMachine,
  SshError,
  SshSession,
  type SshTarget,
} from "./ssh.js";

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
 */
export class RunnerService {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly keys: TeamSshKeyService,
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
      maxConcurrent: input.maxConcurrent ?? 1,
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

  async update(
    user: User,
    teamId: string,
    runnerId: string,
    raw: SshRunnerUpdate,
  ): Promise<RunnerSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const input = sshRunnerUpdateSchema.parse(raw);
    const row = await this.find(teamId, runnerId);
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
      Object.assign(patch, { hostKey: null, hostKeyFingerprint: null, os: null, lastTestOk: null });
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
    if ((await this.store.pipelines.runs.countRunningOn(row.id)) > 0) {
      throw new ZelyqError(
        "conflict",
        `${row.name} is running a pipeline. Cancel it or wait, then remove the runner.`,
      );
    }
    await this.store.pipelines.runners.remove(row.id);
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
      kind: "ssh",
      name: row.name,
      host: row.host,
      port: row.port,
      username: row.username,
      labels: parseList(row.labels),
      description: row.description,
      enabled: row.enabled,
      maxConcurrent: row.maxConcurrent,
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

function uniqueLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))];
}

function describe(facts: MachineFacts): string {
  const os = facts.os === "macos" ? "macOS" : facts.os === "windows" ? "Windows" : "Linux";
  return `${os} (${[...facts.shells, ...facts.tools].join(", ") || "no tools found"})`;
}
