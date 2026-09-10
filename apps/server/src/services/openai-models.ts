import { createHash } from "node:crypto";
import { availableOpenAIModels, type ModelOption, OPENAI_MODELS } from "@zelyq/core";

export interface OpenAIModelList {
  models: ModelOption[];
  modelAvailability: "verified" | "unverified" | "subscription" | "unconfigured";
  modelNotice: string;
}

/** One bounded cache per settings service. Never shares access lists across keys. */
export class OpenAIModelDiscovery {
  private cache?: { key: string; expires: number; result: Promise<OpenAIModelList> };
  constructor(private readonly request: typeof fetch = fetch) {}
  async list(apiKey: string, baseUrl: string): Promise<OpenAIModelList> {
    if (!apiKey)
      return {
        models: OPENAI_MODELS,
        modelAvailability: "unconfigured",
        modelNotice: "Connect an OpenAI API key to check model access.",
      };
    const key = createHash("sha256").update(apiKey).update("\0").update(baseUrl).digest("hex");
    if (this.cache?.key === key && this.cache.expires > Date.now()) return this.cache.result;
    const result = this.fetchModels(apiKey, baseUrl);
    this.cache = { key, expires: Date.now() + 60_000, result };
    return result;
  }
  private async fetchModels(apiKey: string, baseUrl: string): Promise<OpenAIModelList> {
    try {
      const url = new URL(baseUrl || "https://api.openai.com/v1");
      if (
        url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
        throw new Error("HTTPS required");
      let prefix = url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|responses)$/, "");
      if (!prefix.endsWith("/v1")) prefix += "/v1";
      url.pathname = `${prefix}/models`;
      const response = await this.request(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
      if (!Array.isArray(data.data) || data.data.some((model) => typeof model?.id !== "string"))
        throw new Error("Invalid model list");
      const models = availableOpenAIModels(data.data.map((model) => model.id as string));
      return {
        models,
        modelAvailability: "verified",
        modelNotice: models.length
          ? "Models listed for your API key. Usage remains subject to your account limits."
          : "Your API key lists no supported coding models. Check model access or enter a custom model in Settings.",
      };
    } catch {
      // Discovery is advisory; a restricted key may generate without listing.
      return {
        models: OPENAI_MODELS,
        modelAvailability: "unverified",
        modelNotice:
          "Could not check model access. Showing the OpenAI catalog; availability is unverified.",
      };
    }
  }
}
