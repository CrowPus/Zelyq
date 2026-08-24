import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { ProjectService } from "../services/projects.js";

const createSnapshotSchema = z.object({ label: z.string().min(1).max(200).default("Manual save") });

export function registerSnapshotRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService; runtime: RuntimeDriver; store: Store; access: AccessControl },
): void {
  const { access } = deps;
  app.get<{ Params: { id: string } }>("/api/projects/:id/snapshots", async (request) => {
    await access.requireProject(access.requireUser(request), request.params.id, "viewer");
    return { snapshots: await deps.store.snapshots.listForProject(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/snapshots", async (request, reply) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const { label } = createSnapshotSchema.parse(request.body ?? {});
    const snapshot = await deps.runtime.createSnapshot(request.params.id, label);
    await deps.store.snapshots.create(snapshot);
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "snapshot.created",
      detail: { label },
    });
    reply.status(201);
    return { snapshot };
  });

  /** One file as it stood at a snapshot, so the UI can show what a turn changed. */
  app.get<{ Params: { id: string; snapshotId: string; "*": string } }>(
    "/api/projects/:id/snapshots/:snapshotId/files/*",
    async (request) => {
      await access.requireProject(access.requireUser(request), request.params.id, "viewer");
      return await deps.runtime.readSnapshotFile(
        request.params.id,
        request.params.snapshotId,
        request.params["*"],
      );
    },
  );

  app.post<{ Params: { id: string; snapshotId: string } }>(
    "/api/projects/:id/snapshots/:snapshotId/restore",
    async (request) => {
      // Restoring overwrites the working tree; that is a write.
      const user = access.requireUser(request);
      const { project } = await access.requireProject(user, request.params.id, "editor");
      await deps.runtime.restoreSnapshot(request.params.id, request.params.snapshotId);
      await access.recordChange(user, {
        teamId: project.teamId,
        projectId: project.id,
        action: "snapshot.restored",
        detail: { snapshotId: request.params.snapshotId },
      });
      return { restored: true };
    },
  );
}
