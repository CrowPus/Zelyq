import { timingSafeEqual } from "node:crypto";
import { ANTHROPIC_MODELS, type AnthropicModel, availableAnthropicModels } from "@zelyq/core";

export interface AnthropicModelList {
  models: AnthropicModel[];
  modelAvailability: "verified" | "unverified" | "subscription" | "unconfigured";
  modelNotice: string;
}

/** Constant-time, and false rather than throwing on a length mismatch. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** One bounded cache per settings service. Never shares access lists across keys. */
export class AnthropicModelDiscovery {
  // The credential is held as passed rather than digested — see the matching
  // note in `openai-models.ts`.
  private cache?: {
    apiKey: string;
    baseUrl: string;
    expires: number;
    result: Promise<AnthropicModelList>;
  };
  constructor(private readonly request: typeof fetch = fetch) {}

  async list(apiKey: string, baseUrl: string): Promise<AnthropicModelList> {
    if (!apiKey)
      return {
        models: ANTHROPIC_MODELS,
        modelAvailability: "unconfigured",
        modelNotice: "Connect an Anthropic API key to check model access.",
      };
    if (
      this.cache &&
      this.cache.expires > Date.now() &&
      this.cache.baseUrl === baseUrl &&
      sameSecret(this.cache.apiKey, apiKey)
    )
      return this.cache.result;
    const result = this.fetchModels(apiKey, baseUrl);
    this.cache = { apiKey, baseUrl, expires: Date.now() + 60_000, result };
    return result;
  }

  private async fetchModels(apiKey: string, baseUrl: string): Promise<AnthropicModelList> {
    try {
      const url = new URL(baseUrl || "https://api.anthropic.com");
      if (
        url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
        throw new Error("HTTPS required");
      let prefix = url.pathname.replace(/\/+$/, "").replace(/\/messages$/, "");
      if (!prefix.endsWith("/v1")) prefix += "/v1";
      url.pathname = `${prefix}/models`;
      // Anthropic authenticates with `x-api-key`, not a bearer token, and
      // requires a pinned API version.
      const response = await this.request(url, {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
      if (!Array.isArray(data.data) || data.data.some((model) => typeof model?.id !== "string"))
        throw new Error("Invalid model list");
      const models = availableAnthropicModels(data.data.map((model) => model.id as string));
      return {
        models,
        modelAvailability: "verified",
        modelNotice: models.length
          ? "Models listed for your API key. Usage remains subject to your account limits."
          : "Your API key lists no supported Claude models. Check model access or enter a custom model in Settings.",
      };
    } catch {
      // Discovery is advisory; a restricted key may generate without listing.
      return {
        models: ANTHROPIC_MODELS,
        modelAvailability: "unverified",
        modelNotice:
          "Could not check model access. Showing the Claude catalog; availability is unverified.",
      };
    }
  }
}
