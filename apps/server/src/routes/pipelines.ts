import { createReadStream } from "node:fs";
import {
  approvalDecisionSchema,
  runStartSchema,
  sshRunnerInputSchema,
  sshRunnerUpdateSchema,
  triggerInputSchema,
} from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { TeamSshKeyService } from "../services/pipelines/keys.js";
import {
  MAX_PLUGIN_PACKAGE_BYTES,
  type PipelinePluginService,
} from "../services/pipelines/plugins.js";
import type { RunnerService } from "../services/pipelines/runners.js";
import type { PipelineService } from "../services/pipelines/service.js";
import type { PipelineTriggerService } from "../services/pipelines/triggers.js";
import type { VaultKeyService } from "../services/vault-keys.js";

const sourceBody = z.object({ source: z.string().max(200_000) }).strict();
const rerunBody = z.object({ fromStage: z.number().int().min(0).nullable().optional() }).strict();
const confirmBody = z.object({ fingerprint: z.string().trim().min(8).max(200) }).strict();
const rotateBody = z.object({ algorithm: z.enum(["ed25519", "rsa"]).default("ed25519") }).strict();
const enabledBody = z.object({ enabled: z.boolean() }).strict();
const favoriteBody = z.object({ favorite: z.boolean() }).strict();
const clearBody = z.object({ what: z.enum(["tools", "cache"]) }).strict();

/**
 * Pipelines, runs, runners and the team's SSH key, under the team; plus the
 * two doors that are not a signed-in person: the push webhook (answers only to
 * the trigger's secret) and the run API (answers only to a service key with
 * the `pipelines` scope).
 */
export function registerPipelineRoutes(
  app: FastifyInstance,
  deps: {
    access: AccessControl;
    pipelines: PipelineService;
    runners: RunnerService;
    keys: TeamSshKeyService;
    triggers: PipelineTriggerService;
    serviceKeys: VaultKeyService;
    plugins: PipelinePluginService;
  },
): void {
  const { access, pipelines, runners, keys, triggers, serviceKeys, plugins } = deps;
  type Team = { Params: { teamId: string } };
  type Pipe = { Params: { teamId: string; pipelineId: string } };
  type Run = { Params: { teamId: string; runId: string } };
  type Runner = { Params: { teamId: string; runnerId: string } };
  type Trigger = { Params: { teamId: string; pipelineId: string; triggerId: string } };

  // -------------------------------------------------------------- pipelines

  app.get<Team>("/api/teams/:teamId/pipelines", async (request) => ({
    pipelines: await pipelines.list(access.requireUser(request), request.params.teamId),
  }));
  app.post<Team>("/api/teams/:teamId/pipelines/check", async (request) =>
    pipelines.check(
      access.requireUser(request),
      request.params.teamId,
      sourceBody.parse(request.body).source,
    ),
  );
  app.post<Team>("/api/teams/:teamId/pipelines", async (request, reply) => {
    reply.code(201);
    return {
      pipeline: await pipelines.create(
        access.requireUser(request),
        request.params.teamId,
        sourceBody.parse(request.body).source,
      ),
    };
  });
  app.get<Pipe>("/api/teams/:teamId/pipelines/:pipelineId", async (request) => ({
    pipeline: await pipelines.get(
      access.requireUser(request),
      request.params.teamId,
      request.params.pipelineId,
    ),
  }));
  app.put<Pipe>("/api/teams/:teamId/pipelines/:pipelineId", async (request) => ({
    pipeline: await pipelines.update(
      access.requireUser(request),
      request.params.teamId,
      request.params.pipelineId,
      sourceBody.parse(request.body).source,
    ),
  }));
  app.delete<Pipe>("/api/teams/:teamId/pipelines/:pipelineId", async (request, reply) => {
    await pipelines.remove(
      access.requireUser(request),
      request.params.teamId,
      request.params.pipelineId,
    );
    reply.code(204);
  });

  // ------------------------------------------------------------------- runs

  app.get<Pipe>("/api/teams/:teamId/pipelines/:pipelineId/runs", async (request) => ({
    runs: await pipelines.listRuns(
      access.requireUser(request),
      request.params.teamId,
      request.params.pipelineId,
    ),
  }));
  app.put<Pipe>("/api/teams/:teamId/pipelines/:pipelineId/favorite", async (request, reply) => {
    await pipelines.setFavorite(
      access.requireUser(request),
      request.params.teamId,
      request.params.pipelineId,
      favoriteBody.parse(request.body).favorite,
    );
    reply.code(204);
  });
  app.post<Pipe>("/api/teams/:teamId/pipelines/:pipelineId/runs", async (request, reply) => {
    reply.code(201);
    const body = runStartSchema.parse(request.body ?? {});
    return {
      run: await pipelines.startRun(
        access.requireUser(request),
        request.params.teamId,
        request.params.pipelineId,
        { ref: body.ref ?? null, inputs: body.inputs ?? {} },
      ),
    };
  });
  app.get<Run>("/api/teams/:teamId/pipeline-runs/:runId", async (request) => ({
    run: await pipelines.getRun(
      access.requireUser(request),
      request.params.teamId,
      request.params.runId,
    ),
  }));
  app.get<Run & { Querystring: { after?: string } }>(
    "/api/teams/:teamId/pipeline-runs/:runId/logs",
    async (request) =>
      pipelines.logs(
        access.requireUser(request),
        request.params.teamId,
        request.params.runId,
        Math.max(0, Number.parseInt(request.query.after ?? "0", 10) || 0),
      ),
  );
  app.get<Run>("/api/teams/:teamId/pipeline-runs/:runId/log.txt", async (request, reply) => {
    const log = await pipelines.logText(
      access.requireUser(request),
      request.params.teamId,
      request.params.runId,
    );
    reply.header("content-type", "text/plain; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${log.name}"`);
    return log.text;
  });
  app.post<{ Params: { teamId: string; runId: string; approvalId: string } }>(
    "/api/teams/:teamId/pipeline-runs/:runId/approvals/:approvalId",
    async (request) => {
      const user = access.requireUser(request);
      const body = approvalDecisionSchema.parse(request.body);
      return {
        run: await pipelines.decide(
          user,
          request.params.teamId,
          request.params.runId,
          request.params.approvalId,
          body.decision,
          body.comment ?? null,
        ),
      };
    },
  );
  app.post<Run>("/api/teams/:teamId/pipeline-runs/:runId/cancel", async (request) => ({
    run: await pipelines.cancel(
      access.requireUser(request),
      request.params.teamId,
      request.params.runId,
    ),
  }));
  app.post<Run>("/api/teams/:teamId/pipeline-runs/:runId/rerun", async (request, reply) => {
    reply.code(201);
    return {
      run: await pipelines.rerun(
        access.requireUser(request),
        request.params.teamId,
        request.params.runId,
        rerunBody.parse(request.body ?? {}).fromStage ?? null,
      ),
    };
  });
  app.get<{ Params: { teamId: string; artifactId: string } }>(
    "/api/teams/:teamId/pipeline-artifacts/:artifactId",
    async (request, reply) => {
      const artifact = await pipelines.artifact(
        access.requireUser(request),
        request.params.teamId,
        request.params.artifactId,
      );
      reply.header("content-type", "application/gzip");
      reply.header("content-length", String(artifact.size));
      reply.header(
        "content-disposition",
        `attachment; filename="${artifact.name.replace(/"/g, "")}"`,
      );
      return reply.send(createReadStream(artifact.path));
    },
  );

  // --------------------------------------------------------------- triggers

  app.get<Pipe>("/api/teams/:teamId/pipelines/:pipelineId/triggers", async (request) => ({
    triggers: await triggers.list(
      access.requireUser(request),
      request.params.teamId,
      request.params.pipelineId,
    ),
  }));
  app.post<Pipe>("/api/teams/:teamId/pipelines/:pipelineId/triggers", async (request, reply) => {
    reply.header("cache-control", "no-store");
    reply.code(201);
    return triggers.add(
      access.requireUser(request),
      request.params.teamId,
      request.params.pipelineId,
      triggerInputSchema.parse(request.body),
    );
  });
  app.patch<Trigger>(
    "/api/teams/:teamId/pipelines/:pipelineId/triggers/:triggerId",
    async (request) => ({
      trigger: await triggers.setEnabled(
        access.requireUser(request),
        request.params.teamId,
        request.params.pipelineId,
        request.params.triggerId,
        enabledBody.parse(request.body).enabled,
      ),
    }),
  );
  app.put<Trigger>(
    "/api/teams/:teamId/pipelines/:pipelineId/triggers/:triggerId",
    async (request) => ({
      trigger: await triggers.edit(
        access.requireUser(request),
        request.params.teamId,
        request.params.pipelineId,
        request.params.triggerId,
        triggerInputSchema.parse(request.body),
      ),
    }),
  );
  app.delete<Trigger>(
    "/api/teams/:teamId/pipelines/:pipelineId/triggers/:triggerId",
    async (request, reply) => {
      await triggers.remove(
        access.requireUser(request),
        request.params.teamId,
        request.params.pipelineId,
        request.params.triggerId,
      );
      reply.code(204);
    },
  );

  // ---------------------------------------------------------------- runners

  app.get<Team>("/api/teams/:teamId/runners", async (request) => ({
    runners: await runners.list(access.requireUser(request), request.params.teamId),
  }));
  app.post<Team>("/api/teams/:teamId/runners", async (request, reply) => {
    reply.code(201);
    return {
      runner: await runners.create(
        access.requireUser(request),
        request.params.teamId,
        sshRunnerInputSchema.parse(request.body),
      ),
    };
  });
  app.patch<Runner>("/api/teams/:teamId/runners/:runnerId", async (request) => ({
    runner: await runners.update(
      access.requireUser(request),
      request.params.teamId,
      request.params.runnerId,
      sshRunnerUpdateSchema.parse(request.body),
    ),
  }));
  app.delete<Runner>("/api/teams/:teamId/runners/:runnerId", async (request, reply) => {
    await runners.remove(
      access.requireUser(request),
      request.params.teamId,
      request.params.runnerId,
    );
    reply.code(204);
  });
  app.post<Runner>("/api/teams/:teamId/runners/:runnerId/test", async (request) =>
    runners.test(access.requireUser(request), request.params.teamId, request.params.runnerId),
  );
  app.post<Runner>("/api/teams/:teamId/runners/:runnerId/confirm", async (request) => ({
    runner: await runners.confirmHostKey(
      access.requireUser(request),
      request.params.teamId,
      request.params.runnerId,
      confirmBody.parse(request.body).fingerprint,
    ),
  }));

  app.get<Runner>("/api/teams/:teamId/runners/:runnerId/disk", async (request) => ({
    disk: await runners.disk(
      access.requireUser(request),
      request.params.teamId,
      request.params.runnerId,
    ),
  }));
  app.post<Runner>("/api/teams/:teamId/runners/:runnerId/disk/clear", async (request) => ({
    disk: await runners.clearDisk(
      access.requireUser(request),
      request.params.teamId,
      request.params.runnerId,
      clearBody.parse(request.body).what,
    ),
  }));

  // ---------------------------------------------------------------- SSH key

  app.get<Team>("/api/teams/:teamId/ssh-keys", async (request) => ({
    keys: await keys.list(access.requireUser(request), request.params.teamId),
  }));
  app.post<Team>("/api/teams/:teamId/ssh-keys/rotate", async (request) => ({
    keys: await keys.rotate(
      access.requireUser(request),
      request.params.teamId,
      rotateBody.parse(request.body ?? {}).algorithm,
    ),
  }));
  app.post<Team>("/api/teams/:teamId/ssh-keys/retire-old", async (request, reply) => {
    await keys.retireOld(access.requireUser(request), request.params.teamId);
    reply.code(204);
  });

  // -------------------------------------------------------------- run API

  app.post<{ Params: { pipelineId: string } }>("/api/v1/pipelines/:pipelineId/runs", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request, reply) => {
      const context = await serviceKeys.authenticate(request.headers.authorization, request.ip);
      serviceKeys.requireScope(context, "pipelines");
      const body = runStartSchema.parse(request.body ?? {});
      const run = await pipelines.startForKey(
        context.key.teamId,
        request.params.pipelineId,
        body.ref ?? null,
        body.inputs ?? {},
      );
      reply.code(201);
      return { run };
    },
  });

  // ---------------------------------------------------------------- plugins

  app.get<Team>("/api/teams/:teamId/pipeline-plugins", async (request) => ({
    plugins: await plugins.list(access.requireUser(request), request.params.teamId),
  }));
  app.delete<{ Params: { teamId: string; pluginId: string } }>(
    "/api/teams/:teamId/pipeline-plugins/:pluginId",
    async (request, reply) => {
      await plugins.remove(
        access.requireUser(request),
        request.params.teamId,
        request.params.pluginId,
      );
      reply.code(204);
    },
  );
  // The package arrives as the body itself (a .tar.gz), so it gets its own parser.
  void app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: MAX_PLUGIN_PACKAGE_BYTES + 1024 },
      (_request, body, done) => done(null, body),
    );
    upload.post<Team>("/api/teams/:teamId/pipeline-plugins", async (request, reply) => {
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      reply.code(201);
      return {
        plugin: await plugins.install(access.requireUser(request), request.params.teamId, body),
      };
    });
  });

  // --------------------------------------------------------------- webhook

  // Its own scope, so this one route reads the body as raw bytes: the
  // signature is over the bytes GitHub sent, not over a re-serialised object.
  void app.register(async (hooks) => {
    hooks.removeAllContentTypeParsers();
    hooks.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );
    hooks.post<{ Params: { triggerId: string } }>("/api/hooks/pipelines/:triggerId", {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      handler: async (request, reply) => {
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const result = await triggers.webhook(request.params.triggerId, request.headers, body);
        return reply.code(result.status).send({ message: result.message });
      },
    });
  });
}
