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

export class GoogleImageProvider implements ImageProvider {
  async generate(
    input: Pick<ImageGenerationInput, "prompt" | "size" | "quality"> & {
      references?: Array<{ bytes: Buffer; mimeType: "image/png" }>;
    },
    model: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<GeneratedImage> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: input.prompt },
                  ...(input.references ?? []).map((reference) => ({
                    inlineData: {
                      mimeType: reference.mimeType,
                      data: reference.bytes.toString("base64"),
                    },
                  })),
                ],
              },
            ],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              responseFormat: {
                image: {
                  aspectRatio: googleAspectRatio(input.size),
                  imageSize: "IMAGE_SIZE_ONE_K",
                },
              },
            },
          }),
        },
      );
      await requireImageResponse(response);
      const body = JSON.parse(await boundedBody(response)) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ thought?: boolean; inlineData?: { data?: string; mimeType?: string } }>;
          };
        }>;
        usageMetadata?: unknown;
      };
      const part = body.candidates?.[0]?.content?.parts?.find(
        (part) => !part.thought && part.inlineData,
      );
      if (
        !part?.inlineData?.mimeType ||
        !["image/png", "image/jpeg", "image/webp"].includes(part.inlineData.mimeType)
      )
        throw new ImageProviderError("Google did not return an image. Try adjusting your prompt.");
      return {
        ...(await normalizeImage(part.inlineData.data)),
        requestId: response.headers.get("x-request-id"),
        usage: body.usageMetadata ? JSON.stringify(body.usageMetadata) : null,
      };
    } catch (error) {
      if (error instanceof ImageProviderError) throw error;
      throw new ImageProviderError(
        "The connection ended before Google confirmed generation. Check provider usage before generating again.",
        true,
      );
    }
  }
}

function googleAspectRatio(size: ImageGenerationInput["size"]) {
  switch (imageAspectRatio(size)) {
    case "3:2":
      return "ASPECT_RATIO_THREE_BY_TWO";
    case "2:3":
      return "ASPECT_RATIO_TWO_BY_THREE";
    default:
      return "ASPECT_RATIO_ONE_BY_ONE";
  }
}
