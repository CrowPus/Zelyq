import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import { ensureInspectorScript } from "../services/inspector-script.js";
import type { PreviewEnvResolver } from "../services/preview-env.js";
import type { ProjectBackendService } from "../services/project-backend.js";
import type { ProjectService } from "../services/projects.js";
import type { ThumbnailStore } from "../services/thumbnails.js";
import type { UsageService } from "../services/usage.js";

export function registerPreviewRoutes(
  app: FastifyInstance,
  deps: {
    /** What the team's plan allows; none: no limits. */
    limits?: Pick<UsageService, "check" | "touch">;
    projects: ProjectService;
    runtime: RuntimeDriver;
    access: AccessControl;
    templatesDir: string;
    /**
     * Supplies a linked project's preview with its public
     * Supabase config (URL + publishable key). Only ever the two public
     * values; never a credential.
     */
    resolvePreviewEnv: PreviewEnvResolver;
    backend?: ProjectBackendService;
    thumbnails?: ThumbnailStore;
  },
): void {
  const { access } = deps;
  app.get<{ Params: { id: string } }>("/api/projects/:id/preview", async (request) => {
    await access.requireProject(access.requireUser(request), request.params.id, "viewer");
    const preview = await deps.runtime.previewStatus(request.params.id);
    // An app made before thumbnails, or never previewed until now, gets its
    // picture the first time someone has it open and running. The editor
    // polls this, so nothing else has to ask.
    if (preview.status === "running") void deps.thumbnails?.captureIfMissing(request.params.id);
    return { preview };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/preview/start", async (request) => {
    const project = await access.requireProject(
      access.requireUser(request),
      request.params.id,
      "editor",
    );
    // One more preview running at once, unless this one already is.
    const already = await deps.runtime
      .previewStatus(request.params.id)
      .then((preview) => preview.status === "running")
      .catch(() => false);
    if (!already) await deps.limits?.check(project.project.teamId, "previews");
    deps.limits?.touch(request.params.id);
    // A project made before the element inspector shipped, or not started
    // from Zelyq's own template at all, gets patched with the same bridge
    // script the template ships. Best-effort, before the
    // preview starts serving the file: never a reason starting it fails.
    await ensureInspectorScript(deps.runtime, deps.templatesDir, request.params.id);
    const env = await deps.resolvePreviewEnv(request.params.id);
    return {
      preview: await deps.runtime.startPreview(
        request.params.id,
        deps.backend ? await deps.backend.previewOptions(request.params.id, env) : { env },
      ),
    };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/preview/stop", async (request) => {
    await access.requireProject(access.requireUser(request), request.params.id, "editor");
    return { preview: await deps.runtime.stopPreview(request.params.id) };
  });

  app.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    "/api/projects/:id/preview/logs",
    async (request) => {
      await access.requireProject(access.requireUser(request), request.params.id, "viewer");
      const lines = request.query.lines ? Number.parseInt(request.query.lines, 10) : 200;
      return { logs: await deps.runtime.previewLogs(request.params.id, lines) };
    },
  );
}
