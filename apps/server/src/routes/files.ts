import { writeFileSchema } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { ProjectService } from "../services/projects.js";

export function registerFileRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService; runtime: RuntimeDriver; access: AccessControl },
): void {
  const { access } = deps;
  app.get<{ Params: { id: string }; Querystring: { path?: string; depth?: string } }>(
    "/api/projects/:id/files",
    async (request) => {
      await access.requireProject(access.requireUser(request), request.params.id, "viewer");
      const entries = await deps.runtime.listFiles(request.params.id, {
        path: request.query.path,
        depth: request.query.depth ? Number.parseInt(request.query.depth, 10) : undefined,
      });
      return { projectId: request.params.id, entries };
    },
  );

  // The wildcard keeps slashes in the path parameter, so `src/components/App.tsx`
  // arrives intact rather than as three segments.
  app.get<{ Params: { id: string; "*": string } }>("/api/projects/:id/files/*", async (request) => {
    await access.requireProject(access.requireUser(request), request.params.id, "viewer");
    return await deps.runtime.readFile(request.params.id, request.params["*"]);
  });

  app.put<{ Params: { id: string; "*": string } }>("/api/projects/:id/files/*", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = writeFileSchema.parse(request.body);
    await deps.runtime.writeFile(
      request.params.id,
      request.params["*"],
      input.content,
      input.encoding,
    );
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "file.written",
      detail: { path: request.params["*"] },
    });
    return { path: request.params["*"], written: true };
  });

  app.delete<{ Params: { id: string; "*": string } }>(
    "/api/projects/:id/files/*",
    async (request, reply) => {
      const user = access.requireUser(request);
      const { project } = await access.requireProject(user, request.params.id, "editor");
      await deps.runtime.deleteFile(request.params.id, request.params["*"]);
      await access.recordChange(user, {
        teamId: project.teamId,
        projectId: project.id,
        action: "file.deleted",
        detail: { path: request.params["*"] },
      });
      reply.status(204);
    },
  );
}
