import type { PromptAttachment, ToolCall } from "@zelyq/core";
import type { ToolDefinition } from "@zelyq/tools";

/**
 * The seam between Zelyq and a model vendor.
 *
 * Providers differ in more than parameter names: message shapes, how reasoning
 * is represented, how tool calls are identified, and what must be echoed back
 * verbatim to keep a turn coherent. Rather than flatten all of that into a
 * lossy neutral format, each provider keeps its own **native** history and this
 * interface only carries what the agent actually needs:
 *
 *   - append a user message,
 *   - stream one model round-trip,
 *   - append the results of the tools that round-trip asked for.
 *
 * That keeps provider-specific requirements — Anthropic's content blocks,
 * Gemini's thought signatures — inside the provider where they belong.
 */
export interface Conversation {
  /**
   * `attachments` are images only — see `037` in the council notes. A
   * non-image attachment is inlined into `text` by the caller before this
   * is ever reached, so every implementation only has one native shape
   * (text plus optional images) to build, not two.
   */
  addUserMessage(text: string, attachments?: PromptAttachment[]): void;

  /**
   * One model round-trip. Yields deltas as they arrive and returns what the
   * model decided when the round-trip completes. Implementations must append
   * the assistant turn to their own history before returning.
   */
  stream(signal: AbortSignal): AsyncGenerator<ProviderEvent, TurnResult, undefined>;

  addToolResults(results: ToolResult[]): void;
}

export type ProviderEvent = { type: "text"; text: string } | { type: "thinking"; text: string };

export interface TurnResult {
  toolCalls: ProviderToolCall[];
  /** Provider-native reason, normalised where it is meaningful to the UI. */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";
  /** Present when the provider explains a refusal. */
  refusalReason?: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  output: string;
  isError: boolean;
  /** See `040` in the council notes — same shape `@zelyq/tools`' own `ToolResult.images` uses. */
  images?: Array<{ mimeType: string; data: string }>;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ConversationOptions {
  systemPrompt: string;
  tools: ToolDefinition[];
  effort: Effort;
  /**
   * Prior turns, used to rebuild context after a restart. `toolCalls`
   * carries what a past assistant turn actually did — each provider
   * reconstructs its own native tool_use/tool_result shape from it, the
   * same shape `addToolResults` already builds for a live turn. A turn
   * that was nothing but tool calls has empty `content`; it is still a
   * real history entry, not an empty one to be dropped.
   */
  history?: Array<{ role: "user" | "assistant"; content: string; toolCalls?: ToolCall[] }>;
}

export interface ModelProvider {
  readonly id: ProviderId;
  readonly model: string;
  createConversation(options: ConversationOptions): Conversation;
}

export type ProviderId =
  | "anthropic"
  | "google"
  | "openai"
  | "xai"
  | "deepseek"
  | "mistral"
  | "groq"
  | "openrouter"
  | "custom";

export type AuthMode = "api_key" | "subscription";

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  /**
   * `"subscription"` means `apiKey` is actually an OAuth token read from a
   * locally-installed CLI's own session, not a classic API key — see `045`
   * in the council notes. A provider that doesn't support this mode simply
   * ignores it and treats `apiKey` as it always has.
   */
  authMode?: AuthMode;
  /**
   * Where to send the request. Only meaningful for providers that speak the
   * OpenAI dialect, and required for `custom` — which has no address of its
   * own, because supplying one is the entire point of it.
   */
  baseUrl?: string;
}

/**
 * Normalises a provider SDK error into a stable code the UI can branch on.
 * Providers implement the vendor-specific part; this is the shared vocabulary.
 */
export type ProviderErrorCode =
  | "unauthorized"
  | "rate_limited"
  | "bad_request"
  | "connection"
  | "model_error"
  | "internal";
