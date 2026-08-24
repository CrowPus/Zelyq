import {
  addMemberSchema,
  createTeamSchema,
  newId,
  roleAtLeast,
  slugify,
  updateMemberSchema,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";

export function registerTeamRoutes(
  app: FastifyInstance,
  deps: { store: Store; access: AccessControl },
): void {
  const { store, access } = deps;

  app.get("/api/teams", async (request) => {
    const user = access.requireUser(request);
    return { teams: await store.teams.listForUser(user.id) };
  });

  app.post("/api/teams", async (request, reply) => {
    const user = access.requireUser(request);
    const input = createTeamSchema.parse(request.body);

    let slug = slugify(input.name, "team");
    for (let attempt = 2; await store.teams.findBySlug(slug); attempt++) {
      slug = `${slugify(input.name, "team")}-${attempt}`;
    }

    const team = await store.teams.create({ id: newId("team"), name: input.name.trim(), slug });
    await store.teams.addMember(team.id, user.id, "owner");

    reply.status(201);
    return { team: { ...team, role: "owner" as const } };
  });

  app.get<{ Params: { id: string } }>("/api/teams/:id/members", async (request) => {
    const user = access.requireUser(request);
    // Any member may see who else is on the team.
    await access.requireTeamRole(user, request.params.id, "viewer");
    return { members: await store.teams.listMembers(request.params.id) };
  });

  /**
   * Seeing a full history of who did what is more sensitive than ordinary
   * edit access — gated the same way `settings.ts` gates its own read.
   */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/teams/:id/audit-log",
    async (request) => {
      const user = access.requireUser(request);
      await access.requireTeamRole(user, request.params.id, "admin");
      const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : undefined;
      return { entries: await store.auditLog.listForTeam(request.params.id, limit) };
    },
  );

  /**
   * Adds an existing account by email. There is no invitation email in the core
   * — an instance has no mail transport it can assume — so the person registers
   * first and an admin adds them.
   */
  app.post<{ Params: { id: string } }>("/api/teams/:id/members", async (request, reply) => {
    const user = access.requireUser(request);
    const teamId = request.params.id;
    const actorRole = await access.requireTeamRole(user, teamId, "admin");
    const input = addMemberSchema.parse(request.body);

    if (!roleAtLeast(actorRole, input.role)) {
      throw new ZelyqError("forbidden", `You cannot grant a role above your own (${actorRole}).`);
    }

    const invitee = await store.users.findByEmail(input.email);
    if (!invitee) {
      throw new ZelyqError(
        "not_found",
        `No account for ${input.email}. They need to register first, then you can add them.`,
      );
    }

    if (await store.teams.roleOf(teamId, invitee.id)) {
      throw new ZelyqError("conflict", `${input.email} is already a member of this team.`);
    }

    await store.teams.addMember(teamId, invitee.id, input.role);
    await access.recordChange(user, {
      teamId,
      action: "team.member_added",
      detail: { email: input.email, role: input.role },
    });
    reply.status(201);
    return { members: await store.teams.listMembers(teamId) };
  });

  app.patch<{ Params: { id: string; userId: string } }>(
    "/api/teams/:id/members/:userId",
    async (request) => {
      const user = access.requireUser(request);
      const { id: teamId, userId } = request.params;
      const actorRole = await access.requireTeamRole(user, teamId, "admin");
      const input = updateMemberSchema.parse(request.body);

      const targetRole = await store.teams.roleOf(teamId, userId);
      if (!targetRole) throw ZelyqError.notFound("Member", userId);

      if (!roleAtLeast(actorRole, input.role)) {
        throw new ZelyqError("forbidden", `You cannot grant a role above your own (${actorRole}).`);
      }
      if (!roleAtLeast(actorRole, targetRole)) {
        throw new ZelyqError("forbidden", "You cannot change the role of someone above you.");
      }

      // Demoting the last owner would leave the team unadministrable.
      if (targetRole === "owner" && input.role !== "owner") {
        if ((await store.teams.countOwners(teamId)) <= 1) {
          throw new ZelyqError(
            "conflict",
            "This is the last owner. Promote someone else to owner first.",
          );
        }
      }

      await store.teams.updateMemberRole(teamId, userId, input.role);
      const target = await store.users.findById(userId);
      await access.recordChange(user, {
        teamId,
        action: "team.member_role_changed",
        detail: { email: target?.email ?? userId, from: targetRole, to: input.role },
      });
      return { members: await store.teams.listMembers(teamId) };
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/teams/:id/members/:userId",
    async (request, reply) => {
      const user = access.requireUser(request);
      const { id: teamId, userId } = request.params;

      // Leaving is always allowed; removing someone else needs admin.
      const isSelf = userId === user.id;
      const actorRole = await access.requireTeamRole(user, teamId, isSelf ? "viewer" : "admin");

      const targetRole = await store.teams.roleOf(teamId, userId);
      if (!targetRole) throw ZelyqError.notFound("Member", userId);

      if (!isSelf && !roleAtLeast(actorRole, targetRole)) {
        throw new ZelyqError("forbidden", "You cannot remove someone above you.");
      }
      if (targetRole === "owner" && (await store.teams.countOwners(teamId)) <= 1) {
        throw new ZelyqError(
          "conflict",
          "This is the last owner. Promote someone else to owner first.",
        );
      }

      const target = await store.users.findById(userId);
      await store.teams.removeMember(teamId, userId);
      await access.recordChange(user, {
        teamId,
        action: "team.member_removed",
        detail: { email: target?.email ?? userId, self: isSelf },
      });
      reply.status(204);
    },
  );
}
