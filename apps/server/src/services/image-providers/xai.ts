import type { ImageGenerationInput } from "@zelyq/core";
import { normalizeImage } from "./normalize.js";
import {
  boundedBody,
  type GeneratedImage,
  type ImageProvider,
  ImageProviderError,
  imageAspectRatio,
  requireImageResponse,
} from "./shared.js";

export class XaiImageProvider implements ImageProvider {
  async generate(
    input: Pick<ImageGenerationInput, "prompt" | "size" | "quality">,
    model: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<GeneratedImage> {
    try {
      const response = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        redirect: "error",
        signal,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          n: 1,
          response_format: "b64_json",
          aspect_ratio: imageAspectRatio(input.size),
          resolution: "1k",
          quality: input.quality,
        }),
      });
      await requireImageResponse(response);
      const body = JSON.parse(await boundedBody(response)) as {
        data?: Array<{ b64_json?: string }>;
        usage?: unknown;
      };
      return {
        ...(await normalizeImage(body.data?.[0]?.b64_json)),
        requestId: response.headers.get("x-request-id"),
        usage: body.usage ? JSON.stringify(body.usage) : null,
      };
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      throw new ImageProviderError(
        "The connection ended before xAI confirmed generation. Check provider usage before generating again.",
        true,
      );
    }
  }
}
