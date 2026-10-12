import {
  appActionSchema,
  appAddressSchema,
  environmentInputSchema,
  environmentUpdateSchema,
  promoteSchema,
} from "@zelyq/core";
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
  app.delete<Environment & { Querystring: { apps?: string } }>(
    "/api/teams/:teamId/environments/:environmentId",
    async (request, reply) => {
      await deploys.remove(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.query.apps === "remove",
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
    "/api/teams/:teamId/deployments/:deploymentId/check",
    async (request) => ({
      deployment: await deploys.checkAgain(
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
  app.post<{ Params: { teamId: string; deploymentId: string } }>(
    "/api/teams/:teamId/deployments/:deploymentId/promote",
    async (request) => ({
      deployment: await deploys.promote(
        access.requireUser(request),
        request.params.teamId,
        request.params.deploymentId,
        promoteSchema.parse(request.body).environmentId,
      ),
    }),
  );
  type App = { Params: { teamId: string; environmentId: string; app: string } };
  app.get<App & { Querystring: { since?: string } }>(
    "/api/teams/:teamId/environments/:environmentId/apps/:app",
    async (request) => ({
      status: await deploys.appStatus(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.params.app,
        request.query.since ?? null,
      ),
    }),
  );
  app.put<App>(
    "/api/teams/:teamId/environments/:environmentId/apps/:app/address",
    async (request) =>
      deploys.setAddress(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.params.app,
        appAddressSchema.parse(request.body),
      ),
  );
  app.delete<App & { Querystring: { forget?: string } }>(
    "/api/teams/:teamId/environments/:environmentId/apps/:app",
    async (request, reply) => {
      await deploys.removeApp(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.params.app,
        request.query.forget === "true",
      );
      reply.code(204);
    },
  );
  app.post<App>(
    "/api/teams/:teamId/environments/:environmentId/apps/:app/web-server",
    async (request) =>
      deploys.setUpWebServer(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.params.app,
      ),
  );
  app.post<App>(
    "/api/teams/:teamId/environments/:environmentId/apps/:app/action",
    async (request) => ({
      status: await deploys.appAction(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.params.app,
        appActionSchema.parse(request.body).action,
      ),
    }),
  );
}
