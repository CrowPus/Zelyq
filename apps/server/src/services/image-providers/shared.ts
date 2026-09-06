import type { ImageGenerationInput } from "@zelyq/core";

export function imageAspectRatio(size: ImageGenerationInput["size"]) {
  return size === "1536x1024" ? "3:2" : size === "1024x1536" ? "2:3" : "1:1";
}

export async function requireImageResponse(response: Response) {
  if (response.ok) return;
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403)
    throw new ImageProviderError(
      "Image generation is not authorized. Check this provider's image API key and model access in Settings.",
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
    "The provider rejected this request. Adjust the prompt or check model access in Settings.",
  );
}

export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}

export interface GeneratedImage {
  bytes: Buffer;
  width: number;
  height: number;
  requestId: string | null;
  usage: string | null;
}

export interface ImageProvider {
  generate(
    input: Pick<ImageGenerationInput, "prompt" | "size" | "quality"> & {
      references?: Array<{ bytes: Buffer; mimeType: "image/png" }>;
    },
    model: string,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<GeneratedImage>;
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Validate the PNG container and dimensions before persisting/serving it. */
export function inspectPng(bytes: Buffer): { width: number; height: number } {
  const invalid = () =>
    new ImageProviderError("The provider returned an invalid image. No replacement was generated.");
  if (
    bytes.length < 45 ||
    bytes.length > MAX_IMAGE_BYTES ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw invalid();
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw invalid();
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw invalid();
  let offset = 8;
  let hasData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw invalid();
    if (type === "IDAT") hasData = true;
    offset += length + 12;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length || !hasData) throw invalid();
      return { width, height };
    }
  }
  throw invalid();
}

export async function boundedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ImageProviderError("The image provider returned an empty response.", true);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES * 1.4)
        throw new ImageProviderError(
          "The generated image exceeded the download limit. No replacement was generated.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}
