import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { SupportService } from "../services/support.js";

/**
 * A team's own say over support: one of its admins lets support look inside
 * the team's apps for a while (48 hours unless they choose), and can take it
 * back. Every look is in the team's activity.
 */
export function registerSupportRoutes(
  app: FastifyInstance,
  deps: { support: SupportService; access: AccessControl },
): void {
  const { support, access } = deps;

  app.get<{ Params: { id: string } }>("/api/teams/:id/support-access", async (request) => {
    const user = access.requireUser(request);
    await access.requireTeamRole(user, request.params.id, "viewer");
    return { access: await support.grant(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/teams/:id/support-access", async (request) => {
    const user = access.requireUser(request);
    await access.requireTeamRole(user, request.params.id, "admin");
    return { access: await support.allow(user, request.params.id, request.body) };
  });

  app.delete<{ Params: { id: string } }>("/api/teams/:id/support-access", async (request) => {
    const user = access.requireUser(request);
    await access.requireTeamRole(user, request.params.id, "admin");
    return await support.withdraw(user, request.params.id);
  });
}
