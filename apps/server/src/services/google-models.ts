import { timingSafeEqual } from "node:crypto";
import { availableGoogleModels, GOOGLE_MODELS, type GoogleModel } from "@zelyq/core";

export interface GoogleModelList {
  models: GoogleModel[];
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
export class GoogleModelDiscovery {
  private cache?: {
    apiKey: string;
    baseUrl: string;
    expires: number;
    result: Promise<GoogleModelList>;
  };
  constructor(private readonly request: typeof fetch = fetch) {}

  async list(apiKey: string, baseUrl: string): Promise<GoogleModelList> {
    if (!apiKey)
      return {
        models: GOOGLE_MODELS,
        modelAvailability: "unconfigured",
        modelNotice: "Connect a Gemini API key to check model access.",
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

  private async fetchModels(apiKey: string, baseUrl: string): Promise<GoogleModelList> {
    try {
      const url = new URL(baseUrl || "https://generativelanguage.googleapis.com");
      if (
        url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
        throw new Error("HTTPS required");
      let prefix = url.pathname.replace(/\/+$/, "");
      if (!/\/v1(beta)?$/.test(prefix)) prefix += "/v1beta";
      url.pathname = `${prefix}/models`;
      url.searchParams.set("pageSize", "200");
      // The key goes in a header, never the query string, so it cannot end up
      // in a proxy log or an error message that quotes the URL.
      const response = await this.request(url, {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>;
      };
      if (!Array.isArray(data.models) || data.models.some((m) => typeof m?.name !== "string"))
        throw new Error("Invalid model list");
      const ids = data.models
        // Only models that can actually run a turn. The listing also carries
        // embedding, TTS and image models, which cannot.
        .filter(
          (model) =>
            !Array.isArray(model.supportedGenerationMethods) ||
            model.supportedGenerationMethods.includes("generateContent"),
        )
        .map((model) => String(model.name).replace(/^models\//, ""));
      const models = availableGoogleModels(ids);
      return {
        models,
        modelAvailability: "verified",
        modelNotice: models.length
          ? "Models listed for your API key. Usage remains subject to your account limits."
          : "Your API key lists no supported Gemini models. Check model access or enter a custom model in Settings.",
      };
    } catch {
      // Discovery is advisory; a restricted key may generate without listing.
      return {
        models: GOOGLE_MODELS,
        modelAvailability: "unverified",
        modelNotice:
          "Could not check model access. Showing the Gemini catalog; availability is unverified.",
      };
    }
  }
}
