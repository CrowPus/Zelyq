import { ZelyqError } from "@zelyq/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AgentPlatform } from "../services/agent-platform.js";

/**
 * The build agent's way into Zelyq's pipelines and deploys, for the app it is
 * building. Authenticated only by the session's preview grant
 * (`x-zelyq-preview-bridge`): one project, one person, checked against the
 * person's current role on every call.
 */
export function registerAgentPlatformRoutes(
  app: FastifyInstance,
  deps: {
    platform: AgentPlatform;
    previewGrants: { resolve(token: string): { projectId: string; userId: string } | null };
  },
): void {
  const grant = (request: FastifyRequest) => {
    const raw = request.headers["x-zelyq-preview-bridge"];
    const resolved = typeof raw === "string" ? deps.previewGrants.resolve(raw) : null;
    if (!resolved) throw new ZelyqError("unauthorized", "Invalid capability");
    return resolved;
  };

  app.get("/api/internal/platform/overview", async (request) =>
    deps.platform.overview(grant(request)),
  );

  app.post("/api/internal/platform/pipelines/save", async (request) => {
    const input = z
      .object({
        source: z.string().min(1).max(100_000),
        base: z.string().max(64).nullish(),
        save: z.boolean(),
      })
      .parse(request.body);
    return deps.platform.save(grant(request), input);
  });

  app.post("/api/internal/platform/pipelines/run", async (request) => {
    const input = z.object({ pipeline: z.string().min(1).max(200) }).parse(request.body);
    return deps.platform.run(grant(request), input);
  });

  app.post("/api/internal/platform/runs/status", async (request) => {
    const input = z
      .object({
        runId: z.string().min(1).max(100).optional(),
        pipeline: z.string().min(1).max(200).optional(),
        number: z.number().int().positive().optional(),
      })
      .parse(request.body ?? {});
    return deps.platform.runStatus(grant(request), input);
  });

  app.post("/api/internal/platform/apps/status", async (request) => {
    const input = z.object({ environment: z.string().min(1).max(100) }).parse(request.body);
    return deps.platform.appStatus(grant(request), input);
  });
}
