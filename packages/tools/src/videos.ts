import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult } from "./types.js";

/**
 * Video for the build agent.
 *
 * The point of these is narrow and worth stating: `cinematic_pass` can already
 * build a scroll-driven hero, but it stops and asks a human for footage,
 * because Zelyq could not make any. These tools remove that stall.
 *
 * Same bridge shape as images — the agent never holds the video API key and
 * never touches the database — but a SEPARATE permission and grant, because a
 * clip costs far more than a picture and one must not imply the other.
 */

const MP4_PATH = /\.mp4$/i;
const VIDEO_ID = /^vid_[a-f0-9]{32}$/;
/** A clip takes minutes; the server's own window is longer still. */
const POLL_TIMEOUT_MS = 10 * 60_000;

function bridgeOf(context: ToolContext) {
  const bridge = context.videoBridge;
  if (!bridge)
    throw new Error(
      "Video generation is not switched on for this project. The person you are working for can " +
        "turn it on with the Video button in the chat toolbar. Do not retry until they do.",
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
  const res = await fetch(`${bridge.url}/api/internal/videos/${path}`, {
    method,
    headers: { "content-type": "application/json", "x-zelyq-video-bridge": bridge.token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: context.signal,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

function serverMessage(json: Record<string, unknown>, fallback: string): string {
  return (json.error as { message?: string } | undefined)?.message ?? fallback;
}

/** Reject an absolute path or one climbing out of the project. The runtime
 *  enforces this too; failing here gives a usable message before anything is
 *  paid for or written. */
function checkPath(path: string, extension: RegExp, hint: string): string | null {
  if (!extension.test(path)) return hint;
  if (path.startsWith("/")) return "The path must be relative to the project";
  if (path.split("/").includes("..")) return "The path must not contain ..";
  return null;
}

export const listGeneratedVideosTool = defineTool({
  name: "list_generated_videos",
  description:
    "List the clips already in the user's video library — ones they made in Video Studio and ones " +
    "you generated earlier. Costs nothing. Check this BEFORE generating: reusing a clip is free, " +
    "and a near-duplicate spends real money and the user's hourly limit. Returns ids for " +
    "place_video and place_video_frames.",
  schema: z.object({}),
  async run(context): Promise<ToolResult> {
    const { ok, json } = await call(context, "GET", "library");
    if (!ok)
      return { output: serverMessage(json, "Could not read the video library."), isError: true };
    const items = (json.generations ?? []) as Array<{
      id: string;
      status: string;
      source: string;
      projectName: string;
      input: { prompt: string; aspectRatio: string; durationSeconds: number };
      asset: { width: number; height: number; durationSeconds: number } | null;
    }>;
    const usable = items.filter((item) => item.status === "succeeded" && item.asset);
    if (usable.length === 0)
      return { output: "The video library is empty. Use generate_video to create a clip." };
    const lines = usable.map((item) => {
      const made =
        item.source === "agent"
          ? `agent${item.projectName ? `/${item.projectName}` : ""}`
          : "studio";
      return `${item.id} · ${item.asset?.width}x${item.asset?.height} · ${item.asset?.durationSeconds.toFixed(1)}s · ${made} · ${item.input.prompt.slice(0, 100)}`;
    });
    return {
      output: `${usable.length} clip(s) available. Reuse one with place_video or place_video_frames rather than generating a near-duplicate.\n${lines.join("\n")}`,
    };
  },
});

export const generateVideoTool = defineTool({
  name: "generate_video",
  description:
    "Generate ONE short original video clip from a description, saved to the user's library. This " +
    "COSTS REAL MONEY — far more than an image — and a conversation may only generate a couple. " +
    "Call list_generated_videos first and reuse anything suitable. Use it for abstract, " +
    "atmospheric or illustrative motion, or a product that does not exist yet. Do NOT use it for a " +
    "real place, person, company or landmark: a generated 'drone shot over Lagos' is not Lagos, " +
    "and a hero captioned as such is a lie the user ships — use fetch_reference_image for anything " +
    "the copy claims is real. After it succeeds, decide how the clip should be USED: " +
    "place_video for ambient looping motion, or place_video_frames when it should play as the " +
    "user scrolls.",
  schema: z.object({
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe("The scene and its motion: subject, camera move, lighting, pace"),
    aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
    duration_seconds: z.number().int().min(1).max(15).optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    const submit = await call(context, "POST", "generations", {
      prompt: input.prompt,
      mode: "text-to-video",
      aspectRatio: input.aspect_ratio ?? "16:9",
      durationSeconds: input.duration_seconds ?? 8,
      resolution: input.resolution ?? "720p",
      audio: false,
      // Provider and model are deliberately absent: the server resolves the
      // instance's configured default. Choosing a vendor is not the agent's
      // decision, and a wrong one would be a billing surprise.
      idempotencyKey: crypto.randomUUID(),
    });
    if (!submit.ok)
      return {
        output: serverMessage(submit.json, "The video could not be requested."),
        isError: true,
      };

    const generation = (submit.json.generation ?? {}) as { id?: string };
    const id = generation.id;
    if (!id) return { output: "The server did not return a video id.", isError: true };
    const used = submit.json.used as number | undefined;
    const limit = submit.json.limit as number | undefined;

    context.log(`Generating a video: ${input.prompt.slice(0, 80)}`);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = "queued";
    let error: string | null = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (context.signal.aborted)
        return {
          output: `Cancelled while waiting. The clip is still being generated and will appear in Video Studio; its id is ${id}.`,
          isError: true,
        };
      const poll = await call(context, "GET", `generations/${id}`);
      if (!poll.ok) continue;
      const row = (poll.json.generation ?? {}) as { status?: string; error?: string | null };
      status = row.status ?? status;
      error = row.error ?? null;
      if (["succeeded", "failed", "unknown", "cancelled"].includes(status)) break;
    }

    if (status === "unknown")
      return {
        output:
          `The clip's outcome could not be confirmed (id ${id}). It may have been generated and ` +
          `billed, so it is NOT resubmitted automatically. Tell the user to check Video Studio.`,
        isError: true,
      };
    if (status !== "succeeded")
      return {
        output: error
          ? `Video generation failed: ${error}`
          : `The video did not finish in time (id ${id}). Do not resubmit; check Video Studio.`,
        isError: true,
      };

    const budget = used && limit ? ` (${used} of ${limit} for this conversation)` : "";
    return {
      output:
        `Generated a clip, id ${id}${budget}. It is saved in the user's Video Studio library. ` +
        `Now decide how it is used: place_video writes an MP4 for ambient looping motion; ` +
        `place_video_frames writes an image sequence for motion driven by scroll position.`,
    };
  },
});

export const placeVideoTool = defineTool({
  name: "place_video",
  description:
    "Copy a finished clip from the library into this project as an MP4, with a poster image " +
    "beside it. Costs nothing. Use this for AMBIENT motion — a hero that loops quietly behind the " +
    "copy, with no relationship to scroll position. Render it muted, looping, playsinline, with " +
    "the poster as its `poster` attribute and a reduced-motion fallback that shows the poster " +
    "instead. If the motion should instead advance as the user scrolls, use place_video_frames.",
  schema: z.object({
    video_id: z.string().describe("The clip's id, from list_generated_videos or generate_video"),
    output_path: z
      .string()
      .min(1)
      .describe("Where to write it, e.g. public/media/hero.mp4. Must end in .mp4"),
  }),
  async run(context, input): Promise<ToolResult> {
    if (!VIDEO_ID.test(input.video_id))
      return { output: "That is not a valid video id.", isError: true };
    const problem = checkPath(input.output_path, MP4_PATH, "output_path must end in .mp4");
    if (problem) return { output: problem, isError: true };

    const { ok, json } = await call(context, "GET", `generations/${input.video_id}/bytes`);
    if (!ok) return { output: serverMessage(json, "Could not read that clip."), isError: true };
    const body = json as unknown as {
      mp4: string;
      poster: string;
      width: number;
      height: number;
      durationSeconds: number;
    };
    const posterPath = input.output_path.replace(MP4_PATH, ".webp");
    await context.runtime.writeFile(context.projectId, input.output_path, body.mp4, "base64");
    context.onFileChanged(input.output_path);
    await context.runtime.writeFile(context.projectId, posterPath, body.poster, "base64");
    context.onFileChanged(posterPath);
    return {
      output:
        `Wrote ${input.output_path} (${body.width}x${body.height}, ${body.durationSeconds.toFixed(1)}s) ` +
        `and its poster ${posterPath}. Use it muted + loop + playsinline with poster="${posterPath.replace(/^public\//, "/")}", ` +
        `and show the poster alone under prefers-reduced-motion.`,
    };
  },
});

export const placeVideoFramesTool = defineTool({
  name: "place_video_frames",
  description:
    "Split a finished clip into a numbered image sequence and write it into the project for a " +
    "SCROLL-SCRUBBED section — footage that advances as the user scrolls down and rewinds as they " +
    "scroll up. Costs nothing. Writes frame_0001.webp…, poster.webp and manifest.json into " +
    "public/cinematic/<slug>/, which is exactly what the scroll-video-scrub recipe reads: build " +
    "the canvas from manifest.json rather than hardcoding a count. Use ~120 frames for a smooth " +
    "scrub. If the motion is NOT tied to scroll position, a looping video is cheaper and better — " +
    "use place_video instead.",
  schema: z.object({
    video_id: z.string().describe("The clip's id, from list_generated_videos or generate_video"),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lowercase letters, digits and hyphens")
      .describe("Folder name under public/cinematic/, e.g. hero"),
    count: z.number().int().min(8).max(240).optional().describe("Frames; ~120 is the sweet spot"),
    width: z.number().int().min(320).max(1920).optional().describe("Sized to the rendered canvas"),
  }),
  async run(context, input): Promise<ToolResult> {
    if (!VIDEO_ID.test(input.video_id))
      return { output: "That is not a valid video id.", isError: true };

    const { ok, json } = await call(context, "POST", `generations/${input.video_id}/frames`, {
      format: "webp",
      ...(input.count ? { count: input.count } : {}),
      ...(input.width ? { width: input.width } : {}),
    });
    if (!ok)
      return {
        output: serverMessage(json, "Could not extract frames from that clip."),
        isError: true,
      };

    const set = json.frames as { count: number; width: number; height: number; fps: number };
    const files = json.files as Array<{ name: string; data: string }>;
    const directory = `public/cinematic/${input.slug}`;
    for (const file of files) {
      const target = `${directory}/${file.name}`;
      await context.runtime.writeFile(context.projectId, target, file.data, "base64");
    }
    context.onFileChanged(`${directory}/manifest.json`);
    return {
      output:
        `Wrote ${files.length} files to ${directory}/ — ${set.count} frames at ${set.width}x${set.height}, ` +
        `plus poster.webp and manifest.json. Read the manifest at /cinematic/${input.slug}/manifest.json ` +
        `and paint frames onto a canvas from scroll progress; show poster.webp for first paint and ` +
        `under prefers-reduced-motion. Do not hardcode the frame count.`,
    };
  },
});

export const VIDEO_TOOL_NAMES = [
  "list_generated_videos",
  "generate_video",
  "place_video",
  "place_video_frames",
] as const;
