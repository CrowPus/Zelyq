import cors from "@fastify/cors";
import {
  type AgentEvent,
  createAgentSessionSchema,
  encodeSse,
  isZelyqError,
  promptSchema,
  toError,
  ZelyqError,
} from "@zelyq/core";
import { createRuntimeDriver, type RuntimeDriver } from "@zelyq/runtime";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import { ZodError } from "zod";
import type { AgentConfig } from "./config.js";
import {
  apiKeyFromEnv,
  baseUrlFor,
  defaultModelFor,
  PROVIDERS,
  type ProviderFactory,
  speaksOpenAIDialect,
} from "./providers/index.js";
import { AgentSession } from "./session.js";

export interface AgentServer {
  app: FastifyInstance;
  runtime: RuntimeDriver;
  close(): Promise<void>;
}

export interface AgentServerDeps {
  /** Overridable so tests can exercise the full turn without a network. */
  providerFactory?: ProviderFactory;
}

export function buildAgentServer(config: AgentConfig, deps: AgentServerDeps = {}): AgentServer {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isProduction
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
    },
    // Turns can run for many minutes; the default socket timeout would cut the
    // SSE stream mid-answer.
    connectionTimeout: 0,
    // The UI polls preview status on a timer, and Fastify's per-request logging
    // turns that into ~20 lines every few seconds — enough to bury a real
    // error. Errors and explicit log calls still come through; set
    // LOG_LEVEL=debug for the request firehose when you actually want it.
    logController: new LogController({ disableRequestLogging: !isVerbose(config.logLevel) }),
    requestTimeout: 0,
  });

  const runtime = createRuntimeDriver(config.runtime);
  const sessions = new Map<string, AgentSession>();

  app.register(cors, { origin: config.corsOrigin, methods: ["GET", "POST", "DELETE"] });

  app.setErrorHandler((error, _request, reply) => {
    if (isZelyqError(error)) {
      reply.status(error.status).send(error.toJSON());
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: { code: "bad_request", message: error.issues[0]?.message ?? "Invalid request" },
      });
      return;
    }
    app.log.error(error);
    reply.status(500).send({ error: { code: "internal", message: toError(error).message } });
  });

  app.get("/health", async () => {
    const health = await runtime.health();
    return {
      status: health.ok ? "ok" : "degraded",
      service: "zelyq-agent",
      sessions: sessions.size,
      runtime: health,
      provider: config.provider,
      model: config.model,
      modelConfigured: Boolean(config.apiKey),
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * What this instance can talk to. `configured` reflects whether a key is
   * actually present, so the UI can say which providers are usable rather than
   * offering one that will fail on the first prompt.
   */
  app.get("/providers", async () => ({
    default: config.provider,
    providers: Object.values(PROVIDERS).map((provider) => ({
      id: provider.id,
      label: provider.label,
      defaultModel: provider.defaultModel,
      apiKeyEnv: provider.apiKeyEnv,
      docsUrl: provider.docsUrl,
      configured: Boolean(apiKeyFromEnv(provider.id)),
      // What the chat's model picker actually needs (`033`) — every known
      // model, not just the default, so switching means choosing a tier
      // (Opus, Sonnet, Haiku…), not just a vendor. Absent for a provider
      // with nothing confirmed yet — see the registry's own comment on why.
      ...(provider.models ? { models: provider.models } : {}),
    })),
  }));

  app.post("/sessions", async (request, reply) => {
    const input = createAgentSessionSchema.parse(request.body);
    const provider = input.provider ?? config.provider;
    const info = PROVIDERS[provider];

    // A session may name a provider other than the process default, so the key
    // is resolved for the provider actually being used.
    const apiKey =
      input.apiKey ??
      (provider === config.provider ? config.apiKey : undefined) ??
      apiKeyFromEnv(provider);

    // A model on your own network usually has no key at all, so demanding one
    // is how this provider quietly fails for the person it exists for.
    if (!apiKey && !info.apiKeyOptional) {
      throw new ZelyqError(
        "unauthorized",
        `No ${info.label} API key configured. Set ${info.apiKeyEnv.join(" or ")} (${info.docsUrl}), or pass a key when creating the session.`,
      );
    }

    // An address on the request wins, then the process default for this same
    // provider, then the registry.
    const baseUrl = baseUrlFor(
      provider,
      input.baseUrl ?? (provider === config.provider ? config.baseUrl : undefined),
    );
    if (speaksOpenAIDialect(provider) && !baseUrl) {
      throw new ZelyqError(
        "bad_request",
        `${info.label} needs an endpoint address. Set ZELYQ_MODEL_BASE_URL — for example ` +
          "http://localhost:11434/v1 for Ollama, or https://models.internal/v1 for your own server.",
      );
    }

    await runtime.ensureProject(input.projectId);

    const session = new AgentSession({
      sessionId: input.sessionId,
      projectId: input.projectId,
      projectName: input.projectId,
      template: "vite-react",
      provider,
      model:
        input.model ?? (provider === config.provider ? config.model : defaultModelFor(provider)),
      effort: input.effort ?? config.effort,
      apiKey: apiKey ?? "",
      ...(baseUrl ? { baseUrl } : {}),
      runtime,
      maxIterations: config.maxTurnIterations,
      history: input.history,
      ...(deps.providerFactory ? { providerFactory: deps.providerFactory } : {}),
    });

    sessions.set(session.id, session);
    reply.status(201);
    return session.state;
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/state", async (request) => {
    return requireSession(sessions, request.params.id).state;
  });

  app.delete<{ Params: { id: string } }>("/sessions/:id", async (request, reply) => {
    const session = sessions.get(request.params.id);
    session?.abort();
    sessions.delete(request.params.id);
    reply.status(204);
  });

  app.post<{ Params: { id: string } }>("/sessions/:id/abort", async (request) => {
    requireSession(sessions, request.params.id).abort();
    return { aborted: true };
  });

  /**
   * One turn, streamed as Server-Sent Events. The connection stays open until
   * the turn ends; the caller (the server app) relays each frame to the browser
   * over its WebSocket without reinterpreting it.
   */
  app.post<{ Params: { id: string } }>("/sessions/:id/prompt", async (request, reply) => {
    const session = requireSession(sessions, request.params.id);
    const input = promptSchema.parse(request.body);

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer SSE into uselessness without this.
      "x-accel-buffering": "no",
    });

    const emit = (event: AgentEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(encodeSse(event));
    };

    // A client that navigates away should stop the turn, not leave it burning
    // tokens into a closed socket.
    //
    // This MUST listen on the response, not the request. Node emits "close" on
    // the request stream as soon as the body has been consumed — which for a
    // POST is immediately — so watching `request.raw` aborts every turn a few
    // milliseconds after it starts. The response closes only when the client
    // actually goes away, and `writableEnded` distinguishes that from a turn
    // that finished normally.
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) session.abort();
    });

    await session.run(input.message, emit);
    reply.raw.end();
  });

  return {
    app,
    runtime,
    async close() {
      for (const session of sessions.values()) session.abort();
      sessions.clear();
      await runtime.dispose();
      await app.close();
    },
  };
}

function requireSession(sessions: Map<string, AgentSession>, id: string): AgentSession {
  const session = sessions.get(id);
  if (!session) throw ZelyqError.notFound("Session", id);
  return session;
}

/** Request-by-request logging is only useful when you asked for the detail. */
function isVerbose(logLevel: string): boolean {
  return logLevel === "debug" || logLevel === "trace";
}
