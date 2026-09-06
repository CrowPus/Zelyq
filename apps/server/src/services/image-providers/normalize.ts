import sharp from "sharp";
import { ImageProviderError, MAX_IMAGE_BYTES } from "./shared.js";

/** Decode before serving, and normalize provider JPEG/WebP outputs to PNG.
 * Preserve the generated dimensions; don't upscale to OpenAI's size presets. */
export async function normalizeImage(encoded: unknown) {
  if (
    typeof encoded !== "string" ||
    !encoded.length ||
    encoded.length > MAX_IMAGE_BYTES * 1.4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new ImageProviderError(
      "The provider returned no usable image. No replacement was generated.",
    );
  }
  try {
    const source = Buffer.from(encoded, "base64");
    if (source.length > MAX_IMAGE_BYTES) throw new Error("Image too large");
    const decoder = sharp(source, { limitInputPixels: 4096 * 4096, failOn: "warning" });
    const meta = await decoder.metadata();
    if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format) || (meta.pages ?? 1) !== 1)
      throw new Error("Invalid format");
    const { data, info } = await decoder.rotate().png().toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES || info.width > 4096 || info.height > 4096)
      throw new Error("Image too large");
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    throw new ImageProviderError(
      "The provider returned an invalid or oversized image. No replacement was generated.",
    );
  }
}
