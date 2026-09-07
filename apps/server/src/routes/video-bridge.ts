import {
  frameExportInputSchema,
  videoGenerationInputSchema,
  videoIdSchema,
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
    const input = videoGenerationInputSchema.parse({
      ...requested,
      provider: provider.id,
      model: provider.model,
    });
    const result = await videos.submitForAgent(grant.userId, input, {
      projectId: grant.projectId,
      projectName: grant.projectName,
      sessionId: grant.sessionId,
    });
    reply.code(202);
    return result;
  });

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
