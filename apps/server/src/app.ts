import fs from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { ZelyqError, isZelyqError, toError } from "@zelyq/core";
import { type Store, createStore } from "@zelyq/db";
import { type RuntimeDriver, createRuntimeDriver } from "@zelyq/runtime";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import { ZodError } from "zod";
import type { ServerConfig } from "./config.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSnapshotRoutes } from "./routes/snapshots.js";
import { AgentClient } from "./services/agent-client.js";
import { ProjectService } from "./services/projects.js";
import { ChatGateway } from "./ws/gateway.js";

export interface ZelyqServer {
  app: FastifyInstance;
  store: Store;
  runtime: RuntimeDriver;
  close(): Promise<void>;
}

export async function buildServer(config: ServerConfig): Promise<ZelyqServer> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isProduction
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
    },
    bodyLimit: 16 * 1024 * 1024,
    // The UI polls preview status on a timer, and Fastify's per-request logging
    // turns that into ~20 lines every few seconds — enough to bury a real
    // error. Errors and explicit log calls still come through; set
    // LOG_LEVEL=debug for the request firehose when you actually want it.
    logController: new LogController({ disableRequestLogging: !isVerbose(config.logLevel) }),
  });

  const store = createStore(config.databaseUrl);
  const runtime = createRuntimeDriver(config.runtime);
  const agent = new AgentClient(config.agentUrl);
  const projects = new ProjectService(store, runtime, config);

  await app.register(cors, {
    origin: config.corsOrigin.includes("*") ? true : config.corsOrigin,
    credentials: true,
  });
  await app.register(websocket);

  // One error shape for every route: `{ error: { code, message } }`. The UI
  // branches on `code`, never on the message text.
  app.setErrorHandler((error, request, reply) => {
    if (isZelyqError(error)) {
      reply.status(error.status).send(error.toJSON());
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send(
        new ZelyqError("bad_request", "Request validation failed", {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        }).toJSON(),
      );
      return;
    }
    request.log.error(error);
    const failure = toError(error);
    reply
      .status((error as { statusCode?: number }).statusCode ?? 500)
      .send({ error: { code: "internal", message: failure.message } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply
        .status(404)
        .send({ error: { code: "not_found", message: `No route for ${request.url}` } });
      return;
    }
    // Anything else is a client-side route: hand back the SPA shell.
    if (config.webDir) {
      reply.type("text/html").send(fs.createReadStream(path.join(config.webDir, "index.html")));
      return;
    }
    reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
  });

  app.get("/api/health", async () => {
    const [runtimeHealth, agentHealth] = await Promise.all([
      runtime.health(),
      agent
        .health()
        .catch((error) => ({ status: "unreachable", detail: (error as Error).message })),
    ]);
    const ok = runtimeHealth.ok && agentHealth.status === "ok";
    return {
      status: ok ? "ok" : "degraded",
      service: "zelyq-server",
      version: process.env.npm_package_version ?? "0.1.0",
      database: { dialect: store.dialect, url: store.describe() },
      provider: config.provider,
      runtime: runtimeHealth,
      agent: agentHealth,
      timestamp: new Date().toISOString(),
    };
  });

  registerProjectRoutes(app, { projects, templatesDir: config.templatesDir });
  registerFileRoutes(app, { projects, runtime });
  registerPreviewRoutes(app, { projects, runtime });
  registerSnapshotRoutes(app, { projects, runtime, store });

  const gateway = new ChatGateway(store, projects, agent, {
    info: (message) => app.log.info(message),
    error: (object, message) => app.log.error(object, message),
  });

  app.get<{ Params: { id: string } }>(
    "/ws/projects/:id",
    { websocket: true },
    (socket, request) => {
      void gateway.handleConnection(socket, request.params.id).catch((error) => {
        app.log.error(error, "websocket setup failed");
        socket.close(1011, (error as Error).message);
      });
    },
  );

  if (config.webDir && fs.existsSync(config.webDir)) {
    // Wildcard matching resolves each request against the directory as it is
    // now. With `wildcard: false` the routes are enumerated once at startup, so
    // any file written afterwards — every UI rebuild produces new hashed
    // filenames — misses the static handler, falls through to the SPA fallback,
    // and is served as HTML. The browser then refuses to execute it and renders
    // a blank page.
    await app.register(fastifyStatic, { root: config.webDir });
    app.log.info(`serving web build from ${config.webDir}`);
  }

  return {
    app,
    store,
    runtime,
    async close() {
      await app.close();
      await runtime.dispose();
      await store.close();
    },
  };
}

/** Request-by-request logging is only useful when you asked for the detail. */
function isVerbose(logLevel: string): boolean {
  return logLevel === "debug" || logLevel === "trace";
}
