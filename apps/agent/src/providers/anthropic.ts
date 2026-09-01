import Anthropic from "@anthropic-ai/sdk";
import type { PromptAttachment } from "@zelyq/core";
import type { ToolDefinition } from "@zelyq/tools";
import type {
  AuthMode,
  Conversation,
  ConversationOptions,
  ModelProvider,
  ProviderErrorCode,
  ProviderEvent,
  ToolResult,
  TurnResult,
} from "./types.js";

const MAX_TOKENS = 64_000;

/**
 * The header Claude Code's own CLI sends alongside an OAuth session token —
 * required for the Messages API to accept a subscription token in place of
 * an API key at all. Undocumented as a public API surface (this is what a
 * first-party client sends, not a published contract), so it must be
 * confirmed by trying it against a real account, not assumed. If the vendor
 * ever changes it, a subscription-mode
 * request starts failing with a normal `unauthorized`, the same as an
 * expired token would — not a silent wrong answer.
 */
const OAUTH_BETA_HEADER = "claude-code-20250219,oauth-2025-04-20";

/**
 * Rebuilds Anthropic's native message history from persisted turns — a pure
 * function of `history` so it is testable without a real client, the same
 * way `stream()` and `addToolResults()` build the identical shape for a
 * live turn. A past assistant turn with tool calls becomes exactly what one
 * would have looked like live: an assistant message with a `tool_use` block
 * per call, immediately followed by a user message with the matching
 * `tool_result` blocks. No thinking block — the requirement to echo one
 * back unchanged applies to keeping one in-progress tool-use round-trip
 * coherent, not to how an already-resolved turn is represented in a fresh
 * request's history.
 */
export function buildAnthropicHistory(
  history: NonNullable<ConversationOptions["history"]>,
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const message of history) {
    if (message.role === "assistant" && message.toolCalls?.length) {
      const content: Anthropic.MessageParam["content"] = [];
      if (message.content.trim()) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: message.toolCalls.map((call) => ({
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: call.result ?? "",
          is_error: call.isError ?? false,
        })),
      });
    } else if (message.content.trim()) {
      messages.push({ role: message.role, content: message.content });
    }
  }
  return messages;
}

/**
 * Builds the `content` for one user turn — plain text when there are no
 * attachments (Anthropic accepts a bare string there), or the block-array
 * form when there are. A pure function of its arguments, same reason
 * `buildAnthropicHistory` is: testable without a live client or the
 * non-exported `AnthropicConversation` class it lives inside. Images before
 * text — the documented Anthropic convention, and a model reads what it's
 * looking at before the caption for it.
 */
export function buildAnthropicUserContent(
  text: string,
  attachments?: PromptAttachment[],
): Anthropic.MessageParam["content"] {
  if (!attachments?.length) return text;
  const content: Anthropic.MessageParam["content"] = attachments.map((attachment) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: attachment.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
      data: attachment.data,
    },
  }));
  if (text.trim()) content.push({ type: "text", text });
  return content;
}

/**
 * A `tool_result` block's own `content` can be a plain string or an array of
 * blocks — images included, natively, no workaround needed. Stays a plain
 * string when there are no images, so a result without one produces the
 * exact wire shape it always has.
 */
export function buildAnthropicToolResultContent(
  result: ToolResult,
): Anthropic.ToolResultBlockParam["content"] {
  if (!result.images?.length) return result.output;
  const content: Anthropic.ToolResultBlockParam["content"] = result.images.map((image) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: image.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
      data: image.data,
    },
  }));
  content.push({ type: "text", text: result.output });
  return content;
}

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;

  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
    authMode: AuthMode = "api_key",
    /**
     * Set only for an identity-linked (workspace-scoped) API key: the
     * Messages API 400s such a key unless the request also names its
     * workspace. Sent as the `anthropic-workspace-id` header. Harmless to
     * omit for an ordinary account-level key.
     */
    workspaceId?: string,
  ) {
    // A subscription token is Bearer auth, not `x-api-key` — the SDK already
    // has a first-class option for that (`authToken`), same client either
    // way. The beta header is the part unique to a Claude Code-issued token;
    // sending it with an ordinary API key would be harmless but is left off
    // to keep a normal request looking exactly like it always has.
    const workspaceHeader = workspaceId ? { "anthropic-workspace-id": workspaceId } : {};
    this.client =
      authMode === "subscription"
        ? new Anthropic({
            authToken: apiKey,
            defaultHeaders: { "anthropic-beta": OAUTH_BETA_HEADER, ...workspaceHeader },
          })
        : new Anthropic({
            apiKey,
            ...(workspaceId ? { defaultHeaders: workspaceHeader } : {}),
          });
  }

  createConversation(options: ConversationOptions): Conversation {
    return new AnthropicConversation(this.client, this.model, options);
  }
}

class AnthropicConversation implements Conversation {
  private readonly messages: Anthropic.MessageParam[];

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly options: ConversationOptions,
  ) {
    this.messages = buildAnthropicHistory(options.history ?? []);
  }

  addUserMessage(text: string, attachments?: PromptAttachment[]): void {
    this.messages.push({ role: "user", content: buildAnthropicUserContent(text, attachments) });
  }

  addToolResults(results: ToolResult[]): void {
    // Every result goes back in ONE user message. Splitting them across
    // messages teaches the model to stop calling tools in parallel.
    this.messages.push({
      role: "user",
      content: results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.id,
        content: buildAnthropicToolResultContent(result),
        is_error: result.isError,
      })),
    });
  }

  async *stream(signal: AbortSignal): AsyncGenerator<ProviderEvent, TurnResult, undefined> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: [
          // Prompt and tool list are stable for the session, so this breakpoint
          // is what keeps a long turn affordable.
          { type: "text", text: this.options.systemPrompt, cache_control: { type: "ephemeral" } },
        ],
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: this.options.effort },
        tools: toAnthropicTools(this.options.tools),
        // A second breakpoint on the last message caches the whole conversation
        // prefix — every prior assistant turn and tool result. Without it an
        // agentic turn re-pays full input price for the entire growing
        // transcript on every step, which on an expensive model is the
        // difference between cents and tens of dollars for one build.
        messages: withConversationCacheBreakpoint(this.messages),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      if (event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      } else if (event.delta.type === "thinking_delta") {
        yield { type: "thinking", text: event.delta.thinking };
      }
    }

    const response = await stream.finalMessage();

    // Echoed back unchanged — thinking blocks included, which the API requires
    // when continuing a turn on the same model.
    this.messages.push({ role: "assistant", content: response.content });

    const toolCalls = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      }));

    return {
      toolCalls,
      stopReason: normaliseStopReason(response.stop_reason),
      refusalReason:
        response.stop_details && "category" in response.stop_details
          ? String(response.stop_details.category)
          : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        // `input_tokens` above is the UNCACHED remainder. These two are the
        // rest of the prompt — captured so the cache can actually be measured
        // (finding A4). `?? undefined` keeps an unreported figure honest.
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
      },
    };
  }
}

/**
 * Returns a copy of `messages` with `cache_control` breakpoints on the last
 * TWO message boundaries. The conversation prefix up to the earlier of them is
 * then served from Anthropic's prompt cache on the next step at ~10% of the
 * input price, instead of being re-charged in full on every agentic iteration.
 *
 * Two, not one: the cache is written on request N and read on request N+1. The
 * array grows by one or two messages per round (an assistant turn, then its
 * tool-results message), so request N+1's own tail sits *past* request N's
 * breakpoint. Marking the previous boundary as well as the current one means
 * request N+1 reads everything up to that previous mark from cache and writes a
 * fresh one at its new tail — the standard incremental pattern, and why the API
 * allows four breakpoints. System is the third; one is left spare.
 *
 * `messages` itself is never mutated, so no stale breakpoints accumulate.
 */
export function withConversationCacheBreakpoint(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  // Mark the last block of the last message, and of the one before it.
  const markAt = new Set([messages.length - 1, messages.length - 2].filter((i) => i >= 0));
  return messages.map((message, index) => {
    if (!markAt.has(index)) return message;
    const blocks: Anthropic.ContentBlockParam[] =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : [...message.content];
    if (blocks.length === 0) return message;
    blocks[blocks.length - 1] = {
      ...blocks[blocks.length - 1],
      cache_control: { type: "ephemeral" },
    } as Anthropic.ContentBlockParam;
    return { role: message.role, content: blocks };
  });
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Anthropic.Tool["input_schema"],
  }));
}

function normaliseStopReason(reason: string | null): TurnResult["stopReason"] {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

export function classifyAnthropicError(error: unknown): ProviderErrorCode {
  if (error instanceof Anthropic.AuthenticationError) return "unauthorized";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (error instanceof Anthropic.BadRequestError) return "bad_request";
  if (error instanceof Anthropic.APIConnectionError) return "connection";
  if (error instanceof Anthropic.APIError) return "model_error";
  return "internal";
}

/**
 * The SDK's own `.message` for a rate limit or auth failure is often just
 * the raw HTTP status and JSON body verbatim (`429 {"type":"error",...}`),
 * which is otherwise shown to a real person exactly like that. Real error
 * subclasses are already available to branch on, which is a better signal
 * than parsing a string — Google's own `describeGoogleError` has to unwrap
 * JSON by hand because it doesn't get typed errors the way this SDK does.
 */
export function describeAnthropicError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) {
    return (
      "Claude is rate-limiting requests on this account right now. A Claude Code session " +
      "shares its usage with everything else signed into that account, so this can happen " +
      "faster than a dedicated API key would. Wait a moment and try again, or switch " +
      "providers for now."
    );
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return (
      "Claude rejected this request's credentials. If this account is using a Claude Code " +
      "session instead of an API key, it may have expired — reconnect it from Settings."
    );
  }

  const raw = (error as Error)?.message ?? String(error);
  const start = raw.indexOf("{");
  if (start === -1) return raw;
  try {
    const parsed = JSON.parse(raw.slice(start)) as { error?: { message?: string } };
    const message = parsed.error?.message;
    // "Error" is the SDK's own generic placeholder, not a real explanation —
    // worse than the raw string, not better, so it doesn't win.
    return message && message !== "Error" ? message : raw;
  } catch {
    return raw;
  }
}
