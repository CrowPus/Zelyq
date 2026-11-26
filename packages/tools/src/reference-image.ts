import { z } from "zod";
import { CaptureBlockedError, type GuardedResponse, guardedFetch } from "./capture-fetch-guard.js";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * `fetch_reference_image`: a real photograph for a query, downloaded into the
 * project and shown to the model before it writes a caption about it.
 *
 * It was a plugin that ran `curl` inside the project's runtime. That loaded
 * only when ZELYQ_PLUGIN_DIR was set, while the prompt told every project to
 * use it, and it failed wherever the runtime had no curl or no way out: 0 of
 * 5 recorded calls returned a photo. Built in, the agent process fetches
 * through the same guard as `capture_reference` (public hosts only, every
 * redirect re-checked), and writes the file into the project through the
 * runtime, so it works the same on every runtime.
 *
 * With no provider, no network or no result it writes a labelled placeholder
 * at the same path and says so. It never guesses.
 */

const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;

interface Provider {
  id: "openverse" | "unsplash" | "pexels";
  key: string | null;
  error?: string;
}

interface Candidate {
  image: string;
  credit?: string;
  source?: string;
  license?: string;
}

/**
 * Openverse needs no key and is the default. Unsplash and Pexels need
 * ZELYQ_IMAGE_PROVIDER_KEY.
 */
export function resolveImageProvider(env: NodeJS.ProcessEnv): Provider {
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
  return { id: "openverse", key: null, error: `unknown ZELYQ_IMAGE_PROVIDER "${named}"` };
}

type Json = Record<string, unknown>;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});

export function searchRequest(
  provider: Provider,
  query: string,
  orientation?: string,
): { url: string; headers: Record<string, string>; pick: (body: Json) => Candidate[] } {
  const q = encodeURIComponent(query);
  const o = orientation ?? "";
  if (provider.id === "unsplash") {
    const orient = o === "square" ? "squarish" : o;
    return {
      url: `https://api.unsplash.com/search/photos?per_page=3&query=${q}${orient ? `&orientation=${orient}` : ""}`,
      headers: { authorization: `Client-ID ${provider.key ?? ""}` },
      pick: (body) =>
        list(body.results).map((r) => ({
          image: str(obj(r.urls).regular) ?? str(obj(r.urls).full) ?? "",
          credit: str(obj(r.user).name),
          source: str(obj(r.links).html),
          license: "Unsplash License",
        })),
    };
  }
  if (provider.id === "pexels") {
    return {
      url: `https://api.pexels.com/v1/search?per_page=3&query=${q}${o ? `&orientation=${o}` : ""}`,
      headers: { authorization: provider.key ?? "" },
      pick: (body) =>
        list(body.photos).map((p) => ({
          image: str(obj(p.src).large2x) ?? str(obj(p.src).large) ?? str(obj(p.src).original) ?? "",
          credit: str(p.photographer),
          source: str(p.url),
          license: "Pexels License",
        })),
    };
  }
  return {
    // Only licenses that allow commercial use and changes: most sites built
    // here sell something, and a crop is a change.
    url: `https://api.openverse.org/v1/images/?page_size=3&license_type=commercial,modification&q=${q}`,
    headers: {},
    pick: (body) =>
      list(body.results).map((r) => {
        const license = str(r.license);
        const version = str(r.license_version);
        return {
          image: str(r.url) ?? "",
          credit: str(r.creator),
          source: str(r.foreign_landing_url) ?? str(r.url),
          license: license
            ? `${license.toUpperCase()}${version ? ` ${version}` : ""}`
            : "see source",
        };
      }),
  };
}

export function sniffImage(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function placeholderSvg(label: string, width: number, height: number): string {
  const safe = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const big = Math.max(16, Math.round(Math.min(width, height) / 14));
  const small = Math.max(12, Math.round(Math.min(width, height) / 22));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#E5E7EB"/>` +
    `<text x="50%" y="46%" text-anchor="middle" dominant-baseline="middle" fill="#374151" font-family="system-ui,sans-serif" font-size="${big}">${safe}</text>` +
    `<text x="50%" y="56%" text-anchor="middle" dominant-baseline="middle" fill="#6B7280" font-family="system-ui,sans-serif" font-size="${small}">placeholder — replace before shipping</text>` +
    "</svg>"
  );
}

async function writePlaceholder(
  context: ToolContext,
  outputPath: string,
  label: string,
  note: string,
): Promise<ToolResult> {
  // An SVG served as .jpg does not render, so the path takes .svg and the
  // markup must point at that.
  const svgPath = outputPath.replace(IMAGE_EXT_RE, ".svg");
  const svg = placeholderSvg(label, 1200, 800);
  await context.runtime.writeFile(context.projectId, svgPath, svg);
  context.onFileChanged(svgPath);
  return {
    output:
      `PLACEHOLDER written to ${svgPath} (a labelled grey SVG, not a photograph of "${label}"). ${note} ` +
      `Point your <img> or background at ${svgPath}, and do NOT write copy that claims it shows a ` +
      "real place. For real photos the operator sets ZELYQ_IMAGE_PROVIDER (unsplash | pexels) and " +
      "ZELYQ_IMAGE_PROVIDER_KEY, or the person supplies the image.",
    // No picture of the placeholder: it is a grey box with a label, and an
    // SVG is a format OpenAI and Claude refuse outright.
  };
}

type Fetch = (url: string, headers: Record<string, string>) => Promise<GuardedResponse>;
let fetchImpl: Fetch = (url, headers) =>
  guardedFetch(url, { headers, timeoutMs: 30_000, maxBytes: 12 * 1024 * 1024 });

/** Test seam: replaces the network. Returns the previous implementation. */
export function __setReferenceImageFetch(next: Fetch): Fetch {
  const previous = fetchImpl;
  fetchImpl = next;
  return previous;
}

const describeFailure = (error: unknown): string =>
  error instanceof CaptureBlockedError ? error.reason : (error as Error).message;

export const fetchReferenceImageTool = defineTool({
  name: "fetch_reference_image",
  description:
    "Search a stock-photo service for a real photograph matching a text query, download the top " +
    "result into the project, and RETURN THE IMAGE so you can see its actual subject before you " +
    "write any caption or copy about it. Use this instead of hardcoding a remote photo URL or ID " +
    "from memory — an HTTP 200 does not tell you what the picture shows. With no image provider " +
    "or no network it writes a labelled placeholder to the same path and says so; it never " +
    "guesses silently.",
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
    const provider = resolveImageProvider(process.env);
    if (provider.error && !provider.key && provider.id !== "openverse") {
      return writePlaceholder(context, input.output_path, input.query, `${provider.error}.`);
    }
    // A long, descriptive query ("restaurant table dinner plates glasses warm
    // elegant dining") usually matches nothing in a stock library, which
    // searches for every word. Before settling for a placeholder, the same
    // search is tried with its first three words, then its first two.
    let candidates: Candidate[] = [];
    let usedQuery = input.query;
    for (const query of shorterQueries(input.query)) {
      const request = searchRequest(provider, query, input.orientation);
      try {
        const search = await fetchImpl(request.url, request.headers);
        if (search.status !== 200) {
          return writePlaceholder(
            context,
            input.output_path,
            input.query,
            `The ${provider.id} search answered ${search.status}.`,
          );
        }
        candidates = request
          .pick(obj(JSON.parse(search.body.toString("utf8"))))
          .filter((c) => c.image);
      } catch (error) {
        return writePlaceholder(
          context,
          input.output_path,
          input.query,
          `Could not search ${provider.id}: ${describeFailure(error)}.`,
        );
      }
      usedQuery = query;
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) {
      return writePlaceholder(
        context,
        input.output_path,
        input.query,
        `No ${provider.id} result for "${input.query}", nor for a shorter "${usedQuery}".`,
      );
    }

    // The top hit, or the next one when a host refuses or sends something
    // that is not an image.
    const failures: string[] = [];
    for (const chosen of candidates) {
      let buffer: Buffer;
      try {
        const download = await fetchImpl(chosen.image, {});
        if (download.status !== 200) {
          failures.push(`${download.status}`);
          continue;
        }
        buffer = download.body;
      } catch (error) {
        failures.push(describeFailure(error));
        continue;
      }
      const mime = sniffImage(buffer);
      if (!mime) {
        failures.push("not a JPEG, PNG or WebP");
        continue;
      }
      await context.runtime.writeFile(
        context.projectId,
        input.output_path,
        buffer.toString("base64"),
        "base64",
      );
      context.onFileChanged(input.output_path);
      return {
        output:
          `Wrote ${input.output_path} (${buffer.length} bytes) from ${provider.id}. ` +
          `Credit: ${chosen.credit ?? "unknown"} · ${chosen.license ?? "see source"} · ` +
          `${chosen.source ?? "n/a"}. Query was "${usedQuery}". LOOK at the image: if it does ` +
          "not show what your caption will claim, call this again with a better query or use a " +
          "placeholder. Credit the photographer where the license asks for it.",
        images: [{ mimeType: mime, data: buffer.toString("base64") }],
      };
    }
    return writePlaceholder(
      context,
      input.output_path,
      input.query,
      `Found results but could not download one (${failures.join("; ")}).`,
    );
  },
});

/** The query, then its first three words, then its first two — no repeats. */
export function shorterQueries(query: string): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const tries = [words.join(" "), words.slice(0, 3).join(" "), words.slice(0, 2).join(" ")];
  return [...new Set(tries.filter((q) => q.length >= 2))];
}
