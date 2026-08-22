import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ProjectService } from "../services/projects.js";

const createSnapshotSchema = z.object({ label: z.string().min(1).max(200).default("Manual save") });

export function registerSnapshotRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService; runtime: RuntimeDriver; store: Store },
): void {
  app.get<{ Params: { id: string } }>("/api/projects/:id/snapshots", async (request) => {
    await deps.projects.get(request.params.id);
    return { snapshots: await deps.store.snapshots.listForProject(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/snapshots", async (request, reply) => {
    await deps.projects.get(request.params.id);
    const { label } = createSnapshotSchema.parse(request.body ?? {});
    const snapshot = await deps.runtime.createSnapshot(request.params.id, label);
    await deps.store.snapshots.create(snapshot);
    reply.status(201);
    return { snapshot };
  });

  app.post<{ Params: { id: string; snapshotId: string } }>(
    "/api/projects/:id/snapshots/:snapshotId/restore",
    async (request) => {
      await deps.projects.get(request.params.id);
      await deps.runtime.restoreSnapshot(request.params.id, request.params.snapshotId);
      return { restored: true };
    },
  );
}
