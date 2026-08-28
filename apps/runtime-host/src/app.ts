import { isZelyqError, ZelyqError } from "@zelyq/core";
import { createRuntimeDriver, type RuntimeConfig, type RuntimeDriver } from "@zelyq/runtime";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";

/**
 * The reference runtime host: `docs/runtime-protocol.md` served over HTTP.
 *
 * It executes with `LocalRuntimeDriver`, which is deliberate rather than lazy.
 * The protocol is the product here — the thing that makes "runs on your laptop
 * or in your cluster" a configuration choice instead of a fork — and a second
 * implementation of the *interface* is what proves the interface holds. Where
 * that execution then happens, and what limits surround it, is a deployment
 * concern layered on top: one container per project, resource limits, restricted
 * egress. Those are out of scope here and handled by the deployment layer.
 *
 * So this host is honest about what it is: correct, complete, and unisolated.
 * Running it as-is buys nothing over `ZELYQ_RUNTIME=local`. Running it inside a
 * container per project is what buys the boundary, and the protocol is what
 * makes that substitution possible without the rest of Zelyq noticing.
 */

const scaffoldSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      encoding: z.enum(["utf8", "base64"]).optional(),
      mode: z.number().int().optional(),
    }),
  ),
});

const execSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
  maxOutputBytes: z.number().int().positive().optional(),
});

const writeSchema = z.object({
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).optional(),
});

const previewSchema = z.object({
  command: z.string().optional(),
  port: z.number().int().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const snapshotSchema = z.object({ label: z.string().min(1).max(200).default("Snapshot") });

export interface HostConfig {
  host: string;
  port: number;
  logLevel: string;
  /** When set, every request must carry `Authorization: Bearer <token>`. */
  token: string | undefined;
  runtime: RuntimeConfig;
  version?: string;
}

export interface RuntimeHost {
  app: FastifyInstance;
  runtime: RuntimeDriver;
  close(): Promise<void>;
}

export function buildHost(config: HostConfig): RuntimeHost {
  const app = Fastify({ logger: { level: config.logLevel } });

  // Several routes take no body, and a caller may still announce JSON. Strict
  // parsing rejects that pairing, which broke every bodyless route the first
  // time a driver met a real host. A host implementing this protocol has to
  // tolerate it, so the requirement is now written down in
  // docs/runtime-protocol.md as well as handled here.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_request, payload: string, done) => {
      if (payload === undefined || payload === null || payload.trim() === "") {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(payload));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  const runtime = createRuntimeDriver(config.runtime);

  app.setErrorHandler((error, _request, reply) => {
    if (isZelyqError(error)) {
      reply.status(error.status).send(error.toJSON());
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send(new ZelyqError("bad_request", "Request validation failed").toJSON());
      return;
    }
    app.log.error(error);
    reply
      .status(500)
      .send(new ZelyqError("internal", (error as Error).message ?? "Unknown error").toJSON());
  });

  // A token is optional so the host can be run on a loopback interface without
  // ceremony; when one is configured it is required on every route but health.
  app.addHook("onRequest", async (request, reply) => {
    if (!config.token || request.url === "/v1/health") return;
    if (request.headers.authorization !== `Bearer ${config.token}`) {
      reply.status(401).send(new ZelyqError("unauthorized", "Bad or missing token").toJSON());
    }
  });

  app.get("/v1/health", async () => ({ version: config.version ?? "0.1.0" }));

  type Id = { Params: { id: string } };
  type IdPath = { Params: { id: string; "*": string } };

  app.post<Id>("/v1/projects/:id", async (request) => {
    return await runtime.ensureProject(request.params.id);
  });

  app.delete<Id>("/v1/projects/:id", async (request, reply) => {
    await runtime.removeProject(request.params.id);
    reply.status(204);
  });

  app.post<Id>("/v1/projects/:id/scaffold", async (request, reply) => {
    const { files } = scaffoldSchema.parse(request.body);
    await runtime.scaffold(request.params.id, files);
    reply.status(204);
  });

  app.post<Id>("/v1/projects/:id/exec", async (request) => {
    return await runtime.exec(request.params.id, execSchema.parse(request.body));
  });

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    "/v1/projects/:id/files",
    async (request) => {
      const { path, depth, includeIgnored } = request.query;
      return {
        entries: await runtime.listFiles(request.params.id, {
          ...(path ? { path } : {}),
          ...(depth ? { depth: Number.parseInt(depth, 10) } : {}),
          ...(includeIgnored ? { includeIgnored: includeIgnored === "true" } : {}),
        }),
      };
    },
  );

  app.get<IdPath>("/v1/projects/:id/files/*", async (request) => {
    return await runtime.readFile(request.params.id, request.params["*"]);
  });

  app.put<IdPath>("/v1/projects/:id/files/*", async (request, reply) => {
    const { content, encoding } = writeSchema.parse(request.body);
    await runtime.writeFile(request.params.id, request.params["*"], content, encoding);
    reply.status(204);
  });

  app.delete<IdPath>("/v1/projects/:id/files/*", async (request, reply) => {
    await runtime.deleteFile(request.params.id, request.params["*"]);
    reply.status(204);
  });

  app.post<Id>("/v1/projects/:id/preview/start", async (request) => {
    return await runtime.startPreview(request.params.id, previewSchema.parse(request.body ?? {}));
  });

  app.post<Id>("/v1/projects/:id/preview/stop", async (request) => {
    return await runtime.stopPreview(request.params.id);
  });

  app.get<Id>("/v1/projects/:id/preview", async (request) => {
    return await runtime.previewStatus(request.params.id);
  });

  app.get<{ Params: { id: string }; Querystring: { lines?: string } }>(
    "/v1/projects/:id/preview/logs",
    async (request) => {
      const lines = request.query.lines ? Number.parseInt(request.query.lines, 10) : undefined;
      return { logs: await runtime.previewLogs(request.params.id, lines) };
    },
  );

  app.post<Id>("/v1/projects/:id/snapshots", async (request) => {
    const { label } = snapshotSchema.parse(request.body ?? {});
    return await runtime.createSnapshot(request.params.id, label);
  });

  app.post<{ Params: { id: string; snapshotId: string } }>(
    "/v1/projects/:id/snapshots/:snapshotId/restore",
    async (request, reply) => {
      await runtime.restoreSnapshot(request.params.id, request.params.snapshotId);
      reply.status(204);
    },
  );

  app.get<{ Params: { id: string; snapshotId: string; "*": string } }>(
    "/v1/projects/:id/snapshots/:snapshotId/files/*",
    async (request) => {
      return await runtime.readSnapshotFile(
        request.params.id,
        request.params.snapshotId,
        request.params["*"],
      );
    },
  );

  return {
    app,
    runtime,
    async close() {
      await app.close();
      await runtime.dispose();
    },
  };
}
