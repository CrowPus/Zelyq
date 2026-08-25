import fs from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { isZelyqError, toError, type User, ZelyqError } from "@zelyq/core";
import { createStore, type Store } from "@zelyq/db";
import { createRuntimeDriver, type RuntimeDriver } from "@zelyq/runtime";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import { ZodError } from "zod";
import type { ServerConfig } from "./config.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";
import { registerAuthRoutes, SESSION_COOKIE } from "./routes/auth.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerSnapshotRoutes } from "./routes/snapshots.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { AccessControl } from "./services/access.js";
import { AccountService } from "./services/accounts.js";
import { AgentClient } from "./services/agent-client.js";
import { AttachmentService } from "./services/attachments.js";
import { AuthService } from "./services/auth.js";
import { ProjectService } from "./services/projects.js";
import { resolveSecretKey, SecretBox } from "./services/secrets.js";
import { SettingsService } from "./services/settings.js";
import { SkillUploadService } from "./services/skill-uploads.js";
import { ChatGateway } from "./ws/gateway.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the authentication hook; absent when the caller is anonymous. */
    zelyqUser?: User;
  }
}

export interface ZelyqServer {
  app: FastifyInstance;
  store: Store;
  runtime: RuntimeDriver;
  /** Read at startup to warn when an exposed instance also accepts signups. */
  registrationOpen(): Promise<boolean>;
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
  const secrets = new SecretBox(
    resolveSecretKey({
      envKey: config.secretKey,
      keyFilePath: config.secretKeyFile,
      onGenerate: (file) =>
        app.log.warn(
          `Generated an encryption key at ${file}. Back it up, or set ZELYQ_SECRET_KEY instead — without it, stored API keys cannot be read.`,
        ),
    }),
  );
  const settings = new SettingsService(
    store,
    secrets,
    process.env,
    config.claudeCredentialsPath,
    config.codexCredentialsPath,
  );
  // Access-related settings are read at call time, so changing them in the UI
  // takes effect without a restart.
  const auth = new AuthService(store, {
    allowRegistration: () => settings.booleanValue("allowRegistration"),
    sessionTtlDays: () => settings.numberValue("sessionTtlDays"),
    oidc: config.oidc,
  });
  const access = new AccessControl(store);
  const accounts = new AccountService(store, projects);
  const attachments = new AttachmentService(config.attachmentsDir);
  const skillUploads = new SkillUploadService(config.uploadedSkillsDir);

  await app.register(cors, {
    origin: config.corsOrigin.includes("*") ? true : config.corsOrigin,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(websocket);

  /**
   * Resolve the session on every request, including WebSocket upgrades. This
   * only *identifies* the caller; each route decides what that identity may do.
   */
  app.addHook("onRequest", async (request) => {
    const token = request.cookies?.[SESSION_COOKIE];
    const user = await auth.resolve(token);
    if (user) request.zelyqUser = user;
  });

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
    // The SPA shell answers *navigations*, not every miss. Returning it for a
    // missing asset would turn a broken `<img src>` or a stale bundle
    // reference into a silent 200 that no log or monitor ever flags.
    if (config.webDir && isNavigation(request.url, request.headers.accept)) {
      reply.type("text/html").send(fs.createReadStream(path.join(config.webDir, "index.html")));
      return;
    }
    reply.status(404).send({ error: { code: "not_found", message: `Not found: ${request.url}` } });
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
      // The live setting, not the value this process booted with: registration
      // can be closed from the settings screen, and health saying otherwise is
      // exactly the kind of wrong answer somebody acts on.
      auth: {
        firstRun: await auth.isFirstRun(),
        registrationOpen: await settings.booleanValue("allowRegistration").catch(() => false),
      },
      provider: config.provider,
      runtime: runtimeHealth,
      agent: agentHealth,
      timestamp: new Date().toISOString(),
    };
  });

  registerAuthRoutes(app, { auth, sessionTtlDays: () => settings.numberValue("sessionTtlDays") });
  registerAccountRoutes(app, { accounts, auth, access });
  registerSettingsRoutes(app, { settings, access });
  registerSkillRoutes(app, { skillUploads, access });
  registerProviderRoutes(app, { agent, access, settings });
  registerTeamRoutes(app, { store, access });
  registerProjectRoutes(app, { projects, access, templatesDir: config.templatesDir });
  registerFileRoutes(app, { projects, runtime, access });
  registerPreviewRoutes(app, { projects, runtime, access, templatesDir: config.templatesDir });
  registerSnapshotRoutes(app, { projects, runtime, store, access });
  registerAttachmentRoutes(app, { attachments, access });

  const gateway = new ChatGateway(store, projects, agent, access, settings, attachments, {
    info: (message) => app.log.info(message),
    error: (object, message) => app.log.error(object, message),
  });

  app.get<{ Params: { id: string } }>(
    "/ws/projects/:id",
    { websocket: true },
    (socket, request) => {
      const user = request.zelyqUser;
      if (!user) {
        // 4401 is the convention for "authenticate and reconnect".
        socket.close(4401, "Not signed in");
        return;
      }
      void gateway.handleConnection(socket, request.params.id, user).catch((error) => {
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
    /** Read at startup to warn when an exposed instance also accepts signups. */
    async registrationOpen(): Promise<boolean> {
      return await settings.booleanValue("allowRegistration").catch(() => false);
    },
    async close() {
      await app.close();
      await runtime.dispose();
      await store.close();
    },
  };
}

/**
 * A navigation is a request for a page: the browser asks for HTML and the path
 * carries no file extension. `/projects/abc` qualifies; `/logo.png` does not.
 */
function isNavigation(url: string, accept: string | undefined): boolean {
  const pathname = url.split("?")[0] ?? "";
  const lastSegment = pathname.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return false;
  return (accept ?? "").includes("text/html");
}

/** Request-by-request logging is only useful when you asked for the detail. */
function isVerbose(logLevel: string): boolean {
  return logLevel === "debug" || logLevel === "trace";
}
