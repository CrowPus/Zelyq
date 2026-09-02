import { type Content, GoogleGenAI, type Part, ThinkingLevel } from "@google/genai";
import type { PromptAttachment } from "@zelyq/core";
import type { ToolDefinition } from "@zelyq/tools";
import {
  REDUCTION_TAIL_KEEP,
  REDUCTION_THRESHOLD_CHARS,
  REPIN_AFTER_ENTRIES,
  recoverableChars,
  recoverableResultChars,
  reduceToolInput,
  reduceToolResultText,
  safeCacheBoundary,
} from "./history-reduction.js";
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
 * R7 — drop superseded whole-file payloads from Gemini's native history.
 *
 * Pure and exported so the rewrite can be tested without a client. Returns the
 * same array when there was nothing worth a sweep, so the caller can tell
 * whether the prefix actually changed.
 */
export function reduceGoogleHistory(contents: Content[]): Content[] {
  const end = Math.max(0, contents.length - REDUCTION_TAIL_KEEP);
  let recoverable = 0;
  for (let i = 0; i < end; i++) {
    for (const part of contents[i]?.parts ?? []) {
      if (part.functionCall?.name) {
        recoverable += recoverableChars(
          part.functionCall.name,
          (part.functionCall.args ?? {}) as Record<string, unknown>,
        );
      }
      const output = successOutput(part);
      if (output !== null) recoverable += recoverableResultChars(output);
    }
  }
  if (recoverable < REDUCTION_THRESHOLD_CHARS) return contents;

  return contents.map((content, i) => {
    if (i >= end) return content;
    let changed = false;
    const parts = (content.parts ?? []).map((part): Part => {
      if (part.functionCall?.name) {
        const reduced = reduceToolInput(
          part.functionCall.name,
          (part.functionCall.args ?? {}) as Record<string, unknown>,
        );
        if (!reduced) return part;
        changed = true;
        return { ...part, functionCall: { ...part.functionCall, args: reduced } };
      }
      const output = successOutput(part);
      if (output === null) return part;
      const reduced = reduceToolResultText(output);
      if (!reduced) return part;
      changed = true;
      return {
        ...part,
        functionResponse: {
          ...part.functionResponse,
          response: { ...part.functionResponse?.response, output: reduced },
        },
      } as Part;
    });
    return changed ? { ...content, parts } : content;
  });
}

/**
 * The text of a SUCCESSFUL tool result, or null for anything else.
 *
 * `buildGoogleToolResultParts` puts a success under `output` and a failure
 * under `error`; only the former is ever shortened, because a truncated error
 * is how a model ends up confidently fixing the wrong thing.
 */
function successOutput(part: Part): string | null {
  const response = part.functionResponse?.response as Record<string, unknown> | undefined;
  if (!response || "error" in response) return null;
  return typeof response.output === "string" ? response.output : null;
}

/**
 * R4 — explicit context caching.
 *
 * Gemini is 95% of Zelyq's measured traffic and averages ~1.25M *uncached*
 * input tokens per user turn, which says implicit caching is mostly not firing
 * on the one thing that never changes: the system instruction plus the tool
 * declarations. That block is ~4.7k tokens on a default session, ~14.4k in
 * Engineer Mode and ~24.4k in Architect Mode, and it is re-sent on every one of
 * a turn's iterations.
 *
 * An explicit cache pins it server-side once per session and bills the pinned
 * portion at a reduced rate plus storage. Storage is the reason for the size
 * gate below: a prefix too small to repay it should stay on implicit caching.
 *
 * **OFF by default, and it should stay that way.** An explicit cache SUPPRESSES
 * Gemini's implicit caching of everything outside it: in a measured three-arm
 * comparison on `gemini-3.7-flash`, the reported `cachedContentTokenCount` was
 * exactly the pinned figure and never a token more, so the un-pinned remainder
 * of every request was billed in full.
 *
 * Steady state — the second identical request, which is the state an agent loop
 * actually lives in — over one ~70,000-token conversation:
 *
 *   inline, implicit caching only        uncached  4,768
 *   explicit cache over prefix + history uncached 19,252
 *   explicit cache over the prefix only  uncached 57,740
 *
 * Implicit caching wins by 12x against pinning the static prefix, and by 4x
 * against pinning the conversation too. Zelyq's workload is an agent loop making
 * many near-identical requests, which is precisely where implicit caching is
 * strongest, so the right thing to do is stay out of its way.
 *
 * The earlier measurement that said otherwise (5,981 uncached down to 8) was a
 * bad comparison: warm explicit against a partly-cold implicit cache, on a
 * conversation of one message. Run to steady state, it reverses.
 *
 * `ZELYQ_GEMINI_EXPLICIT_CACHE=1` turns it on. That is worth doing only for a
 * model where implicit caching is unavailable — verify with a two-request
 * steady-state comparison before trusting it, never a single cold request.
 *
 * Every failure path — below the model's minimum, a model that does not support
 * caching, no permission, an expired cache — falls back to the ordinary
 * uncached request. This can cost a request its discount; it can never fail a
 * turn.
 */
const EXPLICIT_CACHE_TTL_SECONDS = 3600;

/**
 * Characters of `systemInstruction` + tool JSON below which an explicit cache
 * is not worth creating. Deliberately conservative: Gemini's documented
 * minimum is model-specific (1,024 tokens on 2.5 Flash, 2,048 on 2.5 Pro) and
 * is not published for every model Zelyq can select, so this sits comfortably
 * above all of them at roughly 4k tokens. A prefix under the real minimum is
 * refused by the API, which this avoids paying a round trip to discover.
 */
const EXPLICIT_CACHE_MIN_CHARS = 16_000;

export function explicitCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZELYQ_GEMINI_EXPLICIT_CACHE === "1";
}

/**
 * Whether this session's static prefix is worth pinning. Pure so the gate is
 * testable without a client.
 */
export function worthExplicitCache(
  systemPrompt: string,
  tools: ToolDefinition[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!explicitCacheEnabled(env)) return false;
  const size = systemPrompt.length + JSON.stringify(toFunctionDeclarations(tools)).length;
  return size >= EXPLICIT_CACHE_MIN_CHARS;
}

/**
 * Identity of the cached block. `options.tools` is held by reference and can
 * gain a specialist pass tool mid-session, which would leave the pinned cache
 * describing tools the model no longer has — so the cache is keyed on the tool
 * names, and a change drops it rather than silently serving a stale prefix.
 */
export function cachePrefixKey(systemPrompt: string, tools: ToolDefinition[]): string {
  return `${systemPrompt.length}:${tools.map((t) => t.name).join(",")}`;
}

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

/**
 * Builds the `parts` for one user turn — inline-data parts for each
 * attachment, then a trailing text part if there is any text. A pure
 * function so it is testable without a live client or the non-exported
 * `GoogleConversation` class it lives inside.
 */
export function buildGoogleUserParts(text: string, attachments?: PromptAttachment[]): Part[] {
  if (!attachments?.length) return [{ text }];
  const parts: Part[] = attachments.map((attachment) => ({
    inlineData: { mimeType: attachment.mimeType, data: attachment.data },
  }));
  if (text.trim()) parts.push({ text });
  return parts;
}

/**
 * Builds the parts for one tool result — a `functionResponse`, plus one
 * `inlineData` part per image it carries. A `functionResponse` cannot itself
 * hold image bytes, so an image rides as its own part immediately after it.
 * A pure function, same reason `buildGoogleUserParts` is: testable without a
 * live client.
 */
export function buildGoogleToolResultParts(result: ToolResult, callId: string | undefined): Part[] {
  const parts: Part[] = [
    {
      functionResponse: {
        ...(callId ? { id: callId } : {}),
        name: result.name,
        // Gemini treats "output" as the result and "error" as a failure; any
        // other key would be handed back as opaque data.
        response: result.isError ? { error: result.output } : { output: result.output },
      },
    },
  ];
  for (const image of result.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }
  return parts;
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
  private contents: Content[];
  /**
   * Gemini identifies a function response by name, not by an id it always
   * supplies. We mint stable ids for our own event stream and remember the
   * mapping so results are paired with the right call.
   */
  private readonly callIds = new Map<string, string | undefined>();
  private callCounter = 0;
  /**
   * R4 — the server-side name of this session's pinned static prefix, the tool
   * set it was pinned for, and a latch that stops retrying after a failure.
   * Null name plus `explicitCacheOff === false` simply means "not created yet".
   */
  private cachedContentName: string | null = null;
  private cachedContentKey: string | null = null;
  private explicitCacheOff = false;
  /** How many `contents` entries the current cache already holds. */
  private cachedContentEntries = 0;
  /** Set when a history sweep rewrote entries the cache may already hold. */
  private cacheInvalidated = false;

  constructor(
    private readonly client: GoogleGenAI,
    private readonly model: string,
    private readonly options: ConversationOptions,
  ) {
    this.contents = buildGoogleHistory(options.history ?? []);
  }

  addUserMessage(text: string, attachments?: PromptAttachment[]): void {
    this.contents.push({ role: "user", parts: buildGoogleUserParts(text, attachments) });
  }

  addToolResults(results: ToolResult[]): void {
    // All results in one user turn, matching the parallel calls the model made.
    const parts = results.flatMap((result) =>
      buildGoogleToolResultParts(result, this.callIds.get(result.id)),
    );
    this.contents.push({ role: "user", parts });
  }

  /**
   * R4 — pin `systemInstruction` + tools server-side, once, and return the
   * cache's resource name. Returns null whenever the explicit path is not
   * available, in which case the caller sends the block inline exactly as
   * before. Never throws: an optimisation must not be able to fail a turn.
   */
  private async ensureCachedPrefix(): Promise<string | null> {
    if (this.explicitCacheOff) return null;
    if (!worthExplicitCache(this.options.systemPrompt, this.options.tools)) return null;

    // The tool array is held by reference and can gain a specialist pass tool
    // mid-session; a cache pinned for the old set would describe tools the
    // model no longer has.
    const key = cachePrefixKey(this.options.systemPrompt, this.options.tools);
    const toolsChanged = this.cachedContentName !== null && this.cachedContentKey !== key;

    // How much of the conversation is NOT yet pinned. This is what every round
    // re-sends at full price, and it is what the measurement said was left:
    // pinning only the static prefix left ~43,000 uncached tokens a round on a
    // second turn, because a session's history carries over between turns.
    const unpinned = this.contents.length - this.cachedContentEntries;
    const stale = toolsChanged || this.cacheInvalidated;

    if (this.cachedContentName && !stale && unpinned < REPIN_AFTER_ENTRIES) {
      return this.cachedContentName;
    }

    // Never split a model turn from the tool results answering it.
    const boundary = safeCacheBoundary(
      this.contents.map((c) => c.role),
      this.contents.length,
    );
    // Nothing new worth re-pinning for: keep what we have rather than paying to
    // rewrite the same thing.
    if (this.cachedContentName && !stale && boundary <= this.cachedContentEntries) {
      return this.cachedContentName;
    }

    const previous = this.cachedContentName;
    this.cachedContentName = null;
    this.cacheInvalidated = false;

    try {
      const created = await this.client.caches.create({
        model: this.model,
        config: {
          systemInstruction: this.options.systemPrompt,
          tools: [{ functionDeclarations: toFunctionDeclarations(this.options.tools) }],
          ...(boundary > 0 ? { contents: this.contents.slice(0, boundary) } : {}),
          ttl: `${EXPLICIT_CACHE_TTL_SECONDS}s`,
        },
      });
      if (!created.name) return null;
      this.cachedContentName = created.name;
      this.cachedContentKey = key;
      this.cachedContentEntries = boundary;
      // Storage is billed per token-hour, so the superseded cache is deleted
      // rather than left to age out. Best effort: failing to delete it is a
      // small cost, not a reason to fail the turn.
      if (previous) void this.client.caches.delete({ name: previous }).catch(() => undefined);
      return created.name;
    } catch {
      // Below the model's minimum, unsupported model, no permission — all the
      // same answer: stop asking and pay the uncached price. One failed attempt
      // per session, not one per iteration.
      this.explicitCacheOff = true;
      this.cachedContentEntries = 0;
      return null;
    }
  }

  async *stream(signal: AbortSignal): AsyncGenerator<ProviderEvent, TurnResult, undefined> {
    // R7 — Gemini has no server-side context editing, so every file body the
    // model has ever written is still in `contents` at full price on every
    // iteration. Sweep them out once enough has piled up to be worth the one
    // prefix change it costs.
    const swept = reduceGoogleHistory(this.contents);
    if (swept !== this.contents) {
      // A sweep rewrote entries the cache may already hold, so what is pinned no
      // longer matches this history. Re-pin rather than serve the old, larger
      // version back to the model.
      this.contents = swept;
      this.cacheInvalidated = true;
    }

    const cachedContent = await this.ensureCachedPrefix();
    // `cachedContent` and an inline `systemInstruction`/`tools` are mutually
    // exclusive — the API refuses a request carrying both, because the pinned
    // block already IS the system instruction and the tool list.
    const staticPrefix = cachedContent
      ? { cachedContent }
      : {
          systemInstruction: this.options.systemPrompt,
          tools: [{ functionDeclarations: toFunctionDeclarations(this.options.tools) }],
        };
    // Only the part of the conversation the cache does NOT already hold. The
    // pinned entries are replayed server-side; sending them again would both
    // duplicate the turn and pay for it twice.
    const contents = cachedContent ? this.contents.slice(this.cachedContentEntries) : this.contents;

    const stream = await this.client.models
      .generateContentStream({
        model: this.model,
        contents,
        config: {
          ...staticPrefix,
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: toThinkingLevel(this.options.effort),
          },
          abortSignal: signal,
        },
      })
      .catch((error: unknown) => {
        // A cache that expired or was deleted out from under us reads as a bad
        // request. Drop it and let the next iteration rebuild — but do not
        // silently swallow anything else.
        if (cachedContent) {
          this.cachedContentName = null;
          this.cachedContentKey = null;
          this.cachedContentEntries = 0;
        }
        throw error;
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
    let cachedTokens = 0;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) {
        // `promptTokenCount` INCLUDES cached content; split it so input is the
        // uncached remainder, matching the other providers (finding A4).
        cachedTokens = chunk.usageMetadata.cachedContentTokenCount ?? cachedTokens;
        inputTokens = (chunk.usageMetadata.promptTokenCount ?? inputTokens) - cachedTokens;
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
      usage: {
        inputTokens: Math.max(0, inputTokens),
        outputTokens,
        ...(cachedTokens > 0 ? { cacheReadInputTokens: cachedTokens } : {}),
      },
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

// `additionalProperties` is dropped for Gemini specifically: `toolDefinitions`
// sets it `false` on core tools for the Anthropic/OpenAI strict path, and
// Gemini's `parametersJsonSchema` handling of it has been uneven. Dropping it
// keeps Gemini on exactly its previous behaviour.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "$id",
  "$ref",
  "definitions",
  "$defs",
  "additionalProperties",
]);

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
