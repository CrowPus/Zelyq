import { backendConfigurationSchema, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { PreviewEnvResolver } from "../services/preview-env.js";
import type { ProjectBackendService } from "../services/project-backend.js";

const environment = z.enum(["development", "test", "production"]).default("development");
export function registerProjectBackendRoutes(
  app: FastifyInstance,
  deps: {
    backend: ProjectBackendService;
    runtime: RuntimeDriver;
    access: AccessControl;
    store: Store;
    resolvePreviewEnv: PreviewEnvResolver;
  },
): void {
  const { backend, access, runtime } = deps;
  type Params = { Params: { id: string }; Querystring: { environment?: string } };
  app.get<Params>("/api/projects/:id/backend", async (request) => {
    await access.requireProject(access.requireUser(request), request.params.id, "viewer");
    return {
      configuration: await backend.get(
        request.params.id,
        environment.parse(request.query.environment),
      ),
    };
  });
  app.put<Params>("/api/projects/:id/backend", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const target = environment.parse(request.query.environment);
    const configuration = await backend.save(
      project.id,
      backendConfigurationSchema.parse(request.body),
      target,
    );
    await access.recordChange(user, {
      projectId: project.id,
      teamId: project.teamId,
      action: "project.backend.updated",
      detail: { environment: target, engine: configuration.engine },
    });
    if (target === "development") await runtime.stopPreview(project.id);
    return { configuration };
  });
  app.delete<Params>("/api/projects/:id/backend", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const target = environment.parse(request.query.environment);
    await backend.remove(project.id, target);
    if (target === "development") await runtime.stopPreview(project.id);
    await access.recordChange(user, {
      projectId: project.id,
      teamId: project.teamId,
      action: "project.backend.disconnected",
      detail: { environment: target },
    });
    return { ok: true };
  });
  app.post<Params>("/api/projects/:id/backend/inspect", async (request) => {
    await access.requireProject(access.requireUser(request), request.params.id, "editor");
    return backend.inspect(request.params.id);
  });
  app.post("/api/internal/project-preview/start", async (request) => {
    const raw = request.headers["x-zelyq-preview-bridge"];
    const grant = typeof raw === "string" ? backend.resolve(raw) : null;
    if (!grant) throw new ZelyqError("unauthorized", "Invalid preview capability");
    const user = await deps.store.users.findById(grant.userId);
    if (!user) throw new ZelyqError("unauthorized", "Preview user no longer exists");
    await access.requireProject(user, grant.projectId, "editor");
    const input = z.object({ restart: z.boolean().optional() }).parse(request.body ?? {});
    if (input.restart) await runtime.stopPreview(grant.projectId);
    return {
      preview: await runtime.startPreview(
        grant.projectId,
        await backend.previewOptions(
          grant.projectId,
          await deps.resolvePreviewEnv(grant.projectId),
        ),
      ),
    };
  });
}
