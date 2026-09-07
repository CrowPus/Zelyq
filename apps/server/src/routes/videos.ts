import multipart from "@fastify/multipart";
import {
  maxVideoReferenceBytes,
  videoGenerationInputSchema,
  videoIdSchema,
  videoReferenceIdSchema,
  ZelyqError,
} from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { ImageGenerationService } from "../services/image-generation.js";
import type { VideoGenerationService } from "../services/video-generation.js";

export function videoRange(header: string | undefined, size: number) {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end };
}
export async function registerVideoRoutes(
  app: FastifyInstance,
  deps: { videos: VideoGenerationService; images: ImageGenerationService; access: AccessControl },
) {
  const { videos, images, access } = deps;
  await app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: maxVideoReferenceBytes, files: 1, fields: 0, parts: 1 },
    });
    scope.addHook("onRequest", async (request, reply) => {
      access.requireUser(request);
      reply.header("cache-control", "private, no-store");
    });
    scope.get("/api/videos/capabilities", () => videos.capabilities());
    scope.post(
      "/api/videos/references",
      {
        bodyLimit: maxVideoReferenceBytes + 65536,
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      },
      async (request, reply) => {
        const owner = access.requireUser(request);
        const file = await request.file();
        if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.mimetype))
          throw ZelyqError.badRequest("Upload a PNG, JPEG, or WebP starting image.");
        const bytes = await file.toBuffer();
        if (file.file.truncated)
          throw ZelyqError.badRequest("Starting images must be 8 MiB or smaller.");
        const reference = await videos.addReference(owner.id, bytes);
        return reply.code(201).send({ reference });
      },
    );
    scope.post("/api/videos/references/from-image", async (request, reply) => {
      const owner = access.requireUser(request);
      const { imageId } = z
        .object({ imageId: z.string().regex(/^img_[a-f0-9]{32}$/) })
        .strict()
        .parse(request.body);
      const reference = await videos.addReference(owner.id, await images.read(owner.id, imageId));
      return reply.code(201).send({ reference });
    });
    scope.get<{ Params: { id: string } }>("/api/videos/references/:id", async (request, reply) => {
      const owner = access.requireUser(request);
      const id = videoReferenceIdSchema.parse(request.params.id);
      await videos.reference(owner.id, id);
      return reply
        .header("x-content-type-options", "nosniff")
        .type("image/png")
        .send(await videos.assets.readReference(owner.id, id));
    });
    scope.delete<{ Params: { id: string } }>(
      "/api/videos/references/:id",
      async (request, reply) => {
        await videos.removeReference(
          access.requireUser(request).id,
          videoReferenceIdSchema.parse(request.params.id),
        );
        return reply.code(204).send();
      },
    );
    scope.post("/api/videos/generations", { bodyLimit: 32768 }, async (request, reply) => {
      const generation = await videos.submit(
        access.requireUser(request).id,
        videoGenerationInputSchema.parse(request.body),
      );
      return reply.code(202).send({ generation });
    });
    scope.get("/api/videos/generations", async (request) => {
      const { cursor } = z.object({ cursor: videoIdSchema.optional() }).parse(request.query);
      return videos.history(access.requireUser(request).id, cursor);
    });
    scope.get<{ Params: { id: string } }>("/api/videos/generations/:id", async (request) => ({
      generation: await videos.get(
        access.requireUser(request).id,
        videoIdSchema.parse(request.params.id),
      ),
    }));
    for (const action of ["cancel", "reconcile"] as const)
      scope.post<{ Params: { id: string } }>(
        `/api/videos/generations/:id/${action}`,
        async (request) => ({
          generation: await videos[action](
            access.requireUser(request).id,
            videoIdSchema.parse(request.params.id),
          ),
        }),
      );
    scope.delete<{ Params: { id: string } }>(
      "/api/videos/generations/:id",
      async (request, reply) => {
        const { acknowledge } = z
          .object({ acknowledge: z.literal("1").optional() })
          .parse(request.query);
        await videos.remove(
          access.requireUser(request).id,
          videoIdSchema.parse(request.params.id),
          acknowledge === "1",
        );
        return reply.code(204).send();
      },
    );
    scope.route<{ Params: { id: string } }>({
      method: ["GET", "HEAD"],
      url: "/api/videos/assets/:id",
      async handler(request, reply) {
        const owner = access.requireUser(request);
        const id = videoIdSchema.parse(request.params.id);
        const generation = await videos.get(owner.id, id);
        if (!generation.asset) throw ZelyqError.notFound("Video asset", id);
        const size = generation.asset.sizeBytes;
        const { download } = z.object({ download: z.literal("1").optional() }).parse(request.query);
        const range =
          request.method === "HEAD" ? undefined : videoRange(request.headers.range, size);
        reply
          .type("video/mp4")
          .header("accept-ranges", "bytes")
          .header("x-content-type-options", "nosniff")
          .header(
            "content-disposition",
            `${download ? "attachment" : "inline"}; filename="zelyq-${id}.mp4"`,
          );
        if (range === null)
          return reply.code(416).header("content-range", `bytes */${size}`).send();
        if (range)
          reply.code(206).header("content-range", `bytes ${range.start}-${range.end}/${size}`);
        reply.header("content-length", range ? range.end - range.start + 1 : size);
        if (request.method === "HEAD") return reply.send();
        return reply.send(videos.assets.stream(owner.id, id, range));
      },
    });
  });
}
