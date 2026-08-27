import { AnthropicProvider, classifyAnthropicError, describeAnthropicError } from "./anthropic.js";
import {
  ChatGptResponsesError,
  ChatGptResponsesProvider,
  classifyChatGptResponsesError,
  describeChatGptResponsesError,
  unpackCodexCredential,
} from "./chatgpt-responses.js";
import { classifyGoogleError, describeGoogleError, GoogleProvider } from "./google.js";
import { classifyOpenAICompatibleError, OpenAICompatibleProvider } from "./openai-compatible.js";
import type { AuthMode, ModelProvider, ProviderErrorCode, ProviderId } from "./types.js";

export { AnthropicProvider, describeAnthropicError } from "./anthropic.js";
export {
  ChatGptResponsesError,
  ChatGptResponsesProvider,
  packCodexCredential,
} from "./chatgpt-responses.js";
export {
  describeGoogleError,
  GoogleProvider,
  toFunctionDeclarations,
  toThinkingLevel,
} from "./google.js";
export {
  chatCompletionsUrl,
  OpenAICompatibleError,
  OpenAICompatibleProvider,
  requireEncryptedOrLocal,
} from "./openai-compatible.js";
export * from "./types.js";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Model used when none is configured. */
  defaultModel: string;
  /** Environment variables checked for a key, in order. */
  apiKeyEnv: string[];
  docsUrl: string;
  /**
   * Where requests go, for providers that speak the OpenAI dialect. Absent
   * means the vendor SDK already knows; `null` means the operator must supply
   * one, which is what makes an entry the self-hosted door.
   */
  baseUrl?: string | null;
  /** Environment variable that overrides `baseUrl`. */
  baseUrlEnv?: string;
  /** A key is optional for endpoints on your own network, which usually have none. */
  apiKeyOptional?: boolean;
  /**
   * Known-current models for this vendor, offered as suggestions in the
   * settings screen — never a closed set, since `model` stays free text.
   * Kept deliberately short: only names actually confirmed, not a vendor's
   * full catalog guessed at. Absent entirely (as for the OpenAI-dialect
   * vendors below with no default) means there is nothing yet confirmed to
   * suggest — add to this list only once a name is verified, the same
   * standard the rest of this project holds evidence to.
   *
   * `tier` — 047 Phase 0.4. A coarse capability/cost band the Architect uses
   * to *advise* a model per build-plan task ("write the docs: `cheap` is
   * fine"). Advice only in Phase 1: nothing routes on it, a person still
   * picks the model. Only set on names whose relative standing is actually
   * confirmed against the vendor's own tiering — left absent otherwise, the
   * same evidence bar as the list itself.
   */
  models?: Array<{ value: string; label: string; tier?: ModelTier }>;
}

/** 047 Phase 0.4. `strong` — hard design/security/data decisions. `standard`
 * — most implementation. `cheap` — mechanical work: docs, boilerplate,
 * formatting, obvious edits. */
export type ModelTier = "strong" | "standard" | "cheap";

/**
 * The registry is the single place that knows a provider exists. Adding one
 * means an entry here plus a `ModelProvider` implementation — nothing in the
 * server, the UI, or the tools changes.
 */
export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Claude",
    defaultModel: "claude-opus-5",
    apiKeyEnv: ["ANTHROPIC_API_KEY"],
    docsUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { value: "claude-opus-5", label: "Claude Opus 5 — most capable", tier: "strong" },
      { value: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced", tier: "standard" },
      { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", tier: "standard" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest", tier: "cheap" },
    ],
  },
  google: {
    id: "google",
    label: "Gemini",
    defaultModel: "gemini-3.7-flash",
    apiKeyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    docsUrl: "https://aistudio.google.com/apikey",
    models: [
      { value: "gemini-3.7-pro", label: "Gemini 3.7 Pro — most capable", tier: "strong" },
      { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash — balanced", tier: "standard" },
      { value: "gemini-3.7-flash-lite", label: "Gemini 3.7 Flash-Lite — fastest", tier: "cheap" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "strong" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "cheap" },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-5.1",
    apiKeyEnv: ["OPENAI_API_KEY"],
    docsUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    models: [
      { value: "gpt-5.1", label: "GPT-5.1 — most capable", tier: "strong" },
      { value: "gpt-5.1-mini", label: "GPT-5.1 mini — fast", tier: "cheap" },
      { value: "gpt-5", label: "GPT-5", tier: "strong" },
      { value: "o4-mini", label: "o4-mini — reasoning, fast", tier: "standard" },
      { value: "gpt-4.1", label: "GPT-4.1", tier: "standard" },
    ],
  },
  xai: {
    id: "xai",
    label: "Grok (xAI)",
    defaultModel: "grok-4",
    apiKeyEnv: ["XAI_API_KEY"],
    docsUrl: "https://console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    models: [
      { value: "grok-4", label: "Grok 4 — most capable", tier: "strong" },
      { value: "grok-4-fast", label: "Grok 4 Fast", tier: "cheap" },
      { value: "grok-3", label: "Grok 3", tier: "standard" },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    apiKeyEnv: ["DEEPSEEK_API_KEY"],
    docsUrl: "https://platform.deepseek.com/api_keys",
    baseUrl: "https://api.deepseek.com/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    models: [
      { value: "deepseek-chat", label: "DeepSeek Chat", tier: "standard" },
      { value: "deepseek-reasoner", label: "DeepSeek Reasoner", tier: "strong" },
    ],
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    // Mistral itself publishes "-latest" as a stable alias for its current
    // flagship, which is why this can be a real default and not a guessed
    // dated snapshot the way a fixed version string would be.
    defaultModel: "mistral-large-latest",
    apiKeyEnv: ["MISTRAL_API_KEY"],
    docsUrl: "https://console.mistral.ai/api-keys",
    baseUrl: "https://api.mistral.ai/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    models: [
      { value: "mistral-large-latest", label: "Mistral Large (latest)", tier: "strong" },
      { value: "mistral-medium-latest", label: "Mistral Medium (latest)", tier: "standard" },
      { value: "mistral-small-latest", label: "Mistral Small (latest)", tier: "cheap" },
      { value: "codestral-latest", label: "Codestral (latest) — coding", tier: "standard" },
    ],
  },
  groq: {
    id: "groq",
    label: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    apiKeyEnv: ["GROQ_API_KEY"],
    docsUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    // Groq hosts other vendors' open-weight models. These IDs move faster
    // than a release cycle — treat the list as a starting point, not a
    // guarantee, and set a specific one in Settings if a name has rotated.
    models: [
      { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", tier: "standard" },
      { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B — fastest", tier: "cheap" },
      {
        value: "deepseek-r1-distill-llama-70b",
        label: "DeepSeek R1 Distill 70B — reasoning",
        tier: "strong",
      },
    ],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "anthropic/claude-sonnet-4.5",
    apiKeyEnv: ["OPENROUTER_API_KEY"],
    docsUrl: "https://openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    // OpenRouter is an aggregator with no model of its own; this default is
    // just a sensible general-purpose pick. The list is a curated shortlist
    // of vendor slugs — OpenRouter's catalogue is thousands deep; set a
    // specific slug in Settings for anything not here.
    models: [
      { value: "anthropic/claude-opus-5", label: "Claude Opus 5", tier: "strong" },
      { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", tier: "standard" },
      { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "strong" },
      { value: "openai/gpt-5.1", label: "GPT-5.1", tier: "strong" },
      { value: "x-ai/grok-4", label: "Grok 4", tier: "strong" },
      {
        value: "deepseek/deepseek-chat",
        label: "DeepSeek Chat",
        tier: "cheap",
      },
      {
        value: "meta-llama/llama-3.3-70b-instruct",
        label: "Llama 3.3 70B",
        tier: "cheap",
      },
    ],
  },
  custom: {
    id: "custom",
    label: "Self-hosted or custom endpoint",
    // No default: the model a given server holds is that server's business,
    // and guessing one produces a 404 that reads like a Zelyq bug.
    defaultModel: "",
    apiKeyEnv: ["ZELYQ_MODEL_API_KEY", "OPENAI_API_KEY"],
    docsUrl: "https://github.com/CrowPus/Zelyq/blob/main/docs/configuration.md",
    baseUrl: null,
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    apiKeyOptional: true,
  },
};

/** Providers that speak the OpenAI chat-completions dialect. */
const OPENAI_DIALECT: ReadonlySet<ProviderId> = new Set<ProviderId>([
  "openai",
  "xai",
  "deepseek",
  "mistral",
  "groq",
  "openrouter",
  "custom",
]);

export function speaksOpenAIDialect(provider: ProviderId): boolean {
  return OPENAI_DIALECT.has(provider);
}

/**
 * The address for a provider: an explicit value, then its environment
 * variable, then the registry default. `custom` has no default on purpose.
 */
export function baseUrlFor(
  provider: ProviderId,
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (explicit) return explicit;
  const info = PROVIDERS[provider];
  const fromEnv = info.baseUrlEnv ? env[info.baseUrlEnv] : undefined;
  return fromEnv || info.baseUrl || undefined;
}

export function isProviderId(value: string): value is ProviderId {
  return value in PROVIDERS;
}

export function defaultModelFor(provider: ProviderId): string {
  return PROVIDERS[provider].defaultModel;
}

/** First key found among the provider's environment variables. */
export function apiKeyFromEnv(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of PROVIDERS[provider].apiKeyEnv) {
    const value = env[name];
    if (value) return value;
  }
  return undefined;
}

/**
 * 047 Phase 0.4 — the availability probe, credential-free by construction.
 *
 * Reports which providers can be used right now and the tiered model
 * suggestions for each. It reads *whether* a key or endpoint is configured;
 * it never returns, logs, or derives the key itself. A caller that wants to
 * surface this to a model (047 Phase 3f, not authorized yet) gets names and
 * tiers only. `subscriptions` names any auth modes the server has told us are
 * live (a CLI subscription session — see `045`); the tokens for those stay
 * server-side, exactly as they do today.
 */
export function describeAvailableModels(
  options: {
    env?: NodeJS.ProcessEnv;
    /** Provider ids the server has confirmed have a live CLI-subscription session. */
    subscriptions?: ProviderId[];
  } = {},
): Array<{
  provider: ProviderId;
  label: string;
  available: boolean;
  via: "api_key" | "subscription" | "endpoint" | "none";
  models: Array<{ value: string; label: string; tier?: ModelTier }>;
}> {
  const env = options.env ?? process.env;
  const subs = new Set(options.subscriptions ?? []);
  return (Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
    const info = PROVIDERS[id];
    const hasKey = Boolean(apiKeyFromEnv(id, env));
    const hasEndpoint = Boolean(baseUrlFor(id, undefined, env));
    const via: "api_key" | "subscription" | "endpoint" | "none" = subs.has(id)
      ? "subscription"
      : hasKey
        ? "api_key"
        : info.apiKeyOptional && hasEndpoint
          ? "endpoint"
          : "none";
    return {
      provider: id,
      label: info.label,
      available: via !== "none",
      via,
      models: info.models ?? [],
    };
  });
}

export function createProvider(config: {
  provider: ProviderId;
  model: string;
  apiKey: string;
  authMode?: AuthMode;
  baseUrl?: string;
}): ModelProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.model, config.apiKey, config.authMode);
    case "google":
      return new GoogleProvider(config.model, config.apiKey);
    case "openai": {
      // See `045`'s OpenAI follow-up: a Codex "sign in with ChatGPT"
      // session speaks an entirely different, private API, not just a
      // different header on the same public one the way Claude's does —
      // so subscription mode gets its own provider class here rather than
      // a header change to OpenAICompatibleProvider below.
      if (config.authMode === "subscription") {
        const credential = unpackCodexCredential(config.apiKey);
        if (!credential) {
          throw new Error("The Codex session credential is malformed. Reconnect it from Settings.");
        }
        return new ChatGptResponsesProvider(
          config.model,
          credential.accessToken,
          credential.accountId,
        );
      }
      return buildOpenAICompatibleProvider(config);
    }
    case "xai":
    case "deepseek":
    case "mistral":
    case "groq":
    case "openrouter":
    case "custom":
      return buildOpenAICompatibleProvider(config);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

function buildOpenAICompatibleProvider(config: {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): ModelProvider {
  const info = PROVIDERS[config.provider];
  const baseUrl = baseUrlFor(config.provider, config.baseUrl);
  if (!baseUrl) {
    throw new Error(
      `${info.label} needs an endpoint address. ` +
        "Set ZELYQ_MODEL_BASE_URL — for example http://localhost:11434/v1 for Ollama, " +
        "or https://models.internal/v1 for a server of your own.",
    );
  }
  // Every vendor without a registry default requires an explicit model —
  // not just `custom`. Guessing one for a real vendor would silently
  // pick whatever model happened to be first in its catalog; refusing
  // and naming the fix is the same choice `custom` already made.
  if (!info.defaultModel && !config.model) {
    throw new Error(
      `${info.label} has no default model here yet. Set ZELYQ_MODEL to the exact name ` +
        "you want — check its docs for current model names.",
    );
  }
  return new OpenAICompatibleProvider({
    id: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl,
    // Only where the dialect's reasoning field is known to be understood.
    // An unknown server that rejects it would fail every turn.
    supportsReasoningEffort: config.provider === "openai",
  });
}

export function classifyProviderError(provider: ProviderId, error: unknown): ProviderErrorCode {
  // Checked by the error's own type, not the provider id — a Codex session
  // error is never an OpenAICompatibleError even though `provider` says
  // "openai" here, the same reason `apiKey` alone couldn't tell the two
  // apart either. See `045`'s OpenAI follow-up.
  if (error instanceof ChatGptResponsesError) return classifyChatGptResponsesError(error);
  if (speaksOpenAIDialect(provider)) return classifyOpenAICompatibleError(error);
  return provider === "google" ? classifyGoogleError(error) : classifyAnthropicError(error);
}

/** The message a user should read, with vendor envelopes unwrapped. */
export function describeProviderError(provider: ProviderId, error: unknown): string {
  if (error instanceof ChatGptResponsesError) return describeChatGptResponsesError(error);
  if (provider === "google") return describeGoogleError(error);
  if (provider === "anthropic") return describeAnthropicError(error);
  return (error as Error)?.message ?? String(error);
}

/**
 * How a session obtains its provider. Overridable so tests can drive the whole
 * agent loop without a network or an API key.
 */
export type ProviderFactory = (config: {
  provider: ProviderId;
  model: string;
  apiKey: string;
  authMode?: AuthMode;
}) => ModelProvider;
