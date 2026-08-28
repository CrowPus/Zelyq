import type { PromptAttachment } from "@zelyq/core";
import type { ToolDefinition } from "@zelyq/tools";
import { readServerSentEvents } from "./openai-compatible.js";
import type {
  Conversation,
  ConversationOptions,
  ModelProvider,
  ProviderErrorCode,
  ProviderEvent,
  ToolResult,
  TurnResult,
} from "./types.js";

/**
 * A Codex CLI "Sign in with ChatGPT" session.
 *
 * This is a materially different situation from Claude's subscription mode.
 * Claude's OAuth token is a different *auth header* on the same public,
 * documented Messages API — confirmed working against a real account. A
 * Codex/ChatGPT session token is only valid against a private, undocumented
 * endpoint OpenAI has never published for outside use
 * (`chatgpt.com/backend-api/codex/responses`), speaking the Responses API,
 * not the Chat Completions dialect `OpenAICompatibleProvider` speaks. Real,
 * working third-party integrations exist (opencodex, codex-proxy) and this
 * follows the same request shape they publish — researched, not guessed —
 * but it remains genuinely unverified against a live account until it's
 * actually tried, the same bar every other vendor integration was held to.
 * Expect it to be more fragile than the public API: real bug reports
 * describe truncated SSE payloads and dropped connections on this exact
 * endpoint, independent of anything Zelyq does.
 */

const RESPONSES_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/**
 * A Codex session needs two values this endpoint requires as separate
 * headers — the access token and the account id the endpoint bills against
 * (dropping the account id header is a confirmed 401/403, not optional).
 * `ProviderConfig.apiKey` only ever carries one string, the same seam every
 * other provider already uses, so both are packed into it rather than
 * widening that seam just for this one case. Packed once, server-side,
 * where the credential file is actually read; unpacked once, here.
 */
export function packCodexCredential(accessToken: string, accountId: string): string {
  return `${accessToken}:${accountId}`;
}

export function unpackCodexCredential(
  packed: string,
): { accessToken: string; accountId: string } | null {
  const separator = packed.indexOf(":");
  if (separator === -1) return null;
  const accessToken = packed.slice(0, separator);
  const accountId = packed.slice(separator + 1);
  return accessToken && accountId ? { accessToken, accountId } : null;
}

/** One item in the Responses API's `input` array — the shape a whole
 * conversation is built from, not just the newest turn. */
type InputItem =
  | { type: "message"; role: "user" | "assistant"; content: InputContentPart[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

type InputContentPart =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "input_image"; image_url: string };

export function buildChatGptUserContent(
  text: string,
  attachments?: PromptAttachment[],
): InputContentPart[] {
  const parts: InputContentPart[] = (attachments ?? []).map((attachment) => ({
    type: "input_image" as const,
    image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
  }));
  if (text.trim() || parts.length === 0) parts.push({ type: "input_text", text });
  return parts;
}

/** Rebuilds the Responses API's `input` history from persisted turns — the
 * same job `buildAnthropicHistory` and the OpenAI-dialect constructor do
 * for their own providers, just this format's item shapes. */
export function buildChatGptHistory(
  history: NonNullable<ConversationOptions["history"]>,
): InputItem[] {
  const items: InputItem[] = [];
  for (const message of history) {
    if (message.role === "assistant" && message.toolCalls?.length) {
      if (message.content.trim()) {
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: message.content }],
        });
      }
      for (const call of message.toolCalls) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.input),
        });
        items.push({
          type: "function_call_output",
          call_id: call.id,
          output: call.result ?? "",
        });
      }
    } else if (message.content.trim()) {
      items.push({
        type: "message",
        role: message.role === "assistant" ? "assistant" : "user",
        content: [
          message.role === "assistant"
            ? { type: "output_text", text: message.content }
            : { type: "input_text", text: message.content },
        ],
      });
    }
  }
  return items;
}

export class ChatGptResponsesProvider implements ModelProvider {
  readonly id = "openai" as const;

  constructor(
    readonly model: string,
    private readonly accessToken: string,
    private readonly accountId: string,
    /** Overridable so tests can prove the real request/SSE-parsing logic
     * against a local stand-in instead of the real private endpoint. */
    private readonly endpoint: string = RESPONSES_ENDPOINT,
  ) {}

  createConversation(options: ConversationOptions): Conversation {
    return new ChatGptResponsesConversation(
      this.model,
      this.accessToken,
      this.accountId,
      this.endpoint,
      options,
    );
  }
}

// The event shapes actually needed here — not the whole Responses API
// surface, which is far larger than one agent loop uses. Fields not
// listed are simply ignored by the `for await` loop below, the same way
// `readServerSentEvents`'s callers elsewhere in this codebase only read
// what they need from a wider wire format.
interface ResponsesStreamEvent {
  type: string;
  delta?: string;
  item?:
    | { type: "function_call"; call_id?: string; name?: string; arguments?: string }
    | { type: string; [key: string]: unknown };
  response?: {
    output?: Array<
      | { type: "message"; content?: Array<{ type: string; text?: string }> }
      | { type: "function_call"; call_id: string; name: string; arguments: string }
      | { type: string }
    >;
    status?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
}

class ChatGptResponsesConversation implements Conversation {
  private readonly items: InputItem[];

  constructor(
    private readonly model: string,
    private readonly accessToken: string,
    private readonly accountId: string,
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
      this.items.push({
        type: "function_call_output",
        call_id: result.id,
        // Images inside a tool result have no carrier in this item type —
        // the same gap `openai-compatible.ts` fills with a trailing user
        // turn. Text-only for now; a Codex-session turn that calls a
        // screenshot-producing tool loses the image until this is
        // extended the same way, named rather than silently dropped.
        output: result.output,
      });
    }
  }

  async *stream(signal: AbortSignal): AsyncGenerator<ProviderEvent, TurnResult, undefined> {
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: this.options.systemPrompt,
      input: this.items,
      stream: true,
      // Zelyq keeps its own history and resends it each turn — the same
      // reason `store: false` is right here that every other provider in
      // this codebase never depends on vendor-side conversation state.
      store: false,
    };
    if (this.options.tools.length > 0) {
      body.tools = toResponsesTools(this.options.tools);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "chatgpt-account-id": this.accountId,
        "content-type": "application/json",
        accept: "text/event-stream",
        // Required to be accepted by this endpoint at all — confirmed via
        // public research into real client traffic, the same category of
        // requirement Claude's own OAuth beta header is. Not a device or
        // login impersonation; this only shapes a request made with a
        // token the user's own Codex CLI already issued and stored.
        "openai-beta": "responses=experimental",
        originator: "codex_cli_rs",
      },
      body: JSON.stringify(body),
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) throw error;
      throw new ChatGptResponsesError(
        `Could not reach the Codex session endpoint: ${(error as Error)?.message ?? String(error)}`,
        0,
      );
    });

    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "");
      throw new ChatGptResponsesError(
        `Codex session request returned ${response.status}${raw ? `: ${raw.slice(0, 500)}` : ""}`,
        response.status,
      );
    }

    let text = "";
    let finalOutput: ResponsesStreamEvent["response"] | undefined;

    for await (const event of readServerSentEvents<ResponsesStreamEvent>(response.body, signal)) {
      if (event.type === "response.output_text.delta" && event.delta) {
        text += event.delta;
        yield { type: "text", text: event.delta };
      } else if (event.type === "response.completed" || event.type === "response.failed") {
        finalOutput = event.response;
      }
    }

    // The completed event's own `output` array is the ground truth — built
    // to be correct even if a delta event this file doesn't recognise
    // (this endpoint's own bug reports mention truncated intermediate
    // events) meant `text` above under-counted what was actually said.
    let toolCalls: TurnResult["toolCalls"] = [];
    let stopReason: TurnResult["stopReason"] = "other";
    if (finalOutput) {
      const messageText = finalOutput.output
        ?.filter(
          (item): item is Extract<typeof item, { type: "message" }> => item.type === "message",
        )
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === "output_text" && part.text)
        .map((part) => part.text)
        .join("");
      if (messageText) text = messageText;

      toolCalls = (finalOutput.output ?? [])
        .filter(
          (item): item is Extract<typeof item, { type: "function_call" }> =>
            item.type === "function_call",
        )
        .map((call) => ({
          id: call.call_id,
          name: call.name,
          input: safeParseJson(call.arguments),
        }));

      stopReason =
        toolCalls.length > 0 ? "tool_use" : finalOutput.status === "failed" ? "other" : "end_turn";
    }

    this.items.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    });
    for (const call of toolCalls) {
      this.items.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input),
      });
    }

    return {
      toolCalls,
      stopReason,
      usage: {
        inputTokens: finalOutput?.usage?.input_tokens ?? 0,
        outputTokens: finalOutput?.usage?.output_tokens ?? 0,
      },
    };
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toResponsesTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }));
}

export class ChatGptResponsesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ChatGptResponsesError";
  }
}

export function classifyChatGptResponsesError(error: unknown): ProviderErrorCode {
  if (!(error instanceof ChatGptResponsesError)) return "internal";
  if (error.status === 401 || error.status === 403) return "unauthorized";
  if (error.status === 429) return "rate_limited";
  if (error.status === 400) return "bad_request";
  if (error.status === 0) return "connection";
  return "model_error";
}

/** Same reasoning as `describeAnthropicError` — a clear, specific
 * explanation instead of a raw status code and JSON body. */
export function describeChatGptResponsesError(error: unknown): string {
  if (!(error instanceof ChatGptResponsesError)) return (error as Error)?.message ?? String(error);
  if (error.status === 401 || error.status === 403) {
    return (
      "OpenAI rejected this Codex session's credentials. Reconnect it from Settings — " +
      "it may have expired, or Sign in with ChatGPT may no longer be active for this account."
    );
  }
  if (error.status === 429) {
    return (
      "ChatGPT is rate-limiting requests on this account right now. A Codex session shares " +
      "its usage with everything else signed into that account. Wait a moment and try again, " +
      "or switch providers for now."
    );
  }
  return error.message;
}
