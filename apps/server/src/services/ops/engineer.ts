import {
  newId,
  OPS_TRUST_LEVELS,
  type OpsEngineer,
  type OpsTrust,
  opsEngineerUpdateSchema,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { OpsEngineerRow, Store } from "@zelyq/db";
import { z } from "zod";
import type { AccessControl } from "../access.js";

/** What a service account's password field holds: not a hash, so nothing can ever match it. */
const NO_PASSWORD = "service-account:no-sign-in";

export const OPS_NAME = "Ops";

/**
 * The team's engineer as an account (073, "who Ops is"): a real user, a team
 * admin, so every Zelyq service accepts it unchanged, and an account nobody
 * can sign in as. What it may actually do is decided by the gate, never by
 * this role.
 */
export class OpsEngineers {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
  ) {}

  /** The team's engineer; set up the first time an admin opens Ops. */
  async ensure(user: User, teamId: string): Promise<OpsEngineerRow> {
    const existing = await this.store.ops.engineers.findByTeam(teamId);
    if (existing) return existing;
    await this.access.requireTeamRole(user, teamId, "admin");
    const now = new Date().toISOString();
    const account = await this.store.users.create({
      id: newId("user"),
      email: `ops+${teamId}@service.invalid`,
      name: OPS_NAME,
      passwordHash: NO_PASSWORD,
      kind: "service",
    });
    await this.store.teams.addMember(teamId, account.id, "admin");
    const row: OpsEngineerRow = {
      id: newId("opsEngineer"),
      teamId,
      serviceUserId: account.id,
      paused: false,
      pausedBy: null,
      pausedAt: null,
      monthlyTokenCap: null,
      timeZone: "UTC",
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.ops.engineers.create(row);
    await this.access.recordChange(user, { teamId, action: "ops.set_up", detail: {} });
    return row;
  }

  async find(teamId: string): Promise<OpsEngineerRow | null> {
    return this.store.ops.engineers.findByTeam(teamId);
  }

  /** The account Ops acts as. */
  async account(engineer: OpsEngineerRow): Promise<User> {
    const user = await this.store.users.findById(engineer.serviceUserId);
    if (!user) throw new ZelyqError("internal", "The team's Ops account is missing.");
    return user;
  }

  async summary(user: User, teamId: string): Promise<OpsEngineer | null> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const row = await this.find(teamId);
    return row ? this.present(row) : null;
  }

  /** Pause, the spending cap, the time zone: a person's controls over Ops, admins only. */
  async update(user: User, teamId: string, raw: unknown): Promise<OpsEngineer> {
    await this.access.requireTeamRole(user, teamId, "admin");
    if (await this.store.users.isService(user.id)) {
      throw new ZelyqError("forbidden", "Ops cannot change its own limits.");
    }
    const input = opsEngineerUpdateSchema.parse(raw);
    const row = await this.ensure(user, teamId);
    const now = new Date().toISOString();
    const patch: Partial<OpsEngineerRow> = { updatedAt: now };
    if (input.paused !== undefined) {
      patch.paused = input.paused;
      patch.pausedBy = input.paused ? user.id : null;
      patch.pausedAt = input.paused ? now : null;
    }
    if (input.monthlyTokenCap !== undefined) patch.monthlyTokenCap = input.monthlyTokenCap;
    if (input.timeZone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
      } catch {
        throw ZelyqError.badRequest(`${input.timeZone} is not a time zone (try Europe/London).`);
      }
      patch.timeZone = input.timeZone;
    }
    const updated = (await this.store.ops.engineers.update(row.id, patch)) as OpsEngineerRow;
    await this.access.recordChange(user, {
      teamId,
      action: "ops.updated",
      detail: { fields: Object.keys(input) },
    });
    return this.present(updated);
  }

  /** How much Ops may do alone on each environment, as people set it. */
  async environments(user: User, teamId: string) {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const rows = await this.store.deploy.environments.listForTeam(teamId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      protected: row.protected,
      frozen: row.frozen,
      trust: (OPS_TRUST_LEVELS as readonly string[]).includes(row.opsTrust)
        ? (row.opsTrust as OpsTrust)
        : "ask",
    }));
  }

  /** One of Ops's own limits: an admin sets it, never Ops. */
  async setTrust(user: User, teamId: string, environmentId: string, raw: unknown) {
    await this.access.requireTeamRole(user, teamId, "admin");
    if (await this.store.users.isService(user.id)) {
      throw new ZelyqError("forbidden", "Ops cannot change its own limits.");
    }
    const trust = z.enum(OPS_TRUST_LEVELS).parse((raw as { trust?: unknown } | null)?.trust);
    const row = await this.store.deploy.environments.findById(environmentId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Environment", environmentId);
    await this.store.deploy.environments.update(row.id, {
      opsTrust: trust,
      updatedAt: new Date().toISOString(),
    });
    await this.access.recordChange(user, {
      teamId,
      action: "ops.updated",
      detail: { environment: row.name, trust },
    });
    return this.environments(user, teamId);
  }

  async present(row: OpsEngineerRow): Promise<OpsEngineer> {
    return {
      teamId: row.teamId,
      name: OPS_NAME,
      paused: row.paused,
      pausedAt: row.pausedAt,
      monthlyTokenCap: row.monthlyTokenCap,
      tokensThisMonth: await this.tokensThisMonth(row.teamId),
      timeZone: row.timeZone,
    };
  }

  /** Tokens Ops spent this calendar month (UTC), across all its jobs. */
  async tokensThisMonth(teamId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const jobs = await this.store.ops.jobs.listForTeam(teamId, 10_000);
    return jobs
      .filter((job) => job.createdAt >= start.toISOString())
      .reduce((sum, job) => sum + job.tokensIn + job.tokensOut, 0);
  }
}
