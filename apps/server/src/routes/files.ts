import {
  maxProjectUploadBytes,
  placeStudioMediaSchema,
  writeFileSchema,
  ZelyqError,
} from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { ImageGenerationService } from "../services/image-generation.js";
import type { ProjectService } from "../services/projects.js";
import type { VideoGenerationService } from "../services/video-generation.js";

export function registerFileRoutes(
  app: FastifyInstance,
  deps: {
    projects: ProjectService;
    runtime: RuntimeDriver;
    access: AccessControl;
    images: Pick<ImageGenerationService, "read">;
    videos: Pick<VideoGenerationService, "get" | "assets">;
  },
): void {
  const { access } = deps;
  app.get<{ Params: { id: string }; Querystring: { path?: string; depth?: string } }>(
    "/api/projects/:id/files",
    async (request) => {
      await access.requireProject(access.requireUser(request), request.params.id, "viewer");
      const entries = await deps.runtime.listFiles(request.params.id, {
        path: request.query.path,
        depth: request.query.depth ? Number.parseInt(request.query.depth, 10) : undefined,
      });
      return { projectId: request.params.id, entries };
    },
  );

  // The wildcard keeps slashes in the path parameter, so `src/components/App.tsx`
  // arrives intact rather than as three segments.
  app.get<{ Params: { id: string; "*": string } }>("/api/projects/:id/files/*", async (request) => {
    await access.requireProject(access.requireUser(request), request.params.id, "viewer");
    return await deps.runtime.readFile(request.params.id, request.params["*"]);
  });

  app.put<{ Params: { id: string; "*": string } }>("/api/projects/:id/files/*", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = writeFileSchema.parse(request.body);
    await deps.runtime.writeFile(
      request.params.id,
      request.params["*"],
      input.content,
      input.encoding,
    );
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "file.written",
      detail: { path: request.params["*"] },
    });
    return { path: request.params["*"], written: true };
  });

  // An uploaded file arrives as the body itself — raw bytes, any type — so it
  // gets its own scope and parser. Sent as base64 inside JSON instead, a file
  // is capped by the API's 16 MiB body limit at about 10 MiB, which turned away
  // every video someone dragged into the code view.
  void app.register(async (upload) => {
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: maxProjectUploadBytes },
      (_request, body, done) => done(null, body),
    );
    upload.put<{ Params: { id: string; "*": string } }>(
      "/api/projects/:id/uploads/*",
      async (request) => {
        const user = access.requireUser(request);
        const { project } = await access.requireProject(user, request.params.id, "editor");
        if (!Buffer.isBuffer(request.body))
          throw ZelyqError.badRequest("Send the file itself as the request body.");
        await deps.runtime.writeFile(
          request.params.id,
          request.params["*"],
          request.body.toString("base64"),
          "base64",
        );
        await access.recordChange(user, {
          teamId: project.teamId,
          projectId: project.id,
          action: "file.written",
          detail: { path: request.params["*"], bytes: request.body.length },
        });
        return { path: request.params["*"], written: true };
      },
    );
  });

  /**
   * Something the person already made in Image or Video Studio, copied into the
   * project on the server. Only from their own library — `read` and `get` check
   * ownership — and only into a project they can edit.
   */
  app.post<{ Params: { id: string } }>("/api/projects/:id/studio-media", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = placeStudioMediaSchema.parse(request.body);
    let bytes: Buffer;
    if (input.kind === "image") {
      bytes = await deps.images.read(user.id, input.id);
    } else {
      const generation = await deps.videos.get(user.id, input.id);
      if (generation.status !== "succeeded" || !generation.asset)
        throw ZelyqError.badRequest("That video has not finished, so there is nothing to copy.");
      bytes = await deps.videos.assets.readVideo(user.id, input.id);
    }
    await deps.runtime.writeFile(request.params.id, input.path, bytes.toString("base64"), "base64");
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "file.written",
      detail: { path: input.path, bytes: bytes.length, from: input.id },
    });
    return { path: input.path, sizeBytes: bytes.length };
  });

  app.delete<{ Params: { id: string; "*": string } }>(
    "/api/projects/:id/files/*",
    async (request, reply) => {
      const user = access.requireUser(request);
      const { project } = await access.requireProject(user, request.params.id, "editor");
      await deps.runtime.deleteFile(request.params.id, request.params["*"]);
      await access.recordChange(user, {
        teamId: project.teamId,
        projectId: project.id,
        action: "file.deleted",
        detail: { path: request.params["*"] },
      });
      reply.status(204);
    },
  );
}
