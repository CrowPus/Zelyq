import {
  imageGenerationInputSchema,
  maxImageReferenceBytes,
  maxImageReferences,
} from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AccessControl } from "../services/access.js";
import type { ImageGenerationService } from "../services/image-generation.js";

const idSchema = z.string().regex(/^img_[a-f0-9]{32}$/);

// References travel as base64 inside the JSON body, which costs four bytes per
// three. Derive the ceiling from the same constants the schema validates
// against: a hand-picked number here silently rejects uploads the UI offers,
// which is how a 64 KB prompt-only limit survived the arrival of 8 MiB
// references and surfaced as "request body too large".
const imageSubmitBodyLimit =
  maxImageReferences * (Math.ceil((maxImageReferenceBytes * 4) / 3) + 8) + 1024 * 1024;

export function registerImageRoutes(
  app: FastifyInstance,
  deps: { images: ImageGenerationService; access: AccessControl },
) {
  const { images, access } = deps;
  app.get("/api/images/capabilities", async (request, reply) => {
    access.requireUser(request);
    reply.header("cache-control", "private, no-store");
    return images.capabilities();
  });
  app.post(
    "/api/images/generations",
    { bodyLimit: imageSubmitBodyLimit },
    async (request, reply) => {
      const user = access.requireUser(request);
      const input = imageGenerationInputSchema.parse(request.body);
      const generation = await images.submit(user.id, input);
      reply.code(202).header("cache-control", "private, no-store");
      return { generation };
    },
  );
  app.get("/api/images/generations", async (request, reply) => {
    const user = access.requireUser(request);
    const { cursor } = z.object({ cursor: idSchema.optional() }).parse(request.query);
    reply.header("cache-control", "private, no-store");
    return images.history(user.id, cursor);
  });
  app.get<{ Params: { id: string } }>("/api/images/generations/:id", async (request, reply) => {
    const user = access.requireUser(request);
    reply.header("cache-control", "private, no-store");
    return { generation: await images.get(user.id, idSchema.parse(request.params.id)) };
  });
  app.get<{ Params: { id: string } }>("/api/images/assets/:id", async (request, reply) => {
    const user = access.requireUser(request);
    const id = idSchema.parse(request.params.id);
    const { download } = z.object({ download: z.literal("1").optional() }).parse(request.query);
    const bytes = await images.read(user.id, id);
    reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header(
        "content-disposition",
        `${download ? "attachment" : "inline"}; filename="zelyq-${id}.png"`,
      )
      .type("image/png");
    return reply.send(bytes);
  });
  app.delete<{ Params: { id: string } }>("/api/images/generations/:id", async (request, reply) => {
    const user = access.requireUser(request);
    await images.remove(user.id, idSchema.parse(request.params.id));
    return reply.code(204).send();
  });
}
