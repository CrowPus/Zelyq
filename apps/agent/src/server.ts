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
  /** Names of any tools loaded from `ZELYQ_PLUGIN_DIR`. Surfaced on `/health`
   * so an instance admin can confirm a plugin actually loaded from the UI
   * instead of reading the agent's own boot log. */
  pluginNames?: string[];
  /** Every loaded skill, name/description for the prompt catalog and full
   * body for the guaranteed `/`-selected weaving. The one existing reader
   * (`/health`'s badge list) reads `.name` off each entry. `resources` is
   * each skill's deeper-file listing, resolved once at boot in `index.ts`
   * (the one place with legitimate access to a skill's directory), used only
   * when Engineer Mode wires this skill's body straight into a system prompt
   * instead of through a live `use_skill` call. */
  skills?: Array<{ name: string; description: string; body: string; resources?: string[] }>;
  /** 056 — the design reference catalog (slug + one-liner each), injected
   * into the Architect's DESIGN.md step and given to the Designer child.
   * `designRefCatalogText` is the pre-rendered list; `agentMd` is the
   * brand-neutral UI-craft checklist inlined into the Architect and Engineer
   * prompts and enforced by the verifier / Designer. */
  designRefCatalog?: Array<{ slug: string; description: string }>;
  designRefCatalogText?: string;
  agentMd?: string | null;
  /** 060 — the AI provider knowledge catalog (slug + one-liner each), for an
   * AI build. `aiProviderCatalogText` is the pre-rendered list;
   * `aiProvidersAgentMd` is the integration MUST/SHOULD/NEVER checklist, both
   * rendered as `<ai_providers>` in the Architect / Engineer prompts. */
  aiProviderCatalog?: Array<{ slug: string; description: string }>;
  aiProviderCatalogText?: string;
  aiProvidersAgentMd?: string | null;
}

/** The one skill Engineer Mode is allowed to guarantee — not a generic
 * "any skill" mechanism. */
const ENGINEER_MODE_SKILL_NAME = "senior-software-engineering";
const ARCHITECT_MODE_SKILL_NAME = "report-page-design";

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
    // Fastify's own default is 1MB — far under the 8MB attachment cap once
    // an image is base64-encoded (~33% larger) and sitting inside the rest
    // of the prompt payload the server forwards here. Matches the server's
    // own bodyLimit (`app.ts`), which exists for the same reason. Left at
    // the default, an attached screenshot 500s with no useful message.
    bodyLimit: 16 * 1024 * 1024,
    // The UI polls preview status on a timer, and Fastify's per-request logging
    // turns that into ~20 lines every few seconds — enough to bury a real
    // error. Errors and explicit log calls still come through; set
    // LOG_LEVEL=debug for the request firehose when you actually want it.
    logController: new LogController({ disableRequestLogging: !isVerbose(config.logLevel) }),
    requestTimeout: 0,
  });

  const runtime = createRuntimeDriver(config.runtime);
  const sessions = new Map<string, AgentSession>();
  // Built once — skills load only at boot, never re-scanned while running,
  // so this never goes stale for the life of the process.
  const skillsByName = new Map((deps.skills ?? []).map((skill) => [skill.name, skill]));

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
      plugins: deps.pluginNames ?? [],
      // Descriptions too, not just names — the composer's `/` picker needs
      // enough to be worth choosing from; the body stays agent-side, never
      // sent here.
      skills: (deps.skills ?? []).map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
      designRefs: (deps.designRefCatalog ?? []).map((r) => r.slug),
      uiGuidelines: Boolean(deps.agentMd),
      aiProviders: (deps.aiProviderCatalog ?? []).map((p) => p.slug),
      aiIntegrationRules: Boolean(deps.aiProvidersAgentMd),
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
      // What the chat's model picker needs — every known model, not just the
      // default, so switching means choosing a tier
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

    // A Codex session speaks a different backend from the ordinary OpenAI
    // API key path, with its own model names — `defaultModelFor("openai")`
    // ("gpt-5.2") is the *other* path's default, confirmed against the
    // public API, never checked against this one. Silently sending it here
    // would fail the same way a mismatched model from any other provider
    // already does, so this asks for an explicit model instead of guessing
    // one that was never verified for
    // this endpoint, the same restraint the registry already holds every
    // vendor with no confirmed default to (xai, groq, openrouter).
    if (provider === "openai" && input.authMode === "subscription" && !input.model) {
      throw new ZelyqError(
        "bad_request",
        "A Codex session has no confirmed default model yet. Set one explicitly in Settings — " +
          "whatever model name your own Codex CLI reports using.",
      );
    }

    // Engineer Mode's effort floor: the mode's heavier reasoning (purpose
    // framing, alternatives, epistemic labeling) is inconsistent with a low
    // reasoning budget. The primary UX is client-side, but the client is
    // never the only enforcement point for a real constraint — a
    // hand-crafted request must be refused here too, the same discipline
    // every other authorization check in this route already holds.
    const resolvedEffort = input.effort ?? config.effort;
    if (input.engineerMode && input.architectMode) {
      throw new ZelyqError(
        "bad_request",
        "Engineer Mode and Architect Mode are mutually exclusive — turn one off.",
      );
    }
    if (input.autoMode && !input.architectMode) {
      throw new ZelyqError(
        "bad_request",
        "Auto Mode only runs with Architect Mode — turn Architect Mode on too.",
      );
    }
    if (input.engineerMode && (resolvedEffort === "low" || resolvedEffort === "medium")) {
      throw new ZelyqError(
        "bad_request",
        `Engineer Mode needs reasoning effort at "high" or above — this session is set to ` +
          `"${resolvedEffort}". Raise effort in Settings, or turn Engineer Mode off.`,
      );
    }
    // An Architect session also carries the senior-engineering skill,
    // because the builders it dispatches (Engineer Mode child sessions) need
    // it — even though the Architect itself never builds.
    const engineerModeSkill =
      input.engineerMode || input.architectMode
        ? deps.skills?.find((skill) => skill.name === ENGINEER_MODE_SKILL_NAME)
        : undefined;
    const architectModeSkill = input.architectMode
      ? deps.skills?.find((skill) => skill.name === ARCHITECT_MODE_SKILL_NAME)
      : undefined;

    // 066 — the stack skill a template names (`template.json` `agentSkill`),
    // force-woven into turn one so RN-vs-DOM rules are never left to chance.
    // Nothing for vite-react (no `agentSkill`), so its prompt is unchanged.
    const stackSkill = input.agentSkill
      ? deps.skills?.find((skill) => skill.name === input.agentSkill)
      : undefined;

    await runtime.ensureProject(input.projectId);

    const session = new AgentSession({
      sessionId: input.sessionId,
      projectId: input.projectId,
      projectName: input.projectId,
      template: input.template ?? "vite-react",
      ...(input.stack ? { stack: input.stack } : {}),
      ...(stackSkill ? { stackSkill: { body: stackSkill.body } } : {}),
      provider,
      model:
        input.model ?? (provider === config.provider ? config.model : defaultModelFor(provider)),
      effort: resolvedEffort,
      engineerMode: input.engineerMode ?? false,
      ...(engineerModeSkill
        ? {
            engineerModeSkill: {
              body: engineerModeSkill.body,
              resources: engineerModeSkill.resources ?? [],
            },
          }
        : {}),
      architectMode: input.architectMode ?? false,
      autoMode: input.autoMode ?? false,
      ...(architectModeSkill
        ? {
            architectModeSkill: {
              body: architectModeSkill.body,
              resources: architectModeSkill.resources ?? [],
            },
          }
        : {}),
      apiKey: apiKey ?? "",
      ...(input.authMode ? { authMode: input.authMode } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      // Anthropic identity-linked keys need their workspace id on every
      // request. A value on the request wins; otherwise the agent's own env.
      ...(input.anthropicWorkspaceId || config.anthropicWorkspaceId
        ? { anthropicWorkspaceId: input.anthropicWorkspaceId || config.anthropicWorkspaceId }
        : {}),
      // The Supabase bridge (apply migrations via the server)
      // and the linked project's public config for the preview. Absent unless
      // a Supabase resource is linked to this project.
      ...(input.supabaseBridge ? { supabaseBridge: input.supabaseBridge } : {}),
      ...(input.supabasePreviewEnv ? { supabasePreviewEnv: input.supabasePreviewEnv } : {}),
      runtime,
      maxIterations: config.maxTurnIterations,
      history: input.history,
      skills: deps.skills,
      resolveSkillBody: (name) => skillsByName.get(name),
      // 056 — the design reference catalog + the UI-craft checklist. Only
      // meaningful in Architect/Engineer Mode (where the prompt renders
      // them), but threaded unconditionally — the constructor decides.
      ...(deps.designRefCatalogText ? { designRefCatalogText: deps.designRefCatalogText } : {}),
      ...(deps.agentMd ? { agentMd: deps.agentMd } : {}),
      // 060 — the AI provider catalog + integration rules, for an AI build.
      ...(deps.aiProviderCatalogText ? { aiProviderCatalogText: deps.aiProviderCatalogText } : {}),
      ...(deps.aiProvidersAgentMd ? { aiProvidersAgentMd: deps.aiProvidersAgentMd } : {}),
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

  // The orchestration kill switch. Stops any further builder dispatch on
  // this session and aborts the current turn; a stopped run does not resume
  // on its own.
  app.post<{ Params: { id: string } }>("/sessions/:id/stop-orchestration", async (request) => {
    const session = requireSession(sessions, request.params.id);
    session.stopOrchestration();
    return session.orchestrationState;
  });

  app.get<{ Params: { id: string } }>("/sessions/:id/orchestration", async (request) => {
    return requireSession(sessions, request.params.id).orchestrationState;
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

    await session.run(
      input.message,
      emit,
      input.attachments,
      input.skills,
      input.plugins,
      input.agents,
    );
    // Auto Mode: after the build turn, keep running passes on our own until
    // the plan is done, it gets stuck, the user stops it, or a
    // ceiling is hit. `autoNextPass` emits the stop reason and returns false
    // when the run is over. Each pass streams its own turn to the client.
    while (!reply.raw.writableEnded && session.autoNextPass(emit)) {
      await session.run("keep going", emit, undefined, input.skills, input.plugins, input.agents);
    }
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
