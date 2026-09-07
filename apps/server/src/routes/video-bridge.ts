import {
  frameExportInputSchema,
  maxVideoReferenceBytes,
  videoGenerationInputSchema,
  videoIdSchema,
  videoInputError,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { VideoBridge } from "../services/video-bridge.js";
import type { VideoGenerationService } from "../services/video-generation.js";

/**
 * The endpoints the build agent calls through the video bridge. Authenticated
 * ONLY by the bridge token (`x-zelyq-video-bridge`), never a user cookie.
 *
 * Every call generates as the connecting user, so an agent's clip lands in
 * that person's Video Studio library under the same limits Studio applies. The
 * video API key never leaves this process.
 */

/**
 * The agent does not choose a vendor — picking one would be a billing surprise
 * — so `provider` and `model` are optional here and resolved from the
 * instance's configured default before validation.
 */
const submitSchema = videoGenerationInputSchema
  .omit({ provider: true, model: true })
  .partial({ referenceId: true });

export function registerVideoBridgeRoutes(
  app: FastifyInstance,
  deps: { bridge: VideoBridge; videos: VideoGenerationService; store: Store },
): void {
  const { bridge, videos, store } = deps;

  async function context(request: { headers: Record<string, unknown> }) {
    const token = request.headers["x-zelyq-video-bridge"];
    const grant = typeof token === "string" ? bridge.resolve(token) : null;
    if (!grant) throw new ZelyqError("unauthorized", "Invalid or expired video bridge token.");
    const user = await store.users.findById(grant.userId);
    if (!user) throw new ZelyqError("unauthorized", "The bridge's user no longer exists.");
    return grant;
  }

  app.post<{ Body: unknown }>("/api/internal/videos/generations", async (request, reply) => {
    const grant = await context(request);
    const requested = submitSchema.parse(request.body);
    const capabilities = await videos.capabilities();
    const provider =
      capabilities.providers.find((entry) => entry.id === capabilities.provider) ??
      capabilities.providers.find((entry) => entry.configured);
    if (!provider?.configured)
      throw new ZelyqError(
        "model_error",
        "No video provider is configured. An administrator sets one up in Settings.",
      );
    // The agent states intent; the server makes it valid for whichever model
    // this instance runs. Hardcoding a vendor's rules in a tool is how five
    // generate_video calls in a row came back in 10ms with "this model always
    // generates audio" — the tool had asked for silence, which Veo cannot do.
    const nearest = (wanted: number, allowed: readonly number[]) =>
      [...allowed].sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0] ?? allowed[0];
    const durationSeconds = provider.durations.includes(requested.durationSeconds)
      ? requested.durationSeconds
      : (nearest(requested.durationSeconds, provider.durations) as number);
    const input = videoGenerationInputSchema.parse({
      ...requested,
      provider: provider.id,
      model: provider.model,
      aspectRatio: provider.ratios.includes(requested.aspectRatio)
        ? requested.aspectRatio
        : provider.ratios[0],
      durationSeconds,
      resolution: provider.resolutions.includes(requested.resolution)
        ? requested.resolution
        : provider.resolutions[0],
      // "always" means the model cannot be silent; "optional" respects the ask.
      audio: provider.audio === "always" ? true : requested.audio,
      // Veo's own rule, and the only combination the capability table cannot
      // express on its own.
      ...(provider.id === "google" && requested.resolution === "1080p" && durationSeconds !== 8
        ? { resolution: "720p" }
        : {}),
    });
    const invalid = videoInputError(input);
    if (invalid) throw ZelyqError.badRequest(invalid);
    const result = await videos.submitForAgent(grant.userId, input, {
      projectId: grant.projectId,
      projectName: grant.projectName,
      sessionId: grant.sessionId,
    });
    reply.code(202);
    return result;
  });

  /**
   * A starting frame from a file already in the project — the hero image, a
   * product shot — so the agent can animate what is on the page rather than
   * inventing a scene that merely resembles it. The bytes are validated and
   * normalised by the same path Studio uploads take.
   */
  app.post<{ Body: unknown }>(
    "/api/internal/videos/references",
    { bodyLimit: maxVideoReferenceBytes * 2 },
    async (request, reply) => {
      const grant = await context(request);
      const { data } = z
        .object({ data: z.string().min(1) })
        .strict()
        .parse(request.body);
      const reference = await videos.addReference(grant.userId, Buffer.from(data, "base64"));
      return reply.code(201).send({ reference });
    },
  );

  app.get<{ Params: { id: string } }>("/api/internal/videos/generations/:id", async (request) => {
    const grant = await context(request);
    return { generation: await videos.get(grant.userId, videoIdSchema.parse(request.params.id)) };
  });

  /** Recent library entries, so the agent can reuse a clip instead of paying
   *  to generate a near-duplicate of one that already exists. */
  app.get("/api/internal/videos/library", async (request) => {
    const grant = await context(request);
    return videos.history(grant.userId);
  });

  /** The finished MP4 and its poster, for writing into a project. */
  app.get<{ Params: { id: string } }>(
    "/api/internal/videos/generations/:id/bytes",
    async (request) => {
      const grant = await context(request);
      const id = videoIdSchema.parse(request.params.id);
      const generation = await videos.get(grant.userId, id);
      if (generation.status !== "succeeded" || !generation.asset)
        throw ZelyqError.badRequest("That video has no saved result.");
      const [mp4, poster] = await Promise.all([
        videos.assets.readVideo(grant.userId, id),
        videos.poster(grant.userId, id).then((file) => videos.frames.readFile(file)),
      ]);
      return {
        mp4: mp4.toString("base64"),
        poster: poster.toString("base64"),
        width: generation.asset.width,
        height: generation.asset.height,
        durationSeconds: generation.asset.durationSeconds,
        sizeBytes: generation.asset.sizeBytes,
        hasAudio: generation.asset.hasAudio,
      };
    },
  );

  /**
   * Extract a frame sequence and hand back every file, so the agent can write
   * `public/cinematic/<slug>/` — the exact shape the scroll-scrub recipe reads.
   * Costs nothing: no provider is involved.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/internal/videos/generations/:id/frames",
    async (request) => {
      const grant = await context(request);
      const id = videoIdSchema.parse(request.params.id);
      const input = frameExportInputSchema.parse(request.body ?? {});
      const set = await videos.extractFrames(grant.userId, id, input);
      const files = await videos.frameFiles(grant.userId, id, set);
      return { frames: set, files };
    },
  );
}
