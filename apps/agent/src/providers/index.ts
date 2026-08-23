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
  },
  google: {
    id: "google",
    label: "Gemini",
    defaultModel: "gemini-3.7-flash",
    apiKeyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    docsUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-5.1",
    apiKeyEnv: ["OPENAI_API_KEY"],
    docsUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
    baseUrlEnv: "ZELYQ_MODEL_BASE_URL",
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
const OPENAI_DIALECT: ReadonlySet<ProviderId> = new Set<ProviderId>(["openai", "custom"]);

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
    case "custom": {
      const baseUrl = baseUrlFor(config.provider, config.baseUrl);
      if (!baseUrl) {
        throw new Error(
          `${PROVIDERS[config.provider].label} needs an endpoint address. ` +
            "Set ZELYQ_MODEL_BASE_URL — for example http://localhost:11434/v1 for Ollama, " +
            "or https://models.internal/v1 for a server of your own.",
        );
      }
      if (config.provider === "custom" && !config.model) {
        throw new Error(
          "A custom endpoint has no default model. Set ZELYQ_MODEL to the name your server " +
            "serves, exactly as it reports it.",
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
