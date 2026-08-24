import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition } from "@zelyq/tools";
import type {
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

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic" as const;

  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey });
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

  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  addToolResults(results: ToolResult[]): void {
    // Every result goes back in ONE user message. Splitting them across
    // messages teaches the model to stop calling tools in parallel.
    this.messages.push({
      role: "user",
      content: results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.id,
        content: result.output,
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
        messages: this.messages,
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
      },
    };
  }
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
