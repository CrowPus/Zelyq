import { z } from "zod";
import { jsonOutput, quote } from "./lib/shared.mjs";

async function sharp() {
  // Keep the native dependency isolated to image calls. Other Phase 2 tools
  // remain usable if the operator has not installed Sharp correctly.
  return (await import("sharp")).default;
}

// ---------------------------------------------------------------------------
// fetch_reference_image — search a stock-photo service for a REAL photograph
// matching a query, download the top hit into the project, and return it so
// the model sees the actual subject before it writes a caption. An image ID
// recalled from memory returns HTTP 200 for a file whose subject the model
// cannot know; this closes that gap. Network goes through the project
// runtime's shell (curl), the same path api-tester.mjs and lib/api.mjs use,
// so it respects whatever egress policy the runtime has. With no usable
// provider (or no network) it writes a labelled placeholder to the exact
// requested path instead — never a silent guess.
// ---------------------------------------------------------------------------

const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;

/** Which service to query, resolved from the agent process env.
 *  - unsplash / pexels: need ZELYQ_IMAGE_PROVIDER_KEY.
 *  - openverse: keyless (Creative-Commons media), the default.
 *  Hosts an operator with ZELYQ_CONTAINER_EGRESS_ALLOWLIST must allow:
 *    api.openverse.org · api.unsplash.com images.unsplash.com ·
 *    api.pexels.com images.pexels.com */
function resolveProvider(env) {
  const key = (env.ZELYQ_IMAGE_PROVIDER_KEY ?? "").trim();
  const named = (env.ZELYQ_IMAGE_PROVIDER ?? "").trim().toLowerCase();
  if (named === "unsplash" || named === "pexels") {
    return key
      ? { id: named, key }
      : {
          id: named,
          key: null,
          error: `ZELYQ_IMAGE_PROVIDER=${named} but ZELYQ_IMAGE_PROVIDER_KEY is not set`,
        };
  }
  if (named === "openverse" || named === "") return { id: "openverse", key: null };
  return {
    id: "openverse",
    key: null,
    error: `unknown ZELYQ_IMAGE_PROVIDER "${named}", using openverse`,
  };
}

function searchRequest(provider, query, orientation) {
  const q = encodeURIComponent(query);
  const o = orientation ?? "";
  if (provider.id === "unsplash") {
    const orient = o === "square" ? "squarish" : o; // unsplash's spelling
    return {
      url: `https://api.unsplash.com/search/photos?per_page=3&query=${q}${orient ? `&orientation=${orient}` : ""}`,
      // The key reaches curl through the env, not the command string — see run().
      header: "Authorization: Client-ID $ZELYQ_IMAGE_PROVIDER_KEY",
      pick: (body) =>
        (body.results ?? []).map((r) => ({
          image: r.urls?.regular ?? r.urls?.full,
          credit: r.user?.name,
          source: r.links?.html,
          license: "Unsplash License",
        })),
    };
  }
  if (provider.id === "pexels") {
    return {
      url: `https://api.pexels.com/v1/search?per_page=3&query=${q}${o ? `&orientation=${o}` : ""}`,
      header: "Authorization: $ZELYQ_IMAGE_PROVIDER_KEY",
      pick: (body) =>
        (body.photos ?? []).map((p) => ({
          image: p.src?.large2x ?? p.src?.large ?? p.src?.original,
          credit: p.photographer,
          source: p.url,
          license: "Pexels License",
        })),
    };
  }
  return {
    url: `https://api.openverse.org/v1/images/?page_size=3&q=${q}`,
    header: null,
    pick: (body) =>
      (body.results ?? []).map((r) => ({
        image: r.url,
        credit: r.creator,
        source: r.foreign_landing_url ?? r.url,
        license: r.license
          ? `${String(r.license).toUpperCase()}${r.license_version ? ` ${r.license_version}` : ""}`
          : "see source",
      })),
  };
}

async function curl(context, args, env) {
  const result = await context.runtime.exec(context.projectId, {
    command: `curl --silent --show-error --location --max-time 30 ${args}`,
    timeoutMs: 35_000,
    maxOutputBytes: 5_000_000,
    ...(env ? { env } : {}),
  });
  return result;
}

function looksLikeImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
    return "image/png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  return null;
}

function placeholderSvg(label, width, height) {
  const safe = String(label)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#E5E7EB"/><text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle" fill="#374151" font-family="system-ui,sans-serif" font-size="${Math.max(16, Math.round(Math.min(width, height) / 14))}">${safe}</text><text x="50%" y="56%" text-anchor="middle" dominant-baseline="middle" fill="#6B7280" font-family="system-ui,sans-serif" font-size="${Math.max(12, Math.round(Math.min(width, height) / 22))}">placeholder — replace before shipping</text></svg>`;
}

async function writePlaceholder(context, outputPath, label, note) {
  // Write raw SVG — no Sharp, so the safety net still works when the native
  // binary is missing (the same reason generate_placeholder_asset writes SVG).
  // The path gets an `.svg` extension: an SVG served as `.jpg` will not render
  // in a browser, so the referencing markup must point at this file.
  const svgPath = outputPath.replace(IMAGE_EXT_RE, ".svg");
  const svg = placeholderSvg(label, 1200, 800);
  await context.runtime.writeFile(context.projectId, svgPath, svg);
  context.onFileChanged(svgPath);
  return {
    output:
      `PLACEHOLDER written to ${svgPath} (a labelled grey SVG, not a photograph of "${label}"). ${note} ` +
      `Point your <img>/background at ${svgPath}, and do NOT write copy that asserts this depicts a real ` +
      `place. For real photos, set ZELYQ_IMAGE_PROVIDER (unsplash | pexels) + ZELYQ_IMAGE_PROVIDER_KEY, or ` +
      `supply the image yourself.`,
    images: [{ mimeType: "image/svg+xml", data: Buffer.from(svg).toString("base64") }],
  };
}

const fetchReferenceImageTool = {
  name: "fetch_reference_image",
  description:
    "Search a stock-photo service for a real photograph matching a text query, download the top " +
    "result into the project, and RETURN THE IMAGE so you can see its actual subject before you " +
    "write any caption or copy about it. Use this instead of hardcoding a remote photo URL or ID " +
    "from memory — an HTTP 200 does not tell you what the picture shows. With no image provider " +
    "configured (or no network) it writes a labelled placeholder to the same path and says so; it " +
    "never guesses silently.",
  schema: z.object({
    query: z
      .string()
      .min(2)
      .max(120)
      .describe('What the photo should show, e.g. "kyoto temple autumn"'),
    output_path: z
      .string()
      .regex(IMAGE_EXT_RE, "must end in .jpg, .jpeg, .png, or .webp")
      .describe("Where to write it in the project, e.g. src/assets/kyoto.jpg"),
    orientation: z.enum(["landscape", "portrait", "square"]).optional(),
  }),
  async run(context, input) {
    const env = typeof process !== "undefined" ? process.env : {};
    const provider = resolveProvider(env);
    if (provider.error && !provider.key && provider.id !== "openverse") {
      return writePlaceholder(context, input.output_path, input.query, `${provider.error}.`);
    }

    const req = searchRequest(provider, input.query, input.orientation);
    // A header that references $ZELYQ_IMAGE_PROVIDER_KEY must be double-quoted so
    // the shell expands it (single quotes from quote() would not); the key
    // itself is passed via env, never written into the command. Same shape as
    // plugins/lib/api.mjs.
    const headerArg = req.header
      ? req.header.includes("$")
        ? `--header "${req.header.replaceAll('"', '\\"')}" `
        : `--header ${quote(req.header)} `
      : "";
    const search = await curl(
      context,
      `${headerArg}${quote(req.url)}`,
      provider.key ? { ZELYQ_IMAGE_PROVIDER_KEY: provider.key } : undefined,
    );
    if (search.exitCode !== 0) {
      return writePlaceholder(
        context,
        input.output_path,
        input.query,
        `Could not reach the image service (curl exit ${search.exitCode}${search.timedOut ? ", timed out" : ""}). If this runtime has an egress allowlist, add the provider's API host to it.`,
      );
    }

    let candidates = [];
    try {
      candidates = req.pick(JSON.parse(search.stdout)).filter((c) => c.image);
    } catch {
      return writePlaceholder(
        context,
        input.output_path,
        input.query,
        "The image service did not return usable JSON.",
      );
    }
    if (candidates.length === 0) {
      return writePlaceholder(
        context,
        input.output_path,
        input.query,
        `No ${provider.id} result for "${input.query}".`,
      );
    }

    const chosen = candidates[0];
    const download = await curl(
      context,
      `--output ${quote(input.output_path)} ${quote(chosen.image)}`,
    );
    if (download.exitCode !== 0) {
      return writePlaceholder(
        context,
        input.output_path,
        input.query,
        `Found a result but could not download it (curl exit ${download.exitCode}).`,
      );
    }

    let file;
    try {
      file = await context.runtime.readFile(context.projectId, input.output_path);
    } catch {
      return writePlaceholder(
        context,
        input.output_path,
        input.query,
        "The download wrote no file.",
      );
    }
    const buffer = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
    const mime = looksLikeImage(buffer);
    if (!mime) {
      return writePlaceholder(
        context,
        input.output_path,
        input.query,
        "What downloaded was not a JPEG, PNG, or WebP (likely an error page).",
      );
    }

    context.onFileChanged(input.output_path);
    return {
      output:
        `Wrote ${input.output_path} (${buffer.length} bytes) from ${provider.id}. ` +
        `Credit: ${chosen.credit ?? "unknown"} · ${chosen.license ?? "see source"} · ${chosen.source ?? "n/a"}. ` +
        `Query was "${input.query}". LOOK at the image above: if it does not actually depict what your caption ` +
        `will claim, call this again with a better query or use a placeholder — do not ship a caption you have not verified.`,
      images: [{ mimeType: mime, data: buffer.toString("base64") }],
    };
  },
};

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
  fetchReferenceImageTool,
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
