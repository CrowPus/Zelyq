import { environmentInputSchema, environmentUpdateSchema } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { DeployService } from "../services/deploy.js";

/** Deployments: a team's environments, what is live on each, history and roll back. */
export function registerDeployRoutes(
  app: FastifyInstance,
  deps: { access: AccessControl; deploys: DeployService },
): void {
  const { access, deploys } = deps;
  type Team = { Params: { teamId: string } };
  type Environment = { Params: { teamId: string; environmentId: string } };

  app.get<Team>("/api/teams/:teamId/environments", async (request) => ({
    environments: await deploys.list(access.requireUser(request), request.params.teamId),
  }));
  app.post<Team>("/api/teams/:teamId/environments", async (request, reply) => {
    const user = access.requireUser(request);
    reply.code(201);
    return {
      environment: await deploys.create(
        user,
        request.params.teamId,
        environmentInputSchema.parse(request.body),
      ),
    };
  });
  app.patch<Environment>("/api/teams/:teamId/environments/:environmentId", async (request) => {
    const user = access.requireUser(request);
    return {
      environment: await deploys.update(
        user,
        request.params.teamId,
        request.params.environmentId,
        environmentUpdateSchema.parse(request.body),
      ),
    };
  });
  app.delete<Environment>(
    "/api/teams/:teamId/environments/:environmentId",
    async (request, reply) => {
      await deploys.remove(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
      );
      reply.code(204);
    },
  );
  app.get<Environment & { Querystring: { app?: string } }>(
    "/api/teams/:teamId/environments/:environmentId/deployments",
    async (request) => ({
      deployments: await deploys.history(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.query.app ?? null,
      ),
    }),
  );
  app.get<{ Params: { teamId: string; deploymentId: string } }>(
    "/api/teams/:teamId/deployments/:deploymentId",
    async (request) => ({
      deployment: await deploys.detail(
        access.requireUser(request),
        request.params.teamId,
        request.params.deploymentId,
      ),
    }),
  );
  app.post<{ Params: { teamId: string; deploymentId: string } }>(
    "/api/teams/:teamId/deployments/:deploymentId/roll-back",
    async (request) => ({
      deployment: await deploys.rollBack(
        access.requireUser(request),
        request.params.teamId,
        request.params.deploymentId,
      ),
    }),
  );
}
