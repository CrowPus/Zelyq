import { AnthropicProvider, classifyAnthropicError } from "./anthropic.js";
import { classifyGoogleError, describeGoogleError, GoogleProvider } from "./google.js";
import { classifyOpenAICompatibleError, OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ModelProvider, ProviderErrorCode, ProviderId } from "./types.js";

export { AnthropicProvider } from "./anthropic.js";
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
   */
  models?: Array<{ value: string; label: string }>;
}

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
      { value: "claude-opus-5", label: "Claude Opus 5 — most capable" },
      { value: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest" },
    ],
  },
  google: {
    id: "google",
    label: "Gemini",
    defaultModel: "gemini-3.7-flash",
    apiKeyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    docsUrl: "https://aistudio.google.com/apikey",
    models: [{ value: "gemini-3.7-flash", label: "Gemini 3.7 Flash" }],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-5.1",
    apiKeyEnv: ["OPENAI_API_KEY"],
    docsUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    models: [{ value: "gpt-5.1", label: "GPT-5.1" }],
  },
  xai: {
    id: "xai",
    label: "Grok (xAI)",
    defaultModel: "",
    apiKeyEnv: ["XAI_API_KEY"],
    docsUrl: "https://console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    // No default yet: no xAI model name confirmed against a real account.
    // A hosted vendor guessing wrong here fails exactly like `custom` does
    // when it has no model — same choice, same reason, not an oversight.
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    apiKeyEnv: ["DEEPSEEK_API_KEY"],
    docsUrl: "https://platform.deepseek.com/api_keys",
    baseUrl: "https://api.deepseek.com/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    models: [{ value: "deepseek-chat", label: "DeepSeek Chat" }],
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
    models: [{ value: "mistral-large-latest", label: "Mistral Large (latest)" }],
  },
  groq: {
    id: "groq",
    label: "Groq",
    defaultModel: "",
    apiKeyEnv: ["GROQ_API_KEY"],
    docsUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    // No default: Groq hosts other vendors' open-weight models and rotates
    // which one is fastest/flagship; a name confirmed today is likely to be
    // wrong within the year. Pick explicitly instead of inheriting a guess.
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultModel: "",
    apiKeyEnv: ["OPENROUTER_API_KEY"],
    docsUrl: "https://openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
    // No default by design, not by omission: OpenRouter is an aggregator,
    // not a lab — the entire point of it is choosing which vendor's model
    // to route to, so there is no "its own" model to default to.
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

export function createProvider(config: {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): ModelProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.model, config.apiKey);
    case "google":
      return new GoogleProvider(config.model, config.apiKey);
    case "openai":
    case "xai":
    case "deepseek":
    case "mistral":
    case "groq":
    case "openrouter":
    case "custom": {
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
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

export function classifyProviderError(provider: ProviderId, error: unknown): ProviderErrorCode {
  if (speaksOpenAIDialect(provider)) return classifyOpenAICompatibleError(error);
  return provider === "google" ? classifyGoogleError(error) : classifyAnthropicError(error);
}

/** The message a user should read, with vendor envelopes unwrapped. */
export function describeProviderError(provider: ProviderId, error: unknown): string {
  if (provider === "google") return describeGoogleError(error);
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
}) => ModelProvider;
