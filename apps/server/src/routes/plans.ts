import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { UsageService } from "../services/usage.js";

/**
 * What a team uses (any member looks), and the plans that set its limits
 * (the server's administrator alone defines them and moves teams between).
 */
export function registerPlanRoutes(
  app: FastifyInstance,
  deps: { usage: UsageService; access: AccessControl; store: Store },
): void {
  const { usage, access, store } = deps;

  app.get<{ Params: { id: string }; Querystring: { fresh?: string } }>(
    "/api/teams/:id/usage",
    async (request) => {
      const user = access.requireUser(request);
      await access.requireTeamRole(user, request.params.id, "viewer");
      return usage.usage(request.params.id, request.query.fresh === "1");
    },
  );

  /**
   * A team member frees space in one app: older undo points (the newest
   * `keepUndo` stay), its chat attachments. `look`: only says what it would free.
   */
  app.post<{ Params: { id: string } }>("/api/projects/:id/free-space", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = z
      .object({
        keepUndo: z.number().int().min(1).max(1000).optional(),
        attachments: z.boolean().optional(),
        look: z.boolean().optional(),
      })
      .strict()
      .parse(request.body ?? {});
    const result = await usage.freeSpace(project.teamId, project.id, input);
    if (!result.look) {
      await access.recordChange(user, {
        teamId: project.teamId,
        projectId: project.id,
        action: "project.space_freed",
        detail: {
          name: project.name,
          freedMb: Math.round(result.freedMb),
          undoPoints: result.undoPointsRemoved,
          attachments: result.attachmentsRemoved,
        },
      });
    }
    return result;
  });

  /** The idle-app clean-up: what it last freed, and running it now. */
  app.get("/api/cleanup", async (request) => {
    access.requireInstanceAdmin(request);
    return { last: await usage.lastCleanup() };
  });
  /** ?look=1: what would be cleared, nothing removed. */
  app.post<{ Querystring: { look?: string } }>("/api/cleanup", async (request) => {
    access.requireInstanceAdmin(request);
    return { last: await usage.cleanIdle({ dryRun: request.query.look === "1" }) };
  });

  app.get("/api/plans", async (request) => {
    access.requireInstanceAdmin(request);
    return { ...(await usage.plans()), all: await usage.allPlans() };
  });

  app.put("/api/plans", async (request) => {
    access.requireInstanceAdmin(request);
    await usage.savePlans(request.body);
    return { ...(await usage.plans()), all: await usage.allPlans() };
  });

  /** Every team, its plan and how much storage it uses: the administrator's view. */
  app.get("/api/plans/teams", async (request) => {
    access.requireInstanceAdmin(request);
    const teams = [];
    for (const team of await store.teams.listAll()) {
      const used = await usage.usage(team.id);
      teams.push({
        id: team.id,
        name: team.name,
        plan: used.plan,
        storageMb: used.lines.find((line) => line.key === "storageMb")?.used ?? 0,
        apps: used.lines.find((line) => line.key === "apps")?.used ?? 0,
        members: used.lines.find((line) => line.key === "members")?.used ?? 0,
      });
    }
    return { teams };
  });

  app.put<{ Params: { id: string } }>("/api/teams/:id/plan", async (request) => {
    const user = access.requireInstanceAdmin(request);
    const { plan } = z
      .object({ plan: z.string().min(1) })
      .strict()
      .parse(request.body);
    if (!(await store.teams.findById(request.params.id))) {
      return { ok: false };
    }
    await usage.setPlan(request.params.id, plan);
    await access.recordChange(user, {
      teamId: request.params.id,
      action: "team.plan_changed",
      detail: { plan },
    });
    return usage.usage(request.params.id);
  });
}
