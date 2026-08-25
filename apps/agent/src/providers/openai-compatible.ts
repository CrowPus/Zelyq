import type { PromptAttachment } from "@zelyq/core";
import type { ToolDefinition } from "@zelyq/tools";
import type {
  Conversation,
  ConversationOptions,
  Effort,
  ModelProvider,
  ProviderErrorCode,
  ProviderEvent,
  ProviderId,
  ToolResult,
  TurnResult,
} from "./types.js";

/**
 * The OpenAI chat-completions dialect, spoken over a base URL you choose.
 *
 * This is the provider that makes `001`'s buyer reachable: a team that cannot
 * send its code to a vendor can point Zelyq at a model on its own network —
 * Ollama, vLLM, LM Studio, an in-house gateway — and the file contents never
 * leave. The same implementation also serves hosted vendors that speak this
 * dialect, which is most of them.
 *
 * Written against `fetch` rather than a vendor SDK, deliberately. The base URL
 * is the entire point of this provider, and an SDK that treats it as an escape
 * hatch is the wrong shape for something whose main job is pointing elsewhere.
 *
 * **"OpenAI-compatible" is a family of dialects, not a standard.** Servers
 * disagree most about reasoning and tool calls. What is handled here:
 *
 *   - tool-call arguments arriving as string fragments across many deltas,
 *     which every server does and which is the easiest thing to get wrong;
 *   - reasoning text under `reasoning_content` (DeepSeek, vLLM) or `reasoning`
 *     (some gateways), surfaced as thinking rather than dropped;
 *   - usage that arrives only if asked for, and on some servers not at all.
 */

const REASONING_EFFORT: Record<Effort, "low" | "medium" | "high"> = {
  low: "low",
  medium: "medium",
  high: "high",
  // The dialect has three levels. Anything above "high" maps onto it rather
  // than being invented, and the mapping is stated in the docs.
  xhigh: "high",
  max: "high",
};

export interface OpenAICompatibleOptions {
  id: ProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
  /**
   * Whether to send `reasoning_effort`. Off for unknown endpoints: a server
   * that rejects unknown fields would fail every turn, and a silently ignored
   * setting is better than a provider that cannot complete a request.
   */
  supportsReasoningEffort?: boolean;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: ProviderId;
  readonly model: string;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly supportsReasoningEffort: boolean;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.supportsReasoningEffort = options.supportsReasoningEffort ?? false;
    this.endpoint = chatCompletionsUrl(options.baseUrl);
  }

  createConversation(options: ConversationOptions): Conversation {
    return new OpenAICompatibleConversation({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      model: this.model,
      supportsReasoningEffort: this.supportsReasoningEffort,
      options,
    });
  }
}

/** A message in the dialect. Assistant turns carry tool calls; results are their own role. */
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** A user message's own multi-part shape — the dialect's vision format. */
type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * Builds a user message's `content` — plain text when there are no
 * attachments (the dialect accepts a bare string there), or the multi-part
 * form when there are. A pure function so it is testable without a live
 * client or the non-exported `OpenAICompatibleConversation` class it lives
 * inside. See `037` in the council notes.
 */
export function buildOpenAIUserContent(
  text: string,
  attachments?: PromptAttachment[],
): string | ChatContentPart[] {
  if (!attachments?.length) return text;
  const content: ChatContentPart[] = attachments.map((attachment) => ({
    type: "image_url" as const,
    image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
  }));
  if (text.trim()) content.push({ type: "text", text });
  return content;
}

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

class OpenAICompatibleConversation implements Conversation {
  private readonly messages: ChatMessage[] = [];

  constructor(
    private readonly deps: {
      endpoint: string;
      apiKey: string;
      model: string;
      supportsReasoningEffort: boolean;
      options: ConversationOptions;
    },
  ) {
    // The system prompt is an ordinary message in this dialect, so it leads the
    // history rather than travelling beside it.
    this.messages.push({ role: "system", content: deps.options.systemPrompt });
    for (const message of deps.options.history ?? []) {
      if (message.content.trim()) {
        this.messages.push(
          message.role === "assistant"
            ? { role: "assistant", content: message.content }
            : { role: "user", content: message.content },
        );
      }
    }
  }

  addUserMessage(text: string, attachments?: PromptAttachment[]): void {
    this.messages.push({ role: "user", content: buildOpenAIUserContent(text, attachments) });
  }

  addToolResults(results: ToolResult[]): void {
    // One message per result, each naming the call it answers. Unlike
    // Anthropic's single user message, the dialect requires them separate and
    // in the same order the calls were made.
    for (const result of results) {
      this.messages.push({
        role: "tool",
        tool_call_id: result.id,
        content: result.output,
      });

      // A `role: "tool"` message's content is a plain string in this dialect
      // — no image-carrying variant of it exists. An image rides instead as
      // an ordinary user turn immediately after, built with the exact same
      // image-part shape `addUserMessage` already uses, labelled so the
      // model understands why a user turn appeared that it never sent. See
      // `040` in the council notes.
      if (result.images?.length) {
        this.messages.push({
          role: "user",
          content: buildOpenAIUserContent(
            `Screenshot from ${result.name}:`,
            result.images.map((image) => ({
              filename: "screenshot",
              mimeType: image.mimeType,
              data: image.data,
            })),
          ),
        });
      }
    }
  }

  async *stream(signal: AbortSignal): AsyncGenerator<ProviderEvent, TurnResult, undefined> {
    const body: Record<string, unknown> = {
      model: this.deps.model,
      messages: this.messages,
      stream: true,
      // Usage is not reported during a stream unless asked for. Servers that do
      // not know this option ignore it, and we fall back to zeros.
      stream_options: { include_usage: true },
    };
    if (this.deps.options.tools.length > 0) {
      body.tools = toOpenAITools(this.deps.options.tools);
    }
    if (this.deps.supportsReasoningEffort) {
      body.reasoning_effort = REASONING_EFFORT[this.deps.options.effort];
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    // A model on your own network usually has no key. Sending an empty bearer
    // token makes some servers reject the request outright.
    if (this.deps.apiKey) headers.authorization = `Bearer ${this.deps.apiKey}`;

    const response = await fetch(this.deps.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) throw error;
      throw new OpenAICompatibleError(
        `Could not reach the model endpoint at ${this.deps.endpoint}: ${
          (error as Error)?.message ?? String(error)
        }`,
        0,
      );
    });

    if (!response.ok || !response.body) {
      throw new OpenAICompatibleError(
        await describeFailure(response, this.deps.endpoint),
        response.status,
      );
    }

    let text = "";
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let stopReason: TurnResult["stopReason"] = "other";
    let usage = { inputTokens: 0, outputTokens: 0 };

    for await (const event of readServerSentEvents(response.body, signal)) {
      const choice = event.choices?.[0];

      if (event.usage) {
        usage = {
          inputTokens: event.usage.prompt_tokens ?? 0,
          outputTokens: event.usage.completion_tokens ?? 0,
        };
      }
      if (!choice) continue;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        yield { type: "text", text: delta.content };
      }

      // Reasoning has no agreed field name. Both spellings in the wild are
      // accepted; a server that sends neither simply produces no thinking.
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (reasoning) yield { type: "thinking", text: reasoning };

      for (const call of delta?.tool_calls ?? []) {
        // The index, not the id, is the identity: the id arrives once, on the
        // first fragment, and every later fragment carries only the index.
        const existing = toolCalls.get(call.index) ?? { id: "", name: "", arguments: "" };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name = call.function.name;
        if (call.function?.arguments) existing.arguments += call.function.arguments;
        toolCalls.set(call.index, existing);
      }

      if (choice.finish_reason) stopReason = normaliseStopReason(choice.finish_reason);
    }

    const collected = [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        // A server that omits ids still has to be answerable, and the index is
        // the only stable handle we are given.
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      }));

    // The assistant turn is echoed back verbatim, tool calls included, or the
    // next request has results answering calls that no message contains.
    this.messages.push({
      role: "assistant",
      content: text || null,
      ...(collected.length > 0
        ? {
            tool_calls: collected.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments || "{}" },
            })),
          }
        : {}),
    });

    // Some servers report "stop" even when they emitted tool calls. What the
    // model did outranks what it said it did.
    if (collected.length > 0 && stopReason !== "max_tokens") stopReason = "tool_use";

    return {
      toolCalls: collected.map((call) => ({
        id: call.id,
        name: call.name,
        input: parseArguments(call.arguments),
      })),
      stopReason,
      usage,
    };
  }
}

/**
 * Tool arguments arrive as a JSON string assembled from fragments. A model that
 * produces malformed JSON is a bad turn, not a crash: the tool reports the
 * error and the model gets a chance to correct itself.
 */
function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Server-sent events, parsed by hand.
 *
 * Chunk boundaries are network artefacts and land mid-event, so a partial line
 * is held back rather than parsed. Anything that is not valid JSON is skipped:
 * some servers emit comments and keep-alives between events.
 */
async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          yield JSON.parse(payload) as StreamChunk;
        } catch {
          // Not our event. Keep reading.
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function normaliseStopReason(reason: string): TurnResult["stopReason"] {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "other";
  }
}

/** The endpoint's own error text, which is the only thing that explains a 400. */
async function describeFailure(response: Response, endpoint: string): Promise<string> {
  const raw = await response.text().catch(() => "");
  let detail = raw.slice(0, 500);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
    const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    if (message) detail = message;
  } catch {
    // Not JSON — the truncated body is more useful than nothing.
  }
  const suffix = detail ? `: ${detail}` : "";
  return `The model endpoint at ${endpoint} returned ${response.status}${suffix}`;
}

export class OpenAICompatibleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenAICompatibleError";
  }
}

export function classifyOpenAICompatibleError(error: unknown): ProviderErrorCode {
  if (!(error instanceof OpenAICompatibleError)) return "internal";
  if (error.status === 401 || error.status === 403) return "unauthorized";
  if (error.status === 429) return "rate_limited";
  if (error.status === 0) return "connection";
  if (error.status >= 400 && error.status < 500) return "bad_request";
  if (error.status >= 500) return "model_error";
  return "internal";
}

/**
 * Where the chat-completions call actually goes.
 *
 * People paste what their server's own documentation shows them, which is
 * sometimes the root, sometimes `/v1`, and sometimes the full endpoint. All
 * three mean the same thing and all three work.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  const url = requireEncryptedOrLocal(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) return url.toString();
  const prefix = path.endsWith("/v1") ? path : `${path}/v1`;
  url.pathname = `${prefix}/chat/completions`;
  return url.toString();
}

/**
 * Plaintext is allowed to your own machine and refused everywhere else.
 *
 * This provider exists so source code can stay inside a network boundary. A
 * base URL pointing across a datacentre over `http://` would send every file
 * the agent reads in clear text — and would do it while the operator believed
 * they had solved exactly that problem. Refusing loudly is the only safe
 * failure here.
 */
export function requireEncryptedOrLocal(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      `Model endpoint is not a valid URL: "${baseUrl}". ` +
        "Set it to something like http://localhost:11434/v1 or https://models.internal/v1",
    );
  }

  if (url.protocol === "https:") return url;
  if (url.protocol !== "http:") {
    // "localhost:11434" parses, with a protocol of "localhost:". Quoting that
    // back at somebody is baffling, because they never typed it — the actual
    // mistake is a missing scheme, so say that and show what one looks like.
    throw new Error(
      `Model endpoint needs to start with http:// or https://, got "${baseUrl}". ` +
        "Set it to something like http://localhost:11434/v1 or https://models.internal/v1",
    );
  }
  if (isLoopback(url.hostname)) return url;

  throw new Error(
    `Refusing to send project files to ${url.origin} over plaintext http. ` +
      "Everything the agent reads — file contents, command output — would cross the network " +
      "unencrypted. Use https, or an address on this machine (localhost).",
  );
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // Loopback only. A `.local` mDNS name or a private 10.x address is still a
  // network, and plaintext across it is the thing this guard exists to stop —
  // "it is on our LAN" is how source code ends up on a switch somebody else
  // administers.
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}
