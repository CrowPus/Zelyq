import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * Image generation for the build agent.
 *
 * The agent never talks to an image provider and never touches the image
 * database. It asks the Zelyq server over the session's bridge; the server
 * holds the API key, applies the same limits Image Studio applies, and records
 * every image against the connecting user — which is why anything the agent
 * makes turns up in that person's Image Studio library.
 *
 * All three tools are hidden unless `imageBridge` is present, which it is only
 * when the project has image generation switched on and the instance has a
 * provider configured. Absence is the permission being off.
 */

const PNG_PATH = /\.png$/i;
const IMAGE_ID = /^img_[a-f0-9]{32}$/;
/** Long enough for a slow provider; the server's own timeout is five minutes. */
const POLL_TIMEOUT_MS = 5 * 60_000;

type Bridge = { url: string; token: string };

function bridgeOf(context: ToolContext): Bridge {
  const bridge = context.imageBridge;
  if (!bridge)
    throw new Error(
      "Image generation is not switched on for this project. The person you are working " +
        "for can turn it on with the Images button in the chat toolbar. Do not retry until they do.",
    );
  return bridge;
}

async function call(
  context: ToolContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const bridge = bridgeOf(context);
  const res = await fetch(`${bridge.url}/api/internal/images/${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-zelyq-image-bridge": bridge.token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: context.signal,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

/** The server's error message, which already says what a caller can do about
 *  it, rather than a generic failure invented here. */
function serverMessage(json: Record<string, unknown>, fallback: string): string {
  const error = json.error as { message?: string } | undefined;
  return error?.message ?? fallback;
}

/** Reject an absolute path or one that climbs out of the project. The runtime
 *  enforces this too; failing here gives the model a usable message instead of
 *  a write error after the image has already been paid for. */
function checkPath(path: string): string | null {
  if (!PNG_PATH.test(path)) return "output_path must end in .png";
  if (path.startsWith("/")) return "output_path must be relative to the project";
  if (path.split("/").includes("..")) return "output_path must not contain ..";
  return null;
}

async function fetchBytes(context: ToolContext, id: string) {
  const { ok, json } = await call(context, "GET", `generations/${id}/bytes`);
  if (!ok) throw new Error(serverMessage(json, "Could not read the generated image."));
  return json as unknown as {
    png: string;
    preview: string;
    width: number;
    height: number;
    sizeBytes: number;
  };
}

async function writeIntoProject(context: ToolContext, path: string, pngBase64: string) {
  await context.runtime.writeFile(context.projectId, path, pngBase64, "base64");
  context.onFileChanged(path);
}

export const generateImageTool = defineTool({
  name: "generate_image",
  description:
    "Generate an ORIGINAL image from a text description and save it to the user's image library, " +
    "optionally writing it into the project. Use this for artwork that does not exist yet: " +
    "illustrations, icons, textures, patterns, abstract or hero graphics, or a look specific to " +
    "this brand. Do NOT use it for a real place, person, company, product or landmark — a " +
    "generated 'Kyoto in autumn' is not a photograph of Kyoto, and captioning it as one ships a " +
    "lie; use fetch_reference_image for anything the copy claims is real, and never generate a " +
    "real company's logo. Each image costs the instance money and counts against a per-hour and " +
    "a per-conversation limit, so check list_generated_images first and reuse what fits. Returns " +
    "a small preview so you can see what you actually made before writing copy about it.",
  schema: z.object({
    prompt: z
      .string()
      .min(1)
      .max(8000)
      .describe("What the image should show, including style, composition and mood"),
    output_path: z
      .string()
      .min(1)
      .optional()
      .describe("Where to write it in the project, e.g. src/assets/hero.png. Must end in .png"),
    size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).optional(),
    quality: z.enum(["low", "medium", "high"]).optional(),
    reference_paths: z
      .array(z.string().min(1))
      .max(3)
      .optional()
      .describe("Up to 3 image files already in the project to guide the result"),
  }),
  async run(context, input): Promise<ToolResult> {
    if (input.output_path) {
      const problem = checkPath(input.output_path);
      if (problem) return { output: problem, isError: true };
    }

    // References are named as project files; reading and encoding them is this
    // tool's job, so the model never handles base64 by hand.
    const references: Array<{ mimeType: "image/png"; data: string }> = [];
    for (const path of input.reference_paths ?? []) {
      try {
        const file = await context.runtime.readFile(context.projectId, path);
        // A PNG comes back already base64-encoded; only a text file arrives as
        // utf8, and encoding it as an image would send the provider nonsense.
        references.push({
          mimeType: "image/png",
          data:
            file.encoding === "base64"
              ? file.content
              : Buffer.from(file.content, "utf8").toString("base64"),
        });
      } catch {
        return { output: `Could not read the reference image ${path}.`, isError: true };
      }
    }

    const submit = await call(context, "POST", "generations", {
      prompt: input.prompt,
      ...(input.size ? { size: input.size } : {}),
      ...(input.quality ? { quality: input.quality } : {}),
      ...(references.length ? { references } : {}),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!submit.ok)
      return {
        output: serverMessage(submit.json, "The image could not be requested."),
        isError: true,
      };

    const generation = (submit.json.generation ?? {}) as { id?: string };
    const id = generation.id;
    if (!id) return { output: "The server did not return an image id.", isError: true };

    context.log(`Generating an image: ${input.prompt.slice(0, 80)}`);

    // Poll until the job reaches a terminal state. Cancelling the turn aborts
    // the wait; the job keeps running server-side and still lands in the
    // library, because the provider may already have been paid.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = "queued";
    let error: string | null = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (context.signal.aborted)
        return {
          output: `Cancelled while waiting. The image is still being generated and will appear in Image Studio; its id is ${id}.`,
          isError: true,
        };
      const poll = await call(context, "GET", `generations/${id}`);
      if (!poll.ok) continue;
      const row = (poll.json.generation ?? {}) as { status?: string; error?: string | null };
      status = row.status ?? status;
      error = row.error ?? null;
      if (status === "succeeded" || status === "failed" || status === "unknown") break;
    }

    if (status === "unknown")
      return {
        output:
          `The image's outcome could not be confirmed (id ${id}). It may have been generated and ` +
          `billed, so it is NOT resubmitted automatically. Check Image Studio before trying again.`,
        isError: true,
      };
    if (status !== "succeeded")
      return {
        output: error
          ? `Image generation failed: ${error}`
          : `Image generation did not finish in time (id ${id}).`,
        isError: true,
      };

    const bytes = await fetchBytes(context, id);
    let placed = "";
    if (input.output_path) {
      await writeIntoProject(context, input.output_path, bytes.png);
      placed = ` Written to ${input.output_path}.`;
    }
    return {
      output:
        `Generated a ${bytes.width}x${bytes.height} PNG (id ${id}).${placed} ` +
        `It is saved in the user's Image Studio library. The preview below is what it actually ` +
        `shows — describe only what you can see in it.` +
        (input.output_path ? "" : " Use place_generated_image to put it in the project."),
      images: [{ mimeType: "image/png", data: bytes.preview }],
    };
  },
});

export const placeGeneratedImageTool = defineTool({
  name: "place_generated_image",
  description:
    "Copy an image that already exists in the user's image library into this project. Costs " +
    "nothing and calls no provider — use it instead of generate_image whenever a suitable image " +
    "already exists, including ones the user made themselves in Image Studio. Get ids from " +
    "list_generated_images.",
  schema: z.object({
    image_id: z.string().describe("The image's id, e.g. img_… , from list_generated_images"),
    output_path: z
      .string()
      .min(1)
      .describe("Where to write it in the project, e.g. src/assets/hero.png. Must end in .png"),
  }),
  async run(context, input): Promise<ToolResult> {
    if (!IMAGE_ID.test(input.image_id))
      return { output: "That is not a valid image id.", isError: true };
    const problem = checkPath(input.output_path);
    if (problem) return { output: problem, isError: true };

    let bytes: Awaited<ReturnType<typeof fetchBytes>>;
    try {
      bytes = await fetchBytes(context, input.image_id);
    } catch (error) {
      return { output: (error as Error).message, isError: true };
    }
    await writeIntoProject(context, input.output_path, bytes.png);
    return {
      output: `Wrote ${input.image_id} (${bytes.width}x${bytes.height}) to ${input.output_path}. The preview below is what it shows.`,
      images: [{ mimeType: "image/png", data: bytes.preview }],
    };
  },
});

export const listGeneratedImagesTool = defineTool({
  name: "list_generated_images",
  description:
    "List the images already in the user's image library — the ones they made in Image Studio and " +
    "the ones you generated earlier. Costs nothing. Check this BEFORE generating: reusing a " +
    "suitable image is free, and generating a near-duplicate spends the user's money and their " +
    "hourly limit. Returns ids for place_generated_image.",
  schema: z.object({}),
  async run(context): Promise<ToolResult> {
    const { ok, json } = await call(context, "GET", "library");
    if (!ok)
      return { output: serverMessage(json, "Could not read the image library."), isError: true };
    const items = (json.generations ?? []) as Array<{
      id: string;
      prompt: string;
      status: string;
      size: string;
      source: string;
      projectName: string;
      createdAt: string;
    }>;
    const usable = items.filter((item) => item.status === "succeeded");
    if (usable.length === 0)
      return { output: "The image library is empty. Use generate_image to create one." };
    const lines = usable.map((item) => {
      const origin =
        item.source === "agent"
          ? ` · made by the agent${item.projectName ? ` in ${item.projectName}` : ""}`
          : " · made in Image Studio";
      return `${item.id} · ${item.size}${origin} · ${item.prompt.slice(0, 120)}`;
    });
    return {
      output: `${usable.length} image(s) available. Reuse one with place_generated_image rather than generating a near-duplicate.\n${lines.join("\n")}`,
    };
  },
});

export const IMAGE_TOOL_NAMES = [
  "generate_image",
  "place_generated_image",
  "list_generated_images",
] as const;
