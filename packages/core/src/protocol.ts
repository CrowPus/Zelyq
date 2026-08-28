import { z } from "zod";
import {
  effortSchema,
  messageSchema,
  previewSchema,
  providerIdSchema,
  toolCallSchema,
} from "./models.js";

/**
 * The wire protocol, defined once and imported by every process.
 *
 * There are two hops and they carry the same event vocabulary:
 *
 *   agent ──SSE──▶ server ──WebSocket──▶ browser
 *
 * Keeping one `agentEventSchema` for both hops means the server relays rather
 * than translates, and a new event type reaches the UI by being added here.
 */

// ---------------------------------------------------------------------------
// Agent events (agent → server → browser)
// ---------------------------------------------------------------------------

export const agentEventSchema = z.discriminatedUnion("type", [
  /** A turn began. `messageId` is the assistant message the deltas belong to. */
  z.object({
    type: z.literal("turn.start"),
    sessionId: z.string(),
    messageId: z.string(),
    at: z.string().datetime(),
  }),

  /** Streamed assistant prose. */
  z.object({
    type: z.literal("text.delta"),
    sessionId: z.string(),
    messageId: z.string(),
    text: z.string(),
  }),

  /** Streamed reasoning summary, when the model is configured to return one. */
  z.object({
    type: z.literal("thinking.delta"),
    sessionId: z.string(),
    messageId: z.string(),
    text: z.string(),
  }),

  /** A tool is about to run. Emitted before execution so the UI can show it live. */
  z.object({
    type: z.literal("tool.start"),
    sessionId: z.string(),
    messageId: z.string(),
    call: toolCallSchema,
  }),

  /** A tool finished. `call.result` is truncated for display; full output stays server-side. */
  z.object({
    type: z.literal("tool.end"),
    sessionId: z.string(),
    messageId: z.string(),
    call: toolCallSchema,
  }),

  /** Files the turn touched, so the UI can refresh the tree and open editors. */
  z.object({
    type: z.literal("files.changed"),
    sessionId: z.string(),
    paths: z.array(z.string()),
  }),

  /** Token accounting for the turn so far. */
  z.object({
    type: z.literal("usage"),
    sessionId: z.string(),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
  }),

  /** The turn is complete. `message` is the persisted assistant message. */
  z.object({
    type: z.literal("turn.end"),
    sessionId: z.string(),
    messageId: z.string(),
    stopReason: z.string().nullable(),
    message: messageSchema.optional(),
  }),

  /** The turn was cancelled by the user. */
  z.object({
    type: z.literal("aborted"),
    sessionId: z.string(),
    messageId: z.string().optional(),
  }),

  /**
   * 053 — a named specialist child agent (the Designer, the verifier, a
   * builder) doing something worth showing the user as a distinct,
   * labelled sub-thread. Forwarded from the child's own run up to the
   * parent's event stream. `messageId` is the parent assistant message the
   * dispatch belongs to; `agent` names which specialist; `phase` is
   * "start" once, "step" many times, "end" once with the outcome in
   * `title`. Additive: a client that does not know this type ignores it.
   */
  z.object({
    type: z.literal("agent.activity"),
    sessionId: z.string(),
    messageId: z.string(),
    agent: z.enum(["designer", "devops", "security", "verifier", "builder"]),
    phase: z.enum(["start", "step", "end"]),
    title: z.string(),
    detail: z.string().optional(),
  }),

  /** The turn failed. The session stays usable unless `fatal` is set. */
  z.object({
    type: z.literal("error"),
    sessionId: z.string(),
    code: z.string(),
    message: z.string(),
    fatal: z.boolean().default(false),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentEventType = AgentEvent["type"];

// ---------------------------------------------------------------------------
// Agent HTTP API (server → agent)
// ---------------------------------------------------------------------------

export const createAgentSessionSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  provider: providerIdSchema.optional(),
  model: z.string().optional(),
  effort: effortSchema.optional(),
  /** ZED-0001, Phase 1: guarantees the senior-engineering behavior profile
   * for this session instead of the default fast-implementer prompt.
   * Requires `effort` at `high` or above — the agent refuses otherwise. */
  engineerMode: z.boolean().optional(),
  /** 048 — Architect Mode, Phase 1. Interview + design + a package under
   * `architecture/`; writes nothing outside it and runs no commands.
   * Mutually exclusive with `engineerMode` — the agent rejects both. */
  architectMode: z.boolean().optional(),
  /** 051 Part B — Auto Mode. Only with `architectMode`. After the user says
   * to build, the Architect runs build passes back to back on its own until
   * the plan is done, it gets stuck, the user stops it, or a hard ceiling
   * (6M tokens / 6 passes / 30 min) is hit. */
  autoMode: z.boolean().optional(),
  /** Per-session key. Falls back to the agent process environment when absent. */
  apiKey: z.string().optional(),
  /**
   * `"subscription"` means `apiKey` above actually holds an OAuth token read
   * from a locally-installed CLI's own session (Claude Code today), not a
   * classic API key — see `045` in the council notes. Absent, or
   * `"api_key"`, is the ordinary path and needs no change anywhere it
   * already worked.
   */
  authMode: z.enum(["api_key", "subscription"]).optional(),
  /** Endpoint for a provider speaking the OpenAI dialect; required for `custom`. */
  baseUrl: z.string().optional(),
  /** Prior turns, so a restarted agent can resume a conversation. */
  history: z.array(messageSchema).optional(),
});
export type CreateAgentSessionInput = z.infer<typeof createAgentSessionSchema>;

/**
 * A resolved attachment, exactly as a provider needs to embed it — never an
 * ID the agent would have to look up itself. The agent has no access to the
 * server's attachment storage (a different process, possibly a different
 * machine for a remote runtime); the server resolves an ID to these bytes
 * before this ever reaches here. See `037` in the council notes.
 */
export const promptAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  /** Base64-encoded bytes. */
  data: z.string(),
});
export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;

export const promptSchema = z.object({
  message: z.string().min(1).max(100_000),
  attachments: z.array(promptAttachmentSchema).optional(),
  /** Names only — the agent already has every skill's full body loaded
   * (`042`) and weaves the selected ones into the message itself before the
   * turn starts. See `044` in the council notes. */
  skills: z.array(z.string()).optional(),
  /** Names of any plugin tools picked from the same `/` menu — see `044`'s
   * follow-up. A plugin has no body to guarantee the way a skill's does; a
   * name here becomes a clear instruction to use that tool, woven into the
   * message the same way, but honestly not the same kind of promise. */
  plugins: z.array(z.string()).optional(),
});
export type PromptInput = z.infer<typeof promptSchema>;

export const agentSessionStateSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  provider: providerIdSchema,
  model: z.string(),
  effort: z.string(),
  /** See ZED-0001. `ensureSession` recreates the session when this changes,
   * the same as a changed provider already does. */
  engineerMode: z.boolean(),
  /** See 048. `ensureSession` recreates the session when this changes. */
  architectMode: z.boolean(),
  /** See 051 Part B. `ensureSession` recreates the session when this changes. */
  autoMode: z.boolean(),
  /** See `045` — whether this session is authenticated with a classic key
   * or a CLI-sourced subscription token. `ensureSession` recreates the
   * session when this changes, the same as a changed provider already does. */
  authMode: z.enum(["api_key", "subscription"]),
  busy: z.boolean(),
  turns: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
});
export type AgentSessionState = z.infer<typeof agentSessionStateSchema>;

// ---------------------------------------------------------------------------
// Browser WebSocket protocol (browser ↔ server)
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt"),
    message: z.string().min(1),
    attachments: z.array(z.string()).optional(),
    /**
     * Picked from the chat's own model control — see `033`. Omitted means
     * the live-configured default, exactly as before this existed. Present
     * without `model` means "this provider's default model."
     */
    provider: providerIdSchema.optional(),
    model: z.string().optional(),
    /** Picked from the composer's `/` skill picker — see `044`. Names only. */
    skills: z.array(z.string()).optional(),
    /** Picked from the same `/` menu's Plugins section — names only. */
    plugins: z.array(z.string()).optional(),
    /** Engineer Mode toggle — see ZED-0001. Omitted or false means the
     * default fast-implementer behavior, unchanged. */
    engineerMode: z.boolean().optional(),
    /** Architect Mode toggle — see 048. Mutually exclusive with engineerMode. */
    architectMode: z.boolean().optional(),
    /** Auto Mode toggle — see 051 Part B. Only with architectMode. */
    autoMode: z.boolean().optional(),
  }),
  z.object({ type: z.literal("abort") }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.union([
  z.object({
    type: z.literal("connected"),
    sessionId: z.string(),
    projectId: z.string(),
    history: z.array(messageSchema),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("preview"), preview: previewSchema }),
  agentEventSchema,
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/** Encode an event as one SSE frame. Newlines inside data would break the frame. */
export function encodeSse(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// ---------------------------------------------------------------------------
// GET /api/providers (browser ← server) — see `033`
// ---------------------------------------------------------------------------

/**
 * What the chat's model picker needs, and nothing else: never a key, never
 * which environment variable backs one — the same restraint the agent's own
 * `GET /providers` already has. Available to anyone signed in, unlike
 * `/api/settings`, because none of this is sensitive on its own.
 */
export const availableProvidersSchema = z.object({
  default: providerIdSchema,
  providers: z.array(
    z.object({
      id: providerIdSchema,
      label: z.string(),
      defaultModel: z.string(),
      configured: z.boolean(),
      /**
       * Every known-current model for this vendor — Opus, Sonnet, Haiku, not
       * just "Claude" — so the picker offers a tier, not only a vendor.
       * Absent means nothing is confirmed yet for this provider.
       */
      models: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    }),
  ),
});
export type AvailableProviders = z.infer<typeof availableProvidersSchema>;
