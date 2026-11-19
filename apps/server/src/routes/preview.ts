import { type Preview, previewAddress } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import { ensureInspectorScript } from "../services/inspector-script.js";
import type { PreviewEnvResolver } from "../services/preview-env.js";
import type { ProductActivity } from "../services/product-activity.js";
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
    activity?: ProductActivity;
    /** Maintenance that pauses building also holds new previews. */
    maintenance?: { requireBuildsAllowed(): Promise<void> };
    /** `ZELYQ_PREVIEW_URL_TEMPLATE`, for turning a port into the address a person sees. */
    previewUrlTemplate?: string;
  },
): void {
  const { access } = deps;

  /**
   * The address a person should see. With `{name}` in the template, previews
   * are served by hostname (see preview-proxy.ts) and the port-based address
   * the runtime built is an internal detail; without it, nothing changes.
   */
  const show = (project: { id: string; slug: string }, preview: Preview): Preview => {
    const named = previewAddress(deps.previewUrlTemplate, project, preview.port);
    return named ? { ...preview, url: named } : preview;
  };
  app.get<{ Params: { id: string } }>("/api/projects/:id/preview", async (request) => {
    const { project } = await access.requireProject(
      access.requireUser(request),
      request.params.id,
      "viewer",
    );
    const preview = await deps.runtime.previewStatus(request.params.id);
    // An app made before thumbnails, or never previewed until now, gets its
    // picture the first time someone has it open and running. The editor
    // polls this, so nothing else has to ask.
    if (preview.status === "running") void deps.thumbnails?.captureIfMissing(request.params.id);
    return { preview: show(project, preview) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/preview/start", async (request) => {
    const user = access.requireUser(request);
    const project = await access.requireProject(user, request.params.id, "editor");
    // One more preview running at once, unless this one already is.
    const already = await deps.runtime
      .previewStatus(request.params.id)
      .then((preview) => preview.status === "running")
      .catch(() => false);
    if (!already) await deps.limits?.check(project.project.teamId, "previews");
    if (!already) await deps.maintenance?.requireBuildsAllowed();
    deps.limits?.touch(request.params.id);
    // A project made before the element inspector shipped, or not started
    // from Zelyq's own template at all, gets patched with the same bridge
    // script the template ships. Best-effort, before the
    // preview starts serving the file: never a reason starting it fails.
    await ensureInspectorScript(deps.runtime, deps.templatesDir, request.params.id);
    const env = await deps.resolvePreviewEnv(request.params.id);
    const where = { userId: user.id, teamId: project.project.teamId, projectId: request.params.id };
    const started = Date.now();
    try {
      const preview = await deps.runtime.startPreview(
        request.params.id,
        deps.backend ? await deps.backend.previewOptions(request.params.id, env) : { env },
      );
      if (!already) {
        deps.activity?.record(preview.status === "crashed" ? "preview.failed" : "preview.started", {
          ...where,
          detail: { seconds: (Date.now() - started) / 1000 },
        });
      }
      return { preview: show(project.project, preview) };
    } catch (error) {
      deps.activity?.record("preview.failed", {
        ...where,
        detail: { reason: (error as { code?: string }).code ?? "error" },
      });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/preview/stop", async (request) => {
    const { project } = await access.requireProject(
      access.requireUser(request),
      request.params.id,
      "editor",
    );
    return { preview: show(project, await deps.runtime.stopPreview(request.params.id)) };
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
