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
  /** Per-session key. Falls back to the agent process environment when absent. */
  apiKey: z.string().optional(),
  /** Endpoint for a provider speaking the OpenAI dialect; required for `custom`. */
  baseUrl: z.string().optional(),
  /** Prior turns, so a restarted agent can resume a conversation. */
  history: z.array(messageSchema).optional(),
});
export type CreateAgentSessionInput = z.infer<typeof createAgentSessionSchema>;

export const promptSchema = z.object({
  message: z.string().min(1).max(100_000),
  /** Paths the user attached as context (relative to the project root). */
  attachments: z.array(z.string()).optional(),
});
export type PromptInput = z.infer<typeof promptSchema>;

export const agentSessionStateSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  provider: providerIdSchema,
  model: z.string(),
  effort: z.string(),
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
