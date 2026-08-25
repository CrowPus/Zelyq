import { promptAttachmentSchema } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { AttachmentService } from "../services/attachments.js";

/**
 * A file uploaded to be attached to a prompt — see `037` in the council
 * notes. Editor role to upload (the same requirement sending a prompt
 * already has); viewer role to read one back, so a shared team member can
 * still see what was attached in a transcript they can only read.
 */
export function registerAttachmentRoutes(
  app: FastifyInstance,
  deps: { attachments: AttachmentService; access: AccessControl },
): void {
  const { access, attachments } = deps;

  app.post<{ Params: { id: string } }>("/api/projects/:id/attachments", async (request, reply) => {
    const user = access.requireUser(request);
    await access.requireProject(user, request.params.id, "editor");
    const input = promptAttachmentSchema.parse(request.body);
    const ref = await attachments.store(request.params.id, input);
    reply.status(201);
    return { attachment: ref };
  });

  app.get<{ Params: { id: string; attachmentId: string } }>(
    "/api/projects/:id/attachments/:attachmentId",
    async (request, reply) => {
      const user = access.requireUser(request);
      await access.requireProject(user, request.params.id, "viewer");
      const found = await attachments.get(request.params.id, request.params.attachmentId);
      if (!found) {
        reply.status(404);
        return { error: { code: "not_found", message: "That attachment was not found." } };
      }
      reply.header("content-type", found.ref.mimeType);
      reply.header(
        "content-disposition",
        `inline; filename="${encodeURIComponent(found.ref.filename)}"`,
      );
      return found.data;
    },
  );
}
