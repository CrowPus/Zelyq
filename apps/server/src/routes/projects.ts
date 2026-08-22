import { createProjectSchema, updateProjectSchema } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { ProjectService } from "../services/projects.js";
import { listTemplates } from "../services/templates.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService; templatesDir: string },
): void {
  app.get("/api/templates", async () => ({ templates: await listTemplates(deps.templatesDir) }));

  app.get("/api/projects", async () => ({ projects: await deps.projects.list() }));

  app.post("/api/projects", async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const project = await deps.projects.create(input);
    reply.status(201);
    return { project };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) => ({
    project: await deps.projects.get(request.params.id),
  }));

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request) => ({
    project: await deps.projects.update(request.params.id, updateProjectSchema.parse(request.body)),
  }));

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    await deps.projects.remove(request.params.id);
    reply.status(204);
  });
}
