import { type Content, GoogleGenAI, type Part, ThinkingLevel } from "@google/genai";
import type { ToolDefinition } from "@zelyq/tools";
import type {
  Conversation,
  ConversationOptions,
  Effort,
  ModelProvider,
  ProviderErrorCode,
  ProviderEvent,
  ProviderToolCall,
  ToolResult,
  TurnResult,
} from "./types.js";

/**
 * Rebuilds Gemini's native content history from persisted turns — a pure
 * function of `history` so it is testable without a real client, the same
 * way `stream()` and `addToolResults()` build the identical shape for a
 * live turn. A past assistant turn with tool calls becomes a `model` entry
 * with a `functionCall` part per call, immediately followed by a `user`
 * entry with the matching `functionResponse` parts. `callIds` is not
 * populated for these — it exists to pair a *live* call issued this session
 * with its result; a restored pair is already fully resolved and never
 * looked up through it again.
 */
export function buildGoogleHistory(
  history: NonNullable<ConversationOptions["history"]>,
): Content[] {
  const contents: Content[] = [];
  for (const message of history) {
    if (message.role === "assistant" && message.toolCalls?.length) {
      const parts: Part[] = [];
      if (message.content.trim()) parts.push({ text: message.content });
      for (const call of message.toolCalls) {
        parts.push({ functionCall: { name: call.name, args: call.input } });
      }
      contents.push({ role: "model", parts });
      contents.push({
        role: "user",
        parts: message.toolCalls.map((call) => ({
          functionResponse: {
            name: call.name,
            response: call.isError ? { error: call.result ?? "" } : { output: call.result ?? "" },
          },
        })),
      });
    } else if (message.content.trim()) {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      });
    }
  }
  return contents;
}

export class GoogleProvider implements ModelProvider {
  readonly id = "google" as const;

  private readonly client: GoogleGenAI;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  createConversation(options: ConversationOptions): Conversation {
    return new GoogleConversation(this.client, this.model, options);
  }
}

class GoogleConversation implements Conversation {
  private readonly contents: Content[];
  /**
   * Gemini identifies a function response by name, not by an id it always
   * supplies. We mint stable ids for our own event stream and remember the
   * mapping so results are paired with the right call.
   */
  private readonly callIds = new Map<string, string | undefined>();
  private callCounter = 0;

  constructor(
    private readonly client: GoogleGenAI,
    private readonly model: string,
    private readonly options: ConversationOptions,
  ) {
    this.contents = buildGoogleHistory(options.history ?? []);
  }

  addUserMessage(text: string): void {
    this.contents.push({ role: "user", parts: [{ text }] });
  }

  addToolResults(results: ToolResult[]): void {
    // All results in one user turn, matching the parallel calls the model made.
    this.contents.push({
      role: "user",
      parts: results.map((result) => ({
        functionResponse: {
          ...(this.callIds.get(result.id) ? { id: this.callIds.get(result.id) } : {}),
          name: result.name,
          // Gemini treats "output" as the result and "error" as a failure; any
          // other key would be handed back as opaque data.
          response: result.isError ? { error: result.output } : { output: result.output },
        },
      })),
    });
  }

  async *stream(signal: AbortSignal): AsyncGenerator<ProviderEvent, TurnResult, undefined> {
    const stream = await this.client.models.generateContentStream({
      model: this.model,
      contents: this.contents,
      config: {
        systemInstruction: this.options.systemPrompt,
        tools: [{ functionDeclarations: toFunctionDeclarations(this.options.tools) }],
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: toThinkingLevel(this.options.effort),
        },
        abortSignal: signal,
      },
    });

    // Assistant parts are accumulated and replayed verbatim. Gemini attaches a
    // thoughtSignature to reasoning parts and requires them back unchanged on
    // the next request — rebuilding the turn from text alone breaks multi-step
    // tool use.
    const parts: Part[] = [];
    const toolCalls: ProviderToolCall[] = [];
    let stopReason: TurnResult["stopReason"] = "end_turn";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens =
          (chunk.usageMetadata.candidatesTokenCount ?? 0) +
          (chunk.usageMetadata.thoughtsTokenCount ?? 0);
      }

      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) stopReason = normaliseFinishReason(candidate.finishReason);

      for (const part of candidate?.content?.parts ?? []) {
        parts.push(part);

        if (part.functionCall?.name) {
          const id = `call_${++this.callCounter}`;
          this.callIds.set(id, part.functionCall.id);
          toolCalls.push({
            id,
            name: part.functionCall.name,
            input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          });
          continue;
        }

        if (typeof part.text === "string" && part.text.length > 0) {
          yield part.thought
            ? { type: "thinking", text: part.text }
            : { type: "text", text: part.text };
        }
      }
    }

    if (parts.length > 0) this.contents.push({ role: "model", parts });
    if (toolCalls.length > 0) stopReason = "tool_use";

    return {
      toolCalls,
      stopReason,
      usage: { inputTokens, outputTokens },
    };
  }
}

/**
 * Gemini accepts JSON Schema directly through `parametersJsonSchema`, so tool
 * definitions need no translation — only a scrub of the keys the API rejects.
 */
export function toFunctionDeclarations(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: scrubSchema(tool.input_schema),
  }));
}

const UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "$id", "$ref", "definitions", "$defs"]);

function scrubSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSchema);
  if (value === null || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    result[key] = scrubSchema(nested);
  }
  return result;
}

/** Zelyq's five effort levels onto Gemini's thinking levels. */
export function toThinkingLevel(effort: Effort): ThinkingLevel {
  switch (effort) {
    case "low":
      return ThinkingLevel.LOW;
    case "medium":
      return ThinkingLevel.MEDIUM;
    default:
      // high, xhigh, and max all map to Gemini's deepest setting.
      return ThinkingLevel.HIGH;
  }
}

function normaliseFinishReason(reason: string): TurnResult["stopReason"] {
  switch (reason) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
    case "SPII":
      return "refusal";
    default:
      return "other";
  }
}

/**
 * Gemini errors arrive as JSON nested inside a JSON string inside the SDK's
 * message. Shown raw, the user sees three levels of braces around one useful
 * sentence, so unwrap to that sentence.
 */
export function describeGoogleError(error: unknown): string {
  const raw = (error as Error)?.message ?? String(error);
  let current: unknown = raw;

  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "string") break;
    const start = current.indexOf("{");
    if (start === -1) break;
    try {
      const parsed = JSON.parse(current.slice(start)) as { error?: { message?: string } };
      const message = parsed.error?.message;
      if (typeof message !== "string") break;
      current = message;
    } catch {
      break;
    }
  }

  return typeof current === "string" && current.trim() ? current.trim() : raw;
}

export function classifyGoogleError(error: unknown): ProviderErrorCode {
  const status = (error as { status?: number })?.status;
  const message = (error as Error)?.message ?? "";

  if (status === 401 || status === 403 || /API key/i.test(message)) return "unauthorized";
  if (status === 429 || /quota|rate limit/i.test(message)) return "rate_limited";
  if (status === 400) return "bad_request";
  if (status && status >= 500) return "model_error";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) return "connection";
  return "internal";
}
