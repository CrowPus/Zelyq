import { z } from "zod";
import { jsonOutput } from "./lib/shared.mjs";

async function sharp() {
  // Keep the native dependency isolated to image calls. Other Phase 2 tools
  // remain usable if the operator has not installed Sharp correctly.
  return (await import("sharp")).default;
}

async function imageBuffer(context, path) {
  const file = await context.runtime.readFile(context.projectId, path);
  return Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
}
async function save(context, path, buffer) {
  await context.runtime.writeFile(context.projectId, path, buffer.toString("base64"), "base64");
  context.onFileChanged(path);
  return { output: `Wrote ${path} (${buffer.length} bytes).` };
}
export default [
  {
    name: "inspect_image_asset",
    description:
      "Inspect image dimensions, format, color space, alpha, orientation, and byte size.",
    schema: z.object({ path: z.string() }),
    async run(context, input) {
      const buffer = await imageBuffer(context, input.path);
      const processImage = await sharp();
      return jsonOutput({ ...(await processImage(buffer).metadata()), sizeBytes: buffer.length });
    },
  },
  {
    name: "resize_image_asset",
    description:
      "Resize a project image and write a new asset. Preserves aspect ratio unless both dimensions and fit dictate otherwise.",
    schema: z
      .object({
        input_path: z.string(),
        output_path: z.string(),
        width: z.number().int().min(1).max(10000).optional(),
        height: z.number().int().min(1).max(10000).optional(),
        fit: z.enum(["cover", "contain", "fill", "inside", "outside"]).default("inside"),
      })
      .refine((v) => v.width || v.height, "width or height is required"),
    async run(context, input) {
      const processImage = await sharp();
      const buffer = await processImage(await imageBuffer(context, input.input_path))
        .resize({
          width: input.width,
          height: input.height,
          fit: input.fit,
          withoutEnlargement: true,
        })
        .toBuffer();
      return save(context, input.output_path, buffer);
    },
  },
  {
    name: "optimize_image_asset",
    description:
      "Optimize a JPEG, PNG, or WebP project image and write a new file without overwriting the input by default.",
    schema: z.object({
      input_path: z.string(),
      output_path: z.string(),
      format: z.enum(["jpeg", "png", "webp"]).optional(),
      quality: z.number().int().min(1).max(100).default(82),
    }),
    async run(context, input) {
      const processImage = await sharp();
      let pipeline = processImage(await imageBuffer(context, input.input_path)).rotate();
      const format = input.format ?? input.output_path.split(".").pop()?.toLowerCase();
      if (format === "jpeg" || format === "jpg")
        pipeline = pipeline.jpeg({ quality: input.quality, mozjpeg: true });
      else if (format === "png") pipeline = pipeline.png({ compressionLevel: 9 });
      else if (format === "webp") pipeline = pipeline.webp({ quality: input.quality });
      else return { output: "Output format must be jpeg, png, or webp.", isError: true };
      return save(context, input.output_path, await pipeline.toBuffer());
    },
  },
  {
    name: "generate_placeholder_asset",
    description:
      "Generate a deterministic SVG placeholder asset inside the project; no external image service is contacted.",
    schema: z.object({
      output_path: z.string().regex(/\.svg$/i),
      width: z.number().int().min(1).max(5000).default(1200),
      height: z.number().int().min(1).max(5000).default(630),
      label: z.string().max(100).default("Placeholder"),
      background: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#E5E7EB"),
      foreground: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .default("#374151"),
    }),
    async run(context, input) {
      const label = input.label
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><rect width="100%" height="100%" fill="${input.background}"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="${input.foreground}" font-family="system-ui,sans-serif" font-size="${Math.max(16, Math.round(Math.min(input.width, input.height) / 12))}">${label}</text></svg>`;
      await context.runtime.writeFile(context.projectId, input.output_path, svg);
      context.onFileChanged(input.output_path);
      return { output: `Wrote ${input.output_path}.` };
    },
  },
];
