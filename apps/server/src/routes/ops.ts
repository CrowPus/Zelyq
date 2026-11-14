import { type Role, roleAtLeast, type User, ZelyqError } from "@zelyq/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { OpsBrain } from "../services/ops/brain.js";
import { ChannelError, type ChannelService } from "../services/ops/channels.js";
import type { OpsService } from "../services/ops/service.js";
import type { CheckService } from "../services/ops/watch/checks.js";

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
  deps: {
    access: AccessControl;
    ops: OpsService;
    brain: OpsBrain;
    watch: CheckService;
    channels: ChannelService;
  },
): void {
  const { access, ops, brain, watch, channels } = deps;

  // ------------------------------------------------------------- the watch
  type Alert = { Params: { teamId: string; alertId: string } };
  /** A person, in this team, at least this role: the watch's controls are never Ops's. */
  const person = async (request: FastifyRequest, teamId: string, role: Role) => {
    const user = access.requireUser(request);
    await access.requireTeamRole(user, teamId, role);
    if (await ops.isServiceUser(user.id))
      throw new ZelyqError("forbidden", "Only a person can do this.");
    return user;
  };
  const ownAlert = async (teamId: string, alertId: string) => {
    const alert = await ops.alertOf(teamId, alertId);
    if (!alert) throw ZelyqError.notFound("Alert", alertId);
  };
  app.get<Team>("/api/teams/:teamId/ops/status", async (request) => {
    await person(request, request.params.teamId, "viewer");
    return watch.status(request.params.teamId);
  });
  app.post<Alert>("/api/teams/:teamId/ops/alerts/:alertId/acknowledge", async (request) => {
    const user = await person(request, request.params.teamId, "editor");
    await ownAlert(request.params.teamId, request.params.alertId);
    await watch.acknowledge(request.params.alertId, user.id);
    return watch.status(request.params.teamId);
  });
  app.post<Alert>("/api/teams/:teamId/ops/alerts/:alertId/silence", async (request) => {
    const user = await person(request, request.params.teamId, "editor");
    await ownAlert(request.params.teamId, request.params.alertId);
    const minutes = z
      .object({
        minutes: z
          .number()
          .int()
          .min(5)
          .max(7 * 24 * 60),
      })
      .parse(request.body).minutes;
    await watch.silence(request.params.alertId, user.id, minutes);
    return watch.status(request.params.teamId);
  });
  app.patch<{ Params: { teamId: string; checkId: string } }>(
    "/api/teams/:teamId/ops/checks/:checkId",
    async (request) => {
      const user = await person(request, request.params.teamId, "admin");
      const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(request.body);
      await watch
        .setEnabled(request.params.checkId, request.params.teamId, enabled, user.id)
        .catch((error: Error) => {
          throw ZelyqError.notFound("Check", error.message);
        });
      return watch.status(request.params.teamId);
    },
  );

  // ------------------------------------------------------------- channels (075 Step 2)
  type Kind = { Params: { teamId: string; kind: string } };
  const kindOf = (raw: string) => {
    const parsed = z.enum(["telegram", "slack", "discord"]).safeParse(raw);
    if (!parsed.success) throw ZelyqError.notFound("Channel", raw);
    return parsed.data;
  };
  /** A service's own refusal, said to the person as it is (it never holds a token). */
  const plainly = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } catch (error) {
      if (error instanceof ChannelError) throw ZelyqError.badRequest(error.message);
      throw error;
    }
  };
  const channelsView = async (teamId: string, user: User) => {
    const role = await access.requireTeamRole(user, teamId, "viewer");
    return channels.view(teamId, user.id, roleAtLeast(role, "admin"));
  };
  app.get<Team>("/api/teams/:teamId/ops/channels", async (request) => {
    const user = await person(request, request.params.teamId, "viewer");
    return channelsView(request.params.teamId, user);
  });
  app.put<Kind>("/api/teams/:teamId/ops/channels/:kind", async (request) => {
    const user = await person(request, request.params.teamId, "admin");
    const input = z
      .object({
        token: z.string().max(300).optional(),
        webhook: z.string().max(500).optional(),
        teamChat: z.string().max(100).nullable().optional(),
      })
      .strict()
      .parse(request.body);
    await plainly(
      channels.connect(request.params.teamId, kindOf(request.params.kind), input, user.id),
    );
    return channelsView(request.params.teamId, user);
  });
  app.delete<Kind>("/api/teams/:teamId/ops/channels/:kind", async (request) => {
    const user = await person(request, request.params.teamId, "admin");
    await channels.disconnect(request.params.teamId, kindOf(request.params.kind));
    return channelsView(request.params.teamId, user);
  });
  app.post<Kind>("/api/teams/:teamId/ops/channels/:kind/test", async (request) => {
    const user = await person(request, request.params.teamId, "admin");
    const went = await plainly(
      channels.test(request.params.teamId, kindOf(request.params.kind), user.id),
    );
    return { went, ...(await channelsView(request.params.teamId, user)) };
  });
  app.post<Kind>("/api/teams/:teamId/ops/channels/:kind/link", async (request) => {
    const user = await person(request, request.params.teamId, "viewer");
    return plainly(
      channels.startLink(request.params.teamId, kindOf(request.params.kind), {
        id: user.id,
        email: user.email,
      }),
    );
  });
  app.post<Team>("/api/teams/:teamId/ops/channels/slack/confirm", async (request) => {
    const user = await person(request, request.params.teamId, "viewer");
    const { code } = z
      .object({ code: z.string().min(4).max(32) })
      .strict()
      .parse(request.body);
    await plainly(channels.confirmLink(request.params.teamId, user.id, code));
    return channelsView(request.params.teamId, user);
  });
  app.delete<{ Params: { teamId: string; linkId: string } }>(
    "/api/teams/:teamId/ops/channel-links/:linkId",
    async (request) => {
      const user = await person(request, request.params.teamId, "viewer");
      const role = await access.requireTeamRole(user, request.params.teamId, "viewer");
      await plainly(
        channels.unlink(
          request.params.teamId,
          request.params.linkId,
          user.id,
          roleAtLeast(role, "admin"),
        ),
      );
      return channelsView(request.params.teamId, user);
    },
  );
  app.put<Team>("/api/teams/:teamId/ops/notify", async (request) => {
    const user = await person(request, request.params.teamId, "viewer");
    await channels.setPrefs(request.params.teamId, user.id, request.body);
    return channelsView(request.params.teamId, user);
  });

  /** Talk to Ops, typed or said aloud: a new job, or more in one still going. */
  app.post<Team>("/api/teams/:teamId/ops/talk", async (request) => ({
    job: await brain.talk(access.requireUser(request), request.params.teamId, request.body),
  }));

  /**
   * The engineer's own tool calls, from the agent service during a turn.
   * Authorised only by that turn's token, never by a person's session.
   */
  app.post<{ Body: { tool?: string; input?: unknown } }>(
    "/api/ops-bridge/call",
    async (request, reply) => {
      const header = request.headers["x-zelyq-ops-bridge"];
      const token = typeof header === "string" ? header : undefined;
      // Refused at once, before anything waits: only a live turn's token.
      if (!brain.validToken(token)) {
        throw new ZelyqError("unauthorized", "This Ops turn has ended.");
      }
      // A tool call can wait for a pipeline run (up to 30 minutes): answer at once, keep the
      // connection alive with a space every 20 seconds, and send the result at the end.
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "application/json" });
      const alive = setInterval(() => reply.raw.write(" "), 20_000);
      try {
        const result = await brain.bridge(
          token,
          String(request.body?.tool ?? ""),
          request.body?.input,
        );
        reply.raw.end(JSON.stringify(result));
      } catch (error) {
        reply.raw.end(JSON.stringify({ output: (error as Error).message, isError: true }));
      } finally {
        clearInterval(alive);
      }
    },
  );

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

  /** How much Ops may do alone on each environment. */
  app.get<Team>("/api/teams/:teamId/ops/environments", async (request) => ({
    environments: await ops.engineers.environments(
      access.requireUser(request),
      request.params.teamId,
    ),
  }));
  app.patch<{ Params: { teamId: string; environmentId: string } }>(
    "/api/teams/:teamId/ops/environments/:environmentId",
    async (request) => ({
      environments: await ops.engineers.setTrust(
        access.requireUser(request),
        request.params.teamId,
        request.params.environmentId,
        request.body,
      ),
    }),
  );

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
