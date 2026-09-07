import type { VideoGenerationInput, VideoProviderId } from "@zelyq/core";

export class VideoProviderError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}
export type VideoLookup =
  | { status: "pending" }
  | { status: "done"; url: string }
  | { status: "failed"; error: string };
export interface VideoProvider {
  submit(
    input: VideoGenerationInput,
    reference: Buffer | undefined,
    key: string,
    signal: AbortSignal,
  ): Promise<string>;
  lookup(operation: string, key: string, signal: AbortSignal): Promise<VideoLookup>;
  download(url: string, key: string, signal: AbortSignal): Promise<Response>;
}

async function json(response: Response): Promise<any> {
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403)
      throw new VideoProviderError(
        "Video access was denied. Check the API key and model access in Settings.",
      );
    if (response.status === 429)
      throw new VideoProviderError("The video provider has reached its rate or usage limit.");
    if (response.status >= 500 || response.status === 408)
      throw new VideoProviderError("The provider did not confirm the request outcome.", true);
    throw new VideoProviderError(
      "The video provider rejected the request. Check its settings or adjust the prompt.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new VideoProviderError("The provider returned an empty response.", true);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 1024 * 1024)
        throw new VideoProviderError("The provider returned an oversized response.", true);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Only vendor-owned HTTPS media endpoints. Redirects are revalidated and API
 * credentials are attached exclusively to the original authenticated API host. */
export async function downloadVideo(
  provider: VideoProviderId,
  address: string,
  key: string,
  signal: AbortSignal,
): Promise<Response> {
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = new URL(address);
    const google =
      url.hostname === "generativelanguage.googleapis.com" ||
      url.hostname === "storage.googleapis.com" ||
      url.hostname.endsWith(".googleusercontent.com");
    const xai = url.hostname === "vidgen.x.ai" || url.hostname === "imgen.x.ai";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !(provider === "google" ? google : xai)
    )
      throw new VideoProviderError("The provider returned an unsupported video download address.");
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      headers:
        provider === "google" && url.hostname === "generativelanguage.googleapis.com"
          ? { "x-goog-api-key": key }
          : {},
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new VideoProviderError("The provider video redirect was incomplete.");
      address = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new VideoProviderError(
        "The generated video could not be downloaded. Zelyq will retry the same result.",
      );
    }
    return response;
  }
  throw new VideoProviderError("The provider returned too many video redirects.");
}

const googleBase = "https://generativelanguage.googleapis.com/v1beta";
export const videoProviders: Record<VideoProviderId, VideoProvider> = {
  google: {
    async submit(input, reference, key, signal) {
      const result = await json(
        await fetch(`${googleBase}/models/${input.model}:predictLongRunning`, {
          method: "POST",
          signal,
          redirect: "error",
          headers: { "x-goog-api-key": key, "content-type": "application/json" },
          body: JSON.stringify({
            instances: [
              {
                prompt: input.prompt,
                ...(reference
                  ? {
                      image: {
                        bytesBase64Encoded: reference.toString("base64"),
                        mimeType: "image/png",
                      },
                    }
                  : {}),
              },
            ],
            parameters: {
              aspectRatio: input.aspectRatio,
              durationSeconds: input.durationSeconds,
              resolution: input.resolution,
              sampleCount: 1,
            },
          }),
        }),
      );
      if (
        typeof result.name !== "string" ||
        !/^models\/[a-zA-Z0-9._-]+\/operations\/[a-zA-Z0-9_-]+$/.test(result.name)
      )
        throw new VideoProviderError("The provider did not return a usable operation ID.", true);
      return result.name;
    },
    async lookup(operation, key, signal) {
      if (!/^models\/[a-zA-Z0-9._-]+\/operations\/[a-zA-Z0-9_-]+$/.test(operation))
        throw new VideoProviderError("Invalid stored video operation.");
      const result = await json(
        await fetch(`${googleBase}/${operation}`, {
          signal,
          redirect: "error",
          headers: { "x-goog-api-key": key },
        }),
      );
      if (result.error)
        return {
          status: "failed",
          error:
            "Google could not generate this clip. Adjust the prompt or check video model access.",
        };
      if (result.done !== true) return { status: "pending" };
      const url = result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (typeof url !== "string")
        return {
          status: "failed",
          error: "Google returned no usable video. The request may have been filtered.",
        };
      return { status: "done", url };
    },
    download: (url, key, signal) => downloadVideo("google", url, key, signal),
  },
  xai: {
    async submit(input, reference, key, signal) {
      const result = await json(
        await fetch("https://api.x.ai/v1/videos/generations", {
          method: "POST",
          signal,
          redirect: "error",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: input.model,
            prompt: input.prompt,
            duration: input.durationSeconds,
            aspect_ratio: input.aspectRatio,
            resolution: input.resolution,
            generate_audio: input.audio,
            ...(reference
              ? { image: { url: `data:image/png;base64,${reference.toString("base64")}` } }
              : {}),
          }),
        }),
      );
      if (
        typeof result.request_id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(result.request_id)
      )
        throw new VideoProviderError("The provider did not return a usable request ID.", true);
      return result.request_id;
    },
    async lookup(operation, key, signal) {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(operation))
        throw new VideoProviderError("Invalid stored video operation.");
      const result = await json(
        await fetch(`https://api.x.ai/v1/videos/${operation}`, {
          signal,
          redirect: "error",
          headers: { authorization: `Bearer ${key}` },
        }),
      );
      if (result.status === "pending") return { status: "pending" };
      if (
        result.status === "done" &&
        typeof result.video?.url === "string" &&
        result.video?.respect_moderation !== false
      )
        return { status: "done", url: result.video.url };
      if (["done", "failed", "expired"].includes(result.status))
        return {
          status: "failed",
          error:
            "xAI could not return a usable video. The request failed, expired, or was filtered.",
        };
      throw new VideoProviderError("The provider returned an unrecognized video status.", true);
    },
    download: (url, key, signal) => downloadVideo("xai", url, key, signal),
  },
};
