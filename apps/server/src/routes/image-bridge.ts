import { imageGenerationInputSchema, maxImageReferences, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ImageAssetStore } from "../services/image-assets.js";
import type { ImageBridge } from "../services/image-bridge.js";
import type { ImageGenerationService } from "../services/image-generation.js";

/**
 * The endpoints the build agent calls through the image bridge. Authenticated
 * ONLY by the bridge token (`x-zelyq-image-bridge`), never a user cookie.
 *
 * Every call resolves to one user and generates as that user, so an agent
 * image lands in that person's Image Studio library and is subject to the
 * ownership checks and limits already written for Studio. The image API key
 * never leaves this process.
 */

const submitSchema = imageGenerationInputSchema
  .omit({ idempotencyKey: true })
  .extend({ idempotencyKey: z.string().uuid() });

const idSchema = z.string().regex(/^img_[a-f0-9]{32}$/);

// A generated PNG is up to 20 MiB, and references travel as base64 the same way
// Studio's own submit route accepts them.
const bridgeBodyLimit = maxImageReferences * 11_200_000 + 1024 * 1024;

export function registerImageBridgeRoutes(
  app: FastifyInstance,
  deps: {
    bridge: ImageBridge;
    images: ImageGenerationService;
    assets: ImageAssetStore;
    store: Store;
  },
): void {
  const { bridge, images, assets, store } = deps;

  async function context(request: { headers: Record<string, unknown> }) {
    const token = request.headers["x-zelyq-image-bridge"];
    const grant = typeof token === "string" ? bridge.resolve(token) : null;
    if (!grant) throw new ZelyqError("unauthorized", "Invalid or expired image bridge token.");
    const user = await store.users.findById(grant.userId);
    if (!user) throw new ZelyqError("unauthorized", "The bridge's user no longer exists.");
    return grant;
  }

  app.post<{ Body: unknown }>(
    "/api/internal/images/generations",
    { bodyLimit: bridgeBodyLimit },
    async (request, reply) => {
      const grant = await context(request);
      const input = submitSchema.parse(request.body);
      const generation = await images.submitForAgent(grant.userId, input, {
        projectId: grant.projectId,
        projectName: grant.projectName,
        sessionId: grant.sessionId,
      });
      reply.code(202);
      return { generation };
    },
  );

  app.get<{ Params: { id: string } }>("/api/internal/images/generations/:id", async (request) => {
    const grant = await context(request);
    const id = idSchema.parse(request.params.id);
    return { generation: await images.get(grant.userId, id) };
  });

  /**
   * The finished PNG, plus a small preview. The agent writes `png` into its
   * project and shows `preview` to the model: a model that cannot see what it
   * generated will caption it wrongly, but the full image would spend megabytes
   * of context on pixels it does not need.
   */
  app.get<{ Params: { id: string } }>(
    "/api/internal/images/generations/:id/bytes",
    async (request) => {
      const grant = await context(request);
      const id = idSchema.parse(request.params.id);
      const generation = await images.get(grant.userId, id);
      if (generation.status !== "succeeded" || !generation.asset)
        throw ZelyqError.badRequest("That image has no saved result.");
      const bytes = await assets.read(grant.userId, id);
      return {
        png: bytes.toString("base64"),
        preview: (await images.preview(bytes)).toString("base64"),
        width: generation.asset.width,
        height: generation.asset.height,
        sizeBytes: generation.asset.sizeBytes,
      };
    },
  );

  /** Recent library entries, so the agent can reuse an image instead of
   *  paying to generate a near-duplicate of one that already exists. */
  app.get("/api/internal/images/library", async (request) => {
    const grant = await context(request);
    return images.history(grant.userId);
  });
}
