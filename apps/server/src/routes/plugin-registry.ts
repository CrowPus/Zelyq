import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { PluginRegistryClient } from "../services/pipelines/registry.js";

type Team = { Params: { teamId: string } };
const installSchema = z.object({
  id: z.string().min(3).max(120),
  version: z.string().min(1).max(40),
});

/** Zelyq's plugin registry, for a team: browse, read, install. */
export function registerPluginRegistryRoutes(
  app: FastifyInstance,
  deps: { registry: PluginRegistryClient; access: AccessControl },
): void {
  const { access, registry } = deps;

  app.get("/api/plugin-registry", async (request) => {
    access.requireUser(request);
    return { enabled: await registry.enabled() };
  });

  app.get<Team & { Querystring: { q?: string; category?: string } }>(
    "/api/teams/:teamId/plugin-registry/plugins",
    async (request) => ({
      plugins: await registry.list(access.requireUser(request), request.params.teamId, {
        ...(request.query.q ? { q: request.query.q } : {}),
        ...(request.query.category ? { category: request.query.category } : {}),
      }),
      yanked: await registry.yanked(),
    }),
  );

  app.get<{ Params: { teamId: string; publisher: string; name: string } }>(
    "/api/teams/:teamId/plugin-registry/plugins/:publisher/:name",
    async (request) => ({
      plugin: await registry.detail(
        access.requireUser(request),
        request.params.teamId,
        `${request.params.publisher}/${request.params.name}`,
      ),
    }),
  );

  app.post<Team>("/api/teams/:teamId/plugin-registry/install", async (request, reply) => {
    const input = installSchema.parse(request.body);
    reply.code(201);
    return {
      plugin: await registry.install(
        access.requireUser(request),
        request.params.teamId,
        input.id,
        input.version,
      ),
    };
  });
}
