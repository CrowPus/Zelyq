import type { ImageGenerationInput } from "@zelyq/core";
import {
  boundedBody,
  type GeneratedImage,
  type ImageProvider,
  ImageProviderError,
  inspectPng,
} from "./shared.js";

export {
  type GeneratedImage,
  type ImageProvider,
  ImageProviderError,
  inspectPng,
} from "./shared.js";

export class OpenAIImageProvider implements ImageProvider {
  async generate(
    input: Pick<ImageGenerationInput, "prompt" | "size" | "quality"> & {
      references?: Array<{ bytes: Buffer; mimeType: "image/png" }>;
    },
    model: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<GeneratedImage> {
    try {
      const response = input.references?.length
        ? await this.edit(input, model, apiKey, signal)
        : await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            redirect: "error",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              prompt: input.prompt,
              size: input.size,
              quality: input.quality,
              model,
              n: 1,
              output_format: "png",
            }),
            signal,
          });
      // Never reflect provider error bodies, which can contain prompts or credentials.
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new ImageProviderError(
            "Image generation is not authorized. Ask an administrator to check the Image Studio API key and model access.",
          );
        if (response.status === 429)
          throw new ImageProviderError(
            "The image provider has reached its usage or rate limit. Try again later.",
          );
        if (response.status >= 500 || response.status === 408)
          throw new ImageProviderError(
            "The provider did not confirm the outcome. Check provider usage before generating again.",
            true,
          );
        throw new ImageProviderError(
          "The provider rejected this request. Adjust the prompt or ask an administrator to check model access.",
        );
      }
      const body = JSON.parse(await boundedBody(response)) as {
        data?: Array<{ b64_json?: string }>;
        usage?: unknown;
      };
      const encoded = body.data?.[0]?.b64_json;
      if (
        typeof encoded !== "string" ||
        !encoded.length ||
        encoded.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      )
        throw new ImageProviderError(
          "The provider returned no usable image. No replacement was generated.",
        );
      const bytes = Buffer.from(encoded, "base64");
      const dimensions = inspectPng(bytes);
      if (`${dimensions.width}x${dimensions.height}` !== input.size)
        throw new ImageProviderError(
          "The provider returned an unexpected image size. No replacement was generated.",
        );
      return {
        bytes,
        ...dimensions,
        requestId: response.headers.get("x-request-id"),
        usage: body.usage ? JSON.stringify(body.usage) : null,
      };
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      throw new ImageProviderError(
        "The connection ended before generation could be confirmed. Check provider usage before generating again.",
        true,
      );
    }
  }

  private edit(
    input: Pick<ImageGenerationInput, "prompt" | "size" | "quality"> & {
      references?: Array<{ bytes: Buffer; mimeType: "image/png" }>;
    },
    model: string,
    apiKey: string,
    signal: AbortSignal,
  ) {
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", input.prompt);
    form.set("size", input.size);
    form.set("quality", input.quality);
    form.set("n", "1");
    form.set("output_format", "png");
    for (const [index, reference] of (input.references ?? []).entries()) {
      form.append(
        "image[]",
        new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }),
        `reference-${index + 1}.png`,
      );
    }
    return fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
  }
}
