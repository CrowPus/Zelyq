import { AnthropicProvider, classifyAnthropicError } from "./anthropic.js";
import { classifyGoogleError, describeGoogleError, GoogleProvider } from "./google.js";
import type { ModelProvider, ProviderErrorCode, ProviderId } from "./types.js";

export { AnthropicProvider } from "./anthropic.js";
export {
  describeGoogleError,
  GoogleProvider,
  toFunctionDeclarations,
  toThinkingLevel,
} from "./google.js";
export * from "./types.js";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Model used when none is configured. */
  defaultModel: string;
  /** Environment variables checked for a key, in order. */
  apiKeyEnv: string[];
  docsUrl: string;
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
};

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
}): ModelProvider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config.model, config.apiKey);
    case "google":
      return new GoogleProvider(config.model, config.apiKey);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

export function classifyProviderError(provider: ProviderId, error: unknown): ProviderErrorCode {
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
