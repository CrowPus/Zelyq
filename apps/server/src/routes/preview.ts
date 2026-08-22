import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import type { ProjectService } from "../services/projects.js";

export function registerPreviewRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService; runtime: RuntimeDriver },
): void {
  app.get<{ Params: { id: string } }>("/api/projects/:id/preview", async (request) => {
    await deps.projects.get(request.params.id);
    return { preview: await deps.runtime.previewStatus(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/preview/start", async (request) => {
    await deps.projects.get(request.params.id);
    return { preview: await deps.runtime.startPreview(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/preview/stop", async (request) => {
    await deps.projects.get(request.params.id);
    return { preview: await deps.runtime.stopPreview(request.params.id) };
  });

  app.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    "/api/projects/:id/preview/logs",
    async (request) => {
      await deps.projects.get(request.params.id);
      const lines = request.query.lines ? Number.parseInt(request.query.lines, 10) : 200;
      return { logs: await deps.runtime.previewLogs(request.params.id, lines) };
    },
  );
}
