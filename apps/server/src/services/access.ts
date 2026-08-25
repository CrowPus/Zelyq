import {
  type AuditAction,
  newId,
  type Project,
  type Role,
  roleAtLeast,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyRequest } from "fastify";

/**
 * Every authorization decision in the application goes through this class.
 *
 * The rule is uniform: a project belongs to a team, and what you may do to it
 * is decided by your role in that team. There is no per-project permission
 * table, because two places to look is how a resource ends up reachable through
 * the one nobody remembered to check.
 *
 * Failures are deliberately shaped so a non-member cannot tell a project they
 * cannot see from one that does not exist.
 */
export class AccessControl {
  constructor(private readonly store: Store) {}

  requireUser(request: FastifyRequest): User {
    const user = request.zelyqUser;
    if (!user) throw new ZelyqError("unauthorized", "Sign in to continue.");
    return user;
  }

  /**
   * Instance-wide config — Settings, and now skill uploads (`043`) — is not
   * team-scoped, so team roles do not apply. Only an instance administrator
   * may reach it. Extracted here rather than left as `settings.ts`'s own
   * local closure once a second route needed the identical check — one
   * place to get a security-relevant gate right, not two copies that could
   * quietly drift.
   */
  requireInstanceAdmin(request: FastifyRequest): User {
    const user = this.requireUser(request);
    if (user.instanceRole !== "admin") {
      throw new ZelyqError("forbidden", "Only an instance administrator can do this.");
    }
    return user;
  }

  /** The caller's role in a team, or throws as if the team did not exist. */
  async requireTeamRole(user: User, teamId: string, minimum: Role): Promise<Role> {
    const role = await this.store.teams.roleOf(teamId, user.id);
    if (!role) throw ZelyqError.notFound("Team", teamId);

    if (!roleAtLeast(role, minimum)) {
      throw new ZelyqError(
        "forbidden",
        `This action needs the ${minimum} role or higher. Yours is ${role}.`,
      );
    }
    return role;
  }

  /**
   * Loads a project and checks the caller's role in its team in one step, so no
   * route can accidentally load a project without checking access to it.
   */
  async requireProject(
    user: User,
    projectId: string,
    minimum: Role,
  ): Promise<{ project: Project; role: Role }> {
    const project = await this.store.projects.findById(projectId);
    if (!project) throw ZelyqError.notFound("Project", projectId);

    const role = await this.store.teams.roleOf(project.teamId, user.id);
    // Not a member: report "not found" rather than "forbidden", which would
    // confirm the project exists.
    if (!role) throw ZelyqError.notFound("Project", projectId);

    if (!roleAtLeast(role, minimum)) {
      throw new ZelyqError(
        "forbidden",
        `This action needs the ${minimum} role or higher. Yours is ${role}.`,
      );
    }

    return { project, role };
  }

  /** Teams the caller belongs to; the scope for anything they can list. */
  async teamIdsFor(user: User): Promise<string[]> {
    const teams = await this.store.teams.listForUser(user.id);
    return teams.map((team) => team.id);
  }

  /** Where a new project goes when the caller did not name a team. */
  async defaultTeamFor(user: User): Promise<string> {
    const teams = await this.store.teams.listForUser(user.id);
    const writable = teams.find((team) => roleAtLeast(team.role, "editor"));
    if (!writable) {
      throw new ZelyqError("forbidden", "You do not have write access to any team.");
    }
    return writable.id;
  }

  /**
   * Records a project- or team-level change — see `030` in the council
   * notes for the scope and for why `teamId`/`projectId`/`userId` carry no
   * foreign key. Called once, after the action it describes has already
   * succeeded, never before: a rejected or failed mutation must never
   * produce a log entry claiming it happened.
   */
  async recordChange(
    user: User,
    entry: {
      teamId: string | null;
      projectId?: string;
      action: AuditAction;
      detail?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId: entry.teamId,
      projectId: entry.projectId ?? null,
      userId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      action: entry.action,
      detail: entry.detail ?? {},
      createdAt: new Date().toISOString(),
    });
  }
}
