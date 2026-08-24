import { createProjectSchema, updateProjectSchema } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { ProjectService } from "../services/projects.js";
import { listTemplates } from "../services/templates.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService; access: AccessControl; templatesDir: string },
): void {
  const { access } = deps;

  app.get("/api/templates", async (request) => {
    access.requireUser(request);
    return { templates: await listTemplates(deps.templatesDir) };
  });

  app.get("/api/projects", async (request) => {
    const user = access.requireUser(request);
    // Only projects in teams the caller belongs to. Nothing else is listable.
    return { projects: await deps.projects.listForUser(user) };
  });

  app.post("/api/projects", async (request, reply) => {
    const user = access.requireUser(request);
    const input = createProjectSchema.parse(request.body);

    const teamId = input.teamId ?? (await access.defaultTeamFor(user));
    await access.requireTeamRole(user, teamId, "editor");

    const project = await deps.projects.create({ ...input, teamId });
    await access.recordChange(user, {
      teamId,
      projectId: project.id,
      action: "project.created",
      detail: { name: project.name },
    });
    reply.status(201);
    return { project };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "viewer");
    return { project };
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const user = access.requireUser(request);
    const { project: before } = await access.requireProject(user, request.params.id, "editor");
    const changes = updateProjectSchema.parse(request.body);
    const project = await deps.projects.update(request.params.id, changes);
    await access.recordChange(user, {
      teamId: before.teamId,
      projectId: project.id,
      action: "project.updated",
      detail: { fields: Object.keys(changes) },
    });
    return { project };
  });

  // Deleting removes files from disk as well as the row, so it takes admin.
  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "admin");
    await deps.projects.remove(request.params.id);
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.deleted",
      detail: { name: project.name },
    });
    reply.status(204);
  });
}
