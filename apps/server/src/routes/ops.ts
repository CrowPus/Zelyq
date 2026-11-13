import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { OpsService } from "../services/ops/service.js";

type Team = { Params: { teamId: string } };
type Job = { Params: { teamId: string; jobId: string } };
type Step = { Params: { teamId: string; jobId: string; stepId: string } };

/**
 * Ops, as people use it: set it up, pause it, ask it for something, read what
 * it is doing, approve its plan. Every decision is a POST from a signed-in
 * page; nothing is ever approved by opening a link.
 */
export function registerOpsRoutes(
  app: FastifyInstance,
  deps: { access: AccessControl; ops: OpsService },
): void {
  const { access, ops } = deps;

  app.get<Team>("/api/teams/:teamId/ops", async (request) => ({
    engineer: await ops.engineers.summary(access.requireUser(request), request.params.teamId),
  }));

  /** The first admin to open Ops sets it up. */
  app.post<Team>("/api/teams/:teamId/ops", async (request, reply) => {
    const user = access.requireUser(request);
    const row = await ops.engineers.ensure(user, request.params.teamId);
    reply.code(201);
    return { engineer: await ops.engineers.present(row) };
  });

  /** Pause, the monthly cap, the time zone. */
  app.patch<Team>("/api/teams/:teamId/ops", async (request) => ({
    engineer: await ops.engineers.update(
      access.requireUser(request),
      request.params.teamId,
      request.body,
    ),
  }));

  app.get<Team>("/api/teams/:teamId/ops/jobs", async (request) => ({
    jobs: await ops.listJobs(access.requireUser(request), request.params.teamId),
  }));

  app.post<Team>("/api/teams/:teamId/ops/jobs", async (request, reply) => {
    const job = await ops.startJob(
      access.requireUser(request),
      request.params.teamId,
      request.body,
    );
    reply.code(201);
    return { job };
  });

  app.get<Job>("/api/teams/:teamId/ops/jobs/:jobId", async (request) => ({
    job: await ops.getJob(access.requireUser(request), request.params.teamId, request.params.jobId),
  }));

  app.post<Job>("/api/teams/:teamId/ops/jobs/:jobId/plan", async (request) => ({
    job: await ops.decidePlan(
      access.requireUser(request),
      request.params.teamId,
      request.params.jobId,
      request.body,
    ),
  }));

  app.post<Step>("/api/teams/:teamId/ops/jobs/:jobId/steps/:stepId/confirm", async (request) => ({
    job: await ops.confirmStep(
      access.requireUser(request),
      request.params.teamId,
      request.params.jobId,
      request.params.stepId,
    ),
  }));

  // ------------------------------------------------- the Memory tab (people)

  type Item = { Params: { teamId: string; id: string } };
  app.get<Team>("/api/teams/:teamId/ops/memory", async (request) =>
    ops.memory.list(access.requireUser(request), request.params.teamId),
  );
  app.post<Team>("/api/teams/:teamId/ops/memory/wishes", async (request, reply) => {
    await ops.memory.personAddWish(
      access.requireUser(request),
      request.params.teamId,
      request.body,
    );
    reply.code(201);
    return ops.memory.list(access.requireUser(request), request.params.teamId);
  });
  app.patch<Item>("/api/teams/:teamId/ops/memory/wishes/:id", async (request) => {
    await ops.memory.personEditWish(
      access.requireUser(request),
      request.params.teamId,
      request.params.id,
      request.body,
    );
    return ops.memory.list(access.requireUser(request), request.params.teamId);
  });
  app.delete<Item>("/api/teams/:teamId/ops/memory/wishes/:id", async (request) => {
    await ops.memory.personRemoveWish(
      access.requireUser(request),
      request.params.teamId,
      request.params.id,
    );
    return ops.memory.list(access.requireUser(request), request.params.teamId);
  });
  app.patch<Item>("/api/teams/:teamId/ops/memory/lessons/:id", async (request) => {
    await ops.memory.personEditLesson(
      access.requireUser(request),
      request.params.teamId,
      request.params.id,
      request.body,
    );
    return ops.memory.list(access.requireUser(request), request.params.teamId);
  });
  app.delete<Item>("/api/teams/:teamId/ops/memory/lessons/:id", async (request) => {
    await ops.memory.personRemoveLesson(
      access.requireUser(request),
      request.params.teamId,
      request.params.id,
    );
    return ops.memory.list(access.requireUser(request), request.params.teamId);
  });
  app.patch<Item & { Body: { active?: boolean } }>(
    "/api/teams/:teamId/ops/memory/checks/:id",
    async (request) => {
      await ops.memory.personSwitchGuard(
        access.requireUser(request),
        request.params.teamId,
        request.params.id,
        request.body?.active === true,
      );
      return ops.memory.list(access.requireUser(request), request.params.teamId);
    },
  );
  app.put<Team>("/api/teams/:teamId/ops/memory/sheets", async (request) => {
    await ops.memory.personWriteSheet(
      access.requireUser(request),
      request.params.teamId,
      request.body,
    );
    return ops.memory.list(access.requireUser(request), request.params.teamId);
  });

  app.post<Job>("/api/teams/:teamId/ops/jobs/:jobId/stop", async (request) => ({
    job: await ops.stopJob(
      access.requireUser(request),
      request.params.teamId,
      request.params.jobId,
    ),
  }));
}
