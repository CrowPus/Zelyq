import { newId, type TeamStatus, teamStatusSchema, type User, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import { z } from "zod";

/**
 * A team's status, and what each allows. One check, used everywhere:
 *
 * | status      | still works                                    | stops                         |
 * |-------------|------------------------------------------------|-------------------------------|
 * | active      | everything                                     | —                             |
 * | paused      | looking, downloading, deleting, freeing space; | building, previews, runs,     |
 * |             | the owner resumes it themselves                | anything new                  |
 * | read_only   | the same, but only the admin API lifts it      | the same                      |
 * | suspended   | nothing: its members see why                   | everything                    |
 *
 * Paused is for a team nobody used; read-only for one over its plan after
 * cancelling; suspended for abuse. Data is never touched by any of them.
 */

export const setTeamStatusSchema = z
  .object({
    status: teamStatusSchema,
    /** For the record: "unused", "cancelled", "abuse"… */
    reason: z.string().trim().max(100).optional(),
    /** What the team's members are shown; a plain default otherwise. */
    message: z.string().trim().max(500).optional(),
  })
  .strict();

const DEFAULT_MESSAGE: Record<Exclude<TeamStatus, "active">, string> = {
  paused:
    "This team is paused because it was not used for a while. Its apps and files are kept. Resume it to carry on.",
  read_only:
    "This team is read-only: nothing new can be made or run. Everything it has can still be opened, downloaded or deleted.",
  suspended: "This team is suspended.",
};

/** Changes allowed while a team is paused or read-only: taking away, stopping, resuming. */
function allowedWhileFrozen(method: string, route: string): boolean {
  if (method === "DELETE") return true;
  return /\/(resume|free-space|stop|cancel)$/.test(route);
}

const TOUCH_EVERY_MS = 10 * 60 * 1000;
const CACHE_MS = 5_000;

export class TeamStatusService {
  private readonly cache = new Map<string, { status: TeamStatus; message: string; at: number }>();
  private readonly touchedTeams = new Map<string, number>();
  private readonly touchedPeople = new Map<string, number>();
  /** Stops an app's preview: a team that is not active runs nothing. */
  stopPreview?: (projectId: string) => Promise<unknown>;
  /** Told when a team's status changes (events to an account service). */
  onChange?: (teamId: string, status: TeamStatus, by: "admin_api" | "owner") => void;

  constructor(private readonly store: Store) {}

  async status(teamId: string): Promise<{ status: TeamStatus; message: string }> {
    const cached = this.cache.get(teamId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached;
    const state = await this.store.teams.stateOf(teamId);
    const status = state?.status ?? "active";
    const entry = {
      status,
      message: status === "active" ? "" : (state?.message ?? DEFAULT_MESSAGE[status]),
      at: Date.now(),
    };
    this.cache.set(teamId, entry);
    return entry;
  }

  /**
   * Whether a person's call may go ahead in this team. Reading is refused
   * only for a suspended team; a change, while it is not active, unless it
   * takes something away, stops something, or resumes the team.
   */
  async enforce(teamId: string, method: string, route: string): Promise<void> {
    const { status, message } = await this.status(teamId);
    if (status === "active") return;
    const reading = method === "GET" || method === "HEAD";
    if (status === "suspended" || (!reading && !allowedWhileFrozen(method, route))) {
      throw new ZelyqError("forbidden", message, { reason: `team_${status}`, status });
    }
  }

  /** For work nobody is waiting on (a schedule, a webhook, the agent): why it may not run, or null. */
  async whyNotRunnable(teamId: string): Promise<string | null> {
    const { status, message } = await this.status(teamId);
    return status === "active" ? null : message;
  }

  async requireRunnable(teamId: string): Promise<void> {
    const { status, message } = await this.status(teamId);
    if (status !== "active") {
      throw new ZelyqError("forbidden", message, { reason: `team_${status}`, status });
    }
  }

  /** Set by the server's administrator or an account service (admin API). */
  async set(teamId: string, raw: unknown) {
    const input = setTeamStatusSchema.parse(raw);
    if (!(await this.store.teams.findById(teamId))) throw ZelyqError.notFound("Team", teamId);
    await this.store.teams.setStatus(teamId, {
      status: input.status,
      reason: input.status === "active" ? null : (input.reason ?? null),
      message: input.status === "active" ? null : (input.message ?? null),
    });
    this.cache.delete(teamId);
    if (input.status !== "active") await this.stopEverything(teamId);
    this.onChange?.(teamId, input.status, "admin_api");
    return await this.describe(teamId);
  }

  /** The owner (or a team admin) brings a paused team back: paused only, never read-only or suspended. */
  async resume(user: User, teamId: string) {
    const role = await this.store.teams.roleOf(teamId, user.id);
    if (role !== "owner" && role !== "admin" && user.instanceRole !== "admin") {
      throw new ZelyqError("forbidden", "Only the team's owner or an admin can resume it.");
    }
    const { status, message } = await this.status(teamId);
    if (status === "active") return await this.describe(teamId);
    if (status !== "paused") {
      throw new ZelyqError("forbidden", message, { reason: `team_${status}`, status });
    }
    await this.store.teams.setStatus(teamId, { status: "active", reason: null, message: null });
    this.cache.delete(teamId);
    await this.touch(teamId, user.id, true);
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId,
      projectId: null,
      userId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      action: "team.resumed",
      detail: {},
      createdAt: new Date().toISOString(),
    });
    this.onChange?.(teamId, "active", "owner");
    return await this.describe(teamId);
  }

  async describe(teamId: string) {
    const state = await this.store.teams.stateOf(teamId);
    if (!state) throw ZelyqError.notFound("Team", teamId);
    return {
      teamId,
      status: state.status,
      reason: state.reason,
      message: state.status === "active" ? null : (state.message ?? DEFAULT_MESSAGE[state.status]),
      changedAt: state.changedAt,
      lastActiveAt: state.lastActiveAt,
    };
  }

  /**
   * A person did something: the team was used (at most one write every ten
   * minutes). Work nobody started (a schedule) does not count.
   */
  async touch(teamId: string | null, userId: string | null, force = false): Promise<void> {
    const now = Date.now();
    const at = new Date(now).toISOString();
    if (userId && (force || now - (this.touchedPeople.get(userId) ?? 0) > TOUCH_EVERY_MS)) {
      this.touchedPeople.set(userId, now);
      await this.store.users.touch(userId, at);
    }
    if (
      teamId &&
      userId &&
      (force || now - (this.touchedTeams.get(teamId) ?? 0) > TOUCH_EVERY_MS)
    ) {
      this.touchedTeams.set(teamId, now);
      await this.store.teams.touch(teamId, at);
    }
  }

  /** Nothing of a team that is not active keeps running: its previews stop. */
  private async stopEverything(teamId: string): Promise<void> {
    for (const project of await this.store.projects.listForTeams([teamId])) {
      await this.stopPreview?.(project.id).catch(() => undefined);
    }
  }
}
