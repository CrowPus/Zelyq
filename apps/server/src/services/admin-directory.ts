import { randomBytes, randomUUID } from "node:crypto";
import {
  newId,
  type Role,
  type Team,
  type TeamStatus,
  teamStatusSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import { z } from "zod";
import type { AccountService } from "./accounts.js";
import { type AuthService, isServiceEmail } from "./auth.js";
import type { ProductActivity } from "./product-activity.js";
import type { TeamStatusService } from "./team-status.js";
import type { UsageService } from "./usage.js";

/**
 * People and teams, as an outside system (an account service) manages them
 * through the admin API. The same rules as the screens: a team's Ops engineer
 * is never touched, nothing is left without an owner, and the server's own
 * administrators cannot be removed from outside.
 */

export const ensureAccountSchema = z
  .object({
    email: z.string().trim().email().max(320),
    name: z.string().trim().min(1).max(80).optional(),
    /** The service's own id for the person: the `sub` it signs them in with. */
    externalId: z.string().trim().min(1).max(255),
    /** Defaults to this server's single sign-on issuer. */
    issuer: z.string().trim().url().max(500).optional(),
    /** Their first team; `false`: none. */
    team: z
      .union([
        z.literal(false),
        z.object({
          name: z.string().trim().min(1).max(80).optional(),
          plan: z.string().min(1).optional(),
        }),
      ])
      .optional(),
  })
  .strict();

export const updateAccountSchema = z
  .object({
    email: z.string().trim().email().max(320).optional(),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((value) => value.email !== undefined || value.name !== undefined, {
    message: "Give an email or a name to change.",
  });

export const accountStatusSchema = z
  .object({
    status: z.enum(["active", "suspended"]),
    /** Shown to the person when they try to sign in. */
    reason: z.string().trim().max(300).optional(),
  })
  .strict();

export const createTeamByKeySchema = z
  .object({
    ownerId: z.string().min(1),
    name: z.string().trim().min(1).max(80),
    plan: z.string().min(1).optional(),
  })
  .strict();

export interface AccountSummary {
  id: string;
  email: string;
  name: string;
  instanceRole: "admin" | "member";
  status: "active" | "suspended";
  statusReason: string | null;
  createdAt: string;
  /** When the person last signed in or did something. */
  lastSeenAt: string | null;
  externalIds: Array<{ issuer: string; subject: string }>;
  teams: Array<{ id: string; name: string; role: Role; plan: { id: string; name: string } }>;
}

export interface TeamSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  status: TeamStatus;
  statusReason: string | null;
  statusMessage: string | null;
  statusChangedAt: string | null;
  /** When a person last did something in the team. */
  lastActiveAt: string | null;
  plan: { id: string; name: string };
  members: number;
  owners: Array<{ id: string; email: string }>;
  apps: number;
  storageMb: number;
}

export class AdminDirectory {
  /** Product activity: people and teams made through the API count as sign-ups. */
  activity?: ProductActivity;
  teamStatus?: TeamStatusService;

  constructor(
    private readonly store: Store,
    private readonly auth: AuthService,
    private readonly accounts: AccountService,
    private readonly usage: UsageService,
  ) {}

  // ------------------------------------------------------------------ accounts

  /**
   * Make sure a person exists, known by the service's id for them. The same
   * `externalId` again returns the same person. An account that already has
   * the email (made on this server before) is linked, not duplicated.
   */
  async ensureAccount(raw: unknown): Promise<{
    created: boolean;
    account: AccountSummary;
    team: { id: string; name: string; plan: { id: string; name: string } } | null;
  }> {
    const input = ensureAccountSchema.parse(raw);
    const issuer = input.issuer ?? this.auth.oidcIssuer();
    if (!issuer) {
      throw ZelyqError.badRequest(
        "This server has no single sign-on issuer to link the person to: set ZELYQ_OIDC_ISSUER, or send `issuer`.",
      );
    }
    const email = input.email.toLowerCase();
    if (isServiceEmail(email)) {
      throw ZelyqError.badRequest("That address is reserved for Zelyq's own accounts.");
    }
    const firstPlan = input.team === false ? undefined : input.team?.plan;
    if (firstPlan) await this.requirePlan(firstPlan);

    const linked = await this.store.oidcIdentities.find(issuer, input.externalId);
    if (linked) {
      const account = await this.account(linked.userId);
      return { created: false, account, team: this.firstOwnedTeam(account) };
    }

    const existing = await this.store.users.findByEmail(email);
    if (existing?.kind === "service") {
      throw ZelyqError.badRequest("That address is reserved for Zelyq's own accounts.");
    }
    if (existing) {
      await this.store.oidcIdentities.create({
        id: randomUUID(),
        userId: existing.id,
        issuer,
        subject: input.externalId,
      });
      const account = await this.account(existing.id);
      return { created: false, account, team: this.firstOwnedTeam(account) };
    }

    const name = input.name ?? email.split("@")[0]!.slice(0, 80);
    const user = await this.store.users.create({
      id: newId("user"),
      email,
      name,
      // Nobody signs in to this account with a password: only through the service.
      passwordHash: `oidc$${randomBytes(32).toString("hex")}`,
      instanceRole: "member",
    });
    await this.store.oidcIdentities.create({
      id: randomUUID(),
      userId: user.id,
      issuer,
      subject: input.externalId,
    });
    let team: { id: string; name: string; plan: { id: string; name: string } } | null = null;
    if (input.team !== false) {
      const made = await this.makeTeam(
        user.id,
        input.team?.name ?? `${name}'s team`,
        input.team?.plan,
      );
      team = { id: made.id, name: made.name, plan: made.plan };
    }
    // With the team they start in: what the activation funnel follows.
    this.activity?.record("account.created", {
      userId: user.id,
      teamId: team?.id ?? null,
      detail: { via: "admin_api" },
    });
    return { created: true, account: await this.account(user.id), team };
  }

  async account(id: string): Promise<AccountSummary> {
    const user = await this.store.users.findById(id);
    if (!user || (await this.store.users.isService(id))) throw ZelyqError.notFound("Account", id);
    const state = await this.store.users.statusOf(id);
    const teams = await this.store.teams.listForUser(id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      instanceRole: user.instanceRole,
      status: state?.status === "suspended" ? "suspended" : "active",
      statusReason: state?.reason ?? null,
      createdAt: user.createdAt,
      lastSeenAt: await this.store.users.lastSeenOf(id),
      externalIds: await this.store.oidcIdentities.listForUser(id),
      teams: await Promise.all(
        teams.map(async (team) => {
          const plan = await this.usage.planOf(team.id);
          return {
            id: team.id,
            name: team.name,
            role: team.role,
            plan: { id: plan.id, name: plan.name },
          };
        }),
      ),
    };
  }

  /** By email, or by the service's id (with this server's issuer, or the one given). */
  /** Everyone, newest first, a page at a time; `q` finds a part of a name or email. */
  async listAccounts(query: { cursor?: string; limit?: string; q?: string; status?: string }) {
    if (query.status && query.status !== "active" && query.status !== "suspended") {
      throw ZelyqError.badRequest("`status` is active or suspended.");
    }
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "50", 10) || 50, 1), 200);
    let last: { id: string; createdAt: string } | null = null;
    if (query.cursor) {
      const after = await this.store.users.findById(query.cursor);
      if (!after) throw ZelyqError.badRequest("That cursor is not a person on this server.");
      last = after;
    }
    const accounts: AccountSummary[] = [];
    while (accounts.length < limit) {
      const page = await this.store.users.listPage(last, limit, query.q);
      for (const user of page) {
        last = user;
        const summary = await this.account(user.id);
        if (!query.status || summary.status === query.status) accounts.push(summary);
        if (accounts.length === limit) break;
      }
      if (page.length < limit) break;
    }
    const more = last !== null && (await this.store.users.listPage(last, 1, query.q)).length > 0;
    return { accounts, nextCursor: more ? last!.id : null };
  }

  async findAccount(query: {
    email?: string;
    externalId?: string;
    issuer?: string;
  }): Promise<AccountSummary> {
    if (query.email) {
      const found = await this.store.users.findByEmail(query.email.trim());
      if (!found || found.kind === "service") throw ZelyqError.notFound("Account", query.email);
      return await this.account(found.id);
    }
    if (query.externalId) {
      const issuer = query.issuer ?? this.auth.oidcIssuer();
      const linked = issuer ? await this.store.oidcIdentities.find(issuer, query.externalId) : null;
      if (!linked) throw ZelyqError.notFound("Account", query.externalId);
      return await this.account(linked.userId);
    }
    throw ZelyqError.badRequest("Look an account up by ?email= or ?externalId=.");
  }

  async updateAccount(id: string, raw: unknown): Promise<AccountSummary> {
    const input = updateAccountSchema.parse(raw);
    await this.account(id);
    if (input.email !== undefined) {
      const email = input.email.toLowerCase();
      if (isServiceEmail(email)) {
        throw ZelyqError.badRequest("That address is reserved for Zelyq's own accounts.");
      }
      const holder = await this.store.users.findByEmail(email);
      if (holder && holder.id !== id) {
        throw new ZelyqError("conflict", "Another account already uses that email.");
      }
    }
    await this.store.users.updateProfile(id, { name: input.name, email: input.email });
    return await this.account(id);
  }

  /** Ends every session the person has on this server. */
  async signOut(id: string): Promise<{ signedOut: true }> {
    await this.account(id);
    await this.store.authSessions.removeForUser(id);
    return { signedOut: true };
  }

  async setAccountStatus(id: string, raw: unknown): Promise<AccountSummary> {
    const input = accountStatusSchema.parse(raw);
    const account = await this.account(id);
    if (input.status === "suspended" && account.instanceRole === "admin") {
      throw new ZelyqError(
        "forbidden",
        "The server's own administrators cannot be suspended through the admin API.",
      );
    }
    await this.store.users.setStatus(
      id,
      input.status,
      input.status === "suspended" ? (input.reason ?? null) : null,
    );
    if (input.status === "suspended") await this.store.authSessions.removeForUser(id);
    return await this.account(id);
  }

  /** `look`: only what would go. The server's own administrators are never deleted from outside. */
  async deleteAccount(id: string, look: boolean) {
    const account = await this.account(id);
    if (account.instanceRole === "admin") {
      throw new ZelyqError(
        "forbidden",
        "The server's own administrators cannot be deleted through the admin API.",
      );
    }
    const plan = look
      ? await this.accounts.deletionPlan(id)
      : await this.accounts.removeAccount(id);
    return {
      deleted: !look,
      account: { id: account.id, email: account.email },
      teamsRemoved: plan.teamsRemoved,
      teamsKept: plan.teamsKept,
    };
  }

  // ------------------------------------------------------------------ teams

  async createTeam(raw: unknown): Promise<TeamSummary> {
    const input = createTeamByKeySchema.parse(raw);
    await this.account(input.ownerId);
    if (input.plan) await this.requirePlan(input.plan);
    const made = await this.makeTeam(input.ownerId, input.name, input.plan);
    return await this.team(made.id);
  }

  async team(id: string): Promise<TeamSummary> {
    const team = await this.store.teams.findById(id);
    if (!team) throw ZelyqError.notFound("Team", id);
    return await this.summarize(team);
  }

  async teamDetail(id: string) {
    const summary = await this.team(id);
    const members = await this.store.teams.listMembers(id);
    return {
      ...summary,
      memberList: members.map((member) => ({
        id: member.userId,
        email: member.email,
        name: member.name,
        role: member.role,
        joinedAt: member.joinedAt,
      })),
    };
  }

  /** Every team, oldest first, a page at a time. `cursor` is the last id of the page before. */
  async listTeams(query: {
    cursor?: string;
    limit?: string;
    plan?: string;
    status?: string;
    /** Teams nobody has used since this date. */
    inactiveSince?: string;
  }) {
    if (query.status && !teamStatusSchema.safeParse(query.status).success) {
      throw ZelyqError.badRequest("`status` is active, paused, read_only or suspended.");
    }
    const quiet = query.inactiveSince ? new Date(query.inactiveSince) : null;
    if (quiet && Number.isNaN(quiet.getTime())) {
      throw ZelyqError.badRequest("`inactiveSince` must be a date.");
    }
    const matches = (summary: TeamSummary) =>
      (!query.plan || summary.plan.id === query.plan) &&
      (!query.status || summary.status === query.status) &&
      (!quiet || !summary.lastActiveAt || summary.lastActiveAt < quiet.toISOString());
    const limit = Math.min(Math.max(Number.parseInt(query.limit ?? "100", 10) || 100, 1), 500);
    let after: Team | null = null;
    if (query.cursor) {
      after = await this.store.teams.findById(query.cursor);
      if (!after) throw ZelyqError.badRequest("That cursor is not a team on this server.");
    }
    const teams: TeamSummary[] = [];
    let last: Team | null = after;
    // Filtering by plan reads on until the page is full or the teams run out.
    while (teams.length < limit) {
      const page = await this.store.teams.listPage(last, limit);
      for (const team of page) {
        last = team;
        const summary = await this.summarize(team);
        if (matches(summary)) teams.push(summary);
        if (teams.length === limit) break;
      }
      if (page.length < limit) break;
    }
    const more = last !== null && (await this.store.teams.listPage(last, 1)).length > 0;
    return { teams, nextCursor: more ? last!.id : null };
  }

  /** Every team's use against its plan, a page at a time: for a daily run. */
  async listUsage(query: {
    cursor?: string;
    limit?: string;
    status?: string;
    inactiveSince?: string;
  }) {
    const page = await this.listTeams(query);
    const usage = await Promise.all(
      page.teams.map(async (team) => {
        const used = await this.usage.usage(team.id);
        return {
          teamId: team.id,
          plan: used.plan,
          lines: used.lines.map((line) => ({ key: line.key, used: line.used, limit: line.limit })),
          status: team.status,
          lastActiveAt: team.lastActiveAt,
          measuredAt: used.measuredAt,
        };
      }),
    );
    return { usage, nextCursor: page.nextCursor };
  }

  /** Set by an account service: paused, read-only, suspended, or active again. */
  async setTeamStatus(id: string, raw: unknown) {
    if (!this.teamStatus) throw new ZelyqError("internal", "Team status is not available.");
    await this.team(id);
    await this.teamStatus.set(id, raw);
    return await this.team(id);
  }

  /**
   * Deletes a whole team, its apps and their files. Refused while the team is
   * active (pause, make read-only or suspend it first), so a live team is never
   * deleted by one mistaken call. `look`: only what would go.
   */
  async deleteTeam(id: string, look: boolean) {
    const summary = await this.team(id);
    if (summary.status === "active") {
      throw new ZelyqError(
        "conflict",
        "This team is active. Pause it, make it read-only or suspend it before deleting it.",
      );
    }
    const members = await this.store.teams.listMembers(id);
    const apps = (await this.store.projects.listForTeams([id])).length;
    if (!look) await this.accounts.removeTeam(id);
    return {
      deleted: !look,
      team: { id: summary.id, name: summary.name },
      apps,
      members: members.length,
      storageMb: summary.storageMb,
    };
  }

  // ------------------------------------------------------------------ inside

  private async makeTeam(ownerId: string, name: string, plan?: string) {
    const team = await this.store.teams.create({
      id: newId("team"),
      name: name.trim(),
      slug: await this.auth.freeTeamSlug(name),
    });
    await this.store.teams.addMember(team.id, ownerId, "owner");
    if (plan) await this.usage.setPlan(team.id, plan);
    this.activity?.record("team.created", {
      userId: ownerId,
      teamId: team.id,
      detail: { via: "admin_api" },
    });
    const chosen = await this.usage.planOf(team.id);
    return { id: team.id, name: team.name, plan: { id: chosen.id, name: chosen.name } };
  }

  private async summarize(team: Team): Promise<TeamSummary> {
    const members = await this.store.teams.listMembers(team.id);
    const state = await this.store.teams.stateOf(team.id);
    const used = await this.usage.usage(team.id);
    const line = (key: string) => used.lines.find((entry) => entry.key === key)?.used ?? 0;
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      createdAt: team.createdAt,
      status: state?.status ?? "active",
      statusReason: state?.reason ?? null,
      statusMessage: state?.message ?? null,
      statusChangedAt: state?.changedAt ?? null,
      lastActiveAt: state?.lastActiveAt ?? null,
      plan: used.plan,
      members: members.length,
      owners: members
        .filter((member) => member.role === "owner")
        .map((member) => ({ id: member.userId, email: member.email })),
      apps: line("apps"),
      storageMb: line("storageMb"),
    };
  }

  private firstOwnedTeam(account: AccountSummary) {
    const team = account.teams.find((entry) => entry.role === "owner") ?? null;
    return team ? { id: team.id, name: team.name, plan: team.plan } : null;
  }

  private async requirePlan(planId: string): Promise<void> {
    if (!(await this.usage.allPlans()).some((plan) => plan.id === planId)) {
      throw ZelyqError.notFound("Plan", planId);
    }
  }
}
