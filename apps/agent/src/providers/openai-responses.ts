import { openAIReasoningEffort, type PromptAttachment } from "@zelyq/core";
import {
  buildChatGptHistory,
  buildChatGptUserContent,
  reduceChatGptHistory,
} from "./chatgpt-responses.js";
import {
  OpenAICompatibleError,
  promptCacheKey,
  readServerSentEvents,
  requireEncryptedOrLocal,
} from "./openai-compatible.js";
import type {
  Conversation,
  ConversationOptions,
  ModelProvider,
  ProviderEvent,
  ToolResult,
  TurnResult,
} from "./types.js";

type HistoryItem = ReturnType<typeof buildChatGptHistory>[number];
type ReasoningItem = {
  type: "reasoning";
  id: string;
  summary: unknown[];
  encrypted_content?: string;
};
type OutputItem = HistoryItem | ReasoningItem;
interface ResponseResult {
  status?: string;
  output?: OutputItem[];
  error?: { message?: string; code?: string };
  incomplete_details?: { reason?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}
interface ResponseEvent {
  type: string;
  delta?: string;
  response?: ResponseResult;
  message?: string;
  error?: { message?: string };
}

export function responsesUrl(baseUrl: string): string {
  const url = requireEncryptedOrLocal(baseUrl);
  let path = url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|responses)$/, "");
  if (!path.endsWith("/v1")) path += "/v1";
  url.pathname = `${path}/responses`;
  return url.toString();
}

/** Public API keys use Responses; ChatGPT credentials keep their own adapter. */
export class OpenAIResponsesProvider implements ModelProvider {
  readonly id = "openai" as const;
  private readonly endpoint: string;
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    baseUrl = "https://api.openai.com/v1",
  ) {
    this.endpoint = responsesUrl(baseUrl);
  }
  createConversation(options: ConversationOptions): Conversation {
    return new OpenAIResponsesConversation(this.model, this.apiKey, this.endpoint, options);
  }
}

class OpenAIResponsesConversation implements Conversation {
  private items: OutputItem[];
  constructor(
    private readonly model: string,
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly options: ConversationOptions,
  ) {
    this.items = buildChatGptHistory(options.history ?? []);
  }
  addUserMessage(text: string, attachments?: PromptAttachment[]): void {
    this.items.push({
      type: "message",
      role: "user",
      content: buildChatGptUserContent(text, attachments),
    });
  }
  addToolResults(results: ToolResult[]): void {
    for (const result of results) {
      this.items.push({ type: "function_call_output", call_id: result.id, output: result.output });
    }
    for (const result of results) {
      if (result.images?.length)
        this.addUserMessage(
          `Screenshot from ${result.name}:`,
          result.images.map((image) => ({ ...image, filename: "screenshot" })),
        );
    }
  }
  async *stream(signal: AbortSignal): AsyncGenerator<ProviderEvent, TurnResult, undefined> {
    // Reduce old file payloads while leaving encrypted reasoning items in place.
    this.items = reduceChatGptHistory(this.items);
    const effort = openAIReasoningEffort(this.model, this.options.effort);
    const body = {
      model: this.model,
      instructions: this.options.systemPrompt,
      input: this.items,
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: promptCacheKey(
        this.options.systemPrompt,
        this.options.tools.map((tool) => tool.name),
      ),
      ...(effort ? { reasoning: { effort } } : {}),
      ...(this.options.tools.length
        ? {
            tools: this.options.tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.input_schema,
              // Zelyq tools have optional fields; do not let Responses make them required.
              strict: false,
            })),
          }
        : {}),
    };
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) throw error;
      throw new OpenAICompatibleError(
        `Could not reach OpenAI Responses: ${(error as Error).message}`,
        0,
      );
    });
    if (!response.ok || !response.body) {
      const raw = await response.text();
      let detail = raw.slice(0, 500);
      try {
        detail = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? detail;
      } catch {
        /* Non-JSON upstream error. */
      }
      throw new OpenAICompatibleError(
        `OpenAI Responses returned ${response.status}: ${detail}`,
        response.status,
      );
    }
    let final: ResponseResult | undefined;
    let emittedText = "";
    try {
      for await (const event of readServerSentEvents<ResponseEvent>(response.body, signal)) {
        if (event.type === "response.output_text.delta" && event.delta) {
          emittedText += event.delta;
          yield { type: "text", text: event.delta };
        } else if (event.type === "response.reasoning_summary_text.delta" && event.delta) {
          yield { type: "thinking", text: event.delta };
        } else if (event.type === "error" || event.type === "response.failed") {
          throw new OpenAICompatibleError(
            event.response?.error?.message ??
              event.error?.message ??
              event.message ??
              "OpenAI response failed",
            502,
          );
        } else if (event.type === "response.completed" || event.type === "response.incomplete") {
          final = event.response;
          break;
        }
      }
    } catch (error) {
      if (signal.aborted || error instanceof OpenAICompatibleError) throw error;
      throw new OpenAICompatibleError(
        `OpenAI response stream was interrupted: ${(error as Error).message}`,
        0,
      );
    }
    signal.throwIfAborted();
    if (!final)
      throw new OpenAICompatibleError(
        "OpenAI response stream ended before completion. Please retry.",
        0,
      );
    if (final.status === "failed" || final.error)
      throw new OpenAICompatibleError(final.error?.message ?? "OpenAI response failed", 502);

    const output = final.output ?? [];
    const toolCalls: TurnResult["toolCalls"] = [];
    let fullText = "";
    let refusal: string | undefined;
    for (const item of output) {
      if (item.type === "function_call") {
        // Never execute a partly generated call with invented empty arguments.
        if (final.status === "incomplete") continue;
        if (!item.call_id || !item.name)
          throw new OpenAICompatibleError("OpenAI returned a tool call without an ID or name", 502);
        let input: unknown;
        try {
          input = JSON.parse(item.arguments);
        } catch {
          throw new OpenAICompatibleError(
            `OpenAI returned invalid arguments for ${item.name}`,
            502,
          );
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new OpenAICompatibleError(
            `OpenAI returned non-object arguments for ${item.name}`,
            502,
          );
        toolCalls.push({
          id: item.call_id,
          name: item.name,
          input: input as Record<string, unknown>,
        });
      } else if (item.type === "message") {
        for (const part of item.content as Array<{
          type: string;
          text?: string;
          refusal?: string;
        }>) {
          if (part.type === "output_text") fullText += part.text ?? "";
          if (part.type === "refusal") refusal = part.refusal;
        }
      }
    }
    if (fullText.startsWith(emittedText) && fullText.length > emittedText.length)
      yield { type: "text", text: fullText.slice(emittedText.length) };
    // Replay native items verbatim: reasoning, message IDs, phases, and call IDs
    // must survive a tool round. Incomplete calls have no executable result.
    this.items.push(
      ...output.filter((item) => final.status !== "incomplete" || item.type !== "function_call"),
    );
    const cached = final.usage?.input_tokens_details?.cached_tokens;
    return {
      toolCalls,
      stopReason:
        refusal || final.incomplete_details?.reason === "content_filter"
          ? "refusal"
          : final.status === "incomplete"
            ? "max_tokens"
            : toolCalls.length
              ? "tool_use"
              : "end_turn",
      ...(refusal ? { refusalReason: refusal } : {}),
      usage: {
        inputTokens: Math.max(0, (final.usage?.input_tokens ?? 0) - (cached ?? 0)),
        outputTokens: final.usage?.output_tokens ?? 0,
        ...(cached !== undefined ? { cacheReadInputTokens: cached } : {}),
      },
    };
  }
}
