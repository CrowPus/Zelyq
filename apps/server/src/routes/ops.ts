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

  app.post<Job>("/api/teams/:teamId/ops/jobs/:jobId/stop", async (request) => ({
    job: await ops.stopJob(
      access.requireUser(request),
      request.params.teamId,
      request.params.jobId,
    ),
  }));
}
