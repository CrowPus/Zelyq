import { uploadSkillSchema } from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { SkillUploadService } from "../services/skill-uploads.js";

/**
 * Uploading a skill through Settings — see `043` in the council notes.
 * Instance-admin only, the same gate `037` already put on writing a
 * plugin-carrying environment variable, and for the same underlying
 * reason: this is instance-wide, not team-scoped, and only the person who
 * could already reach the filesystem directly should be able to add one
 * this way either.
 */
export function registerSkillRoutes(
  app: FastifyInstance,
  deps: { skillUploads: SkillUploadService; access: AccessControl },
): void {
  app.post("/api/skills", async (request, reply) => {
    deps.access.requireInstanceAdmin(request);
    const input = uploadSkillSchema.parse(request.body);
    const result = await deps.skillUploads.store(input.files);
    reply.status(201);
    return { skill: result };
  });
}
