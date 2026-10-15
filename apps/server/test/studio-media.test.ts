import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import Fastify from "fastify";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { registerFileRoutes } from "../src/routes/files.js";
import type { AccessControl } from "../src/services/access.js";
import { ImageAssetStore } from "../src/services/image-assets.js";
import type { ProjectService } from "../src/services/projects.js";
import type { VideoGenerationService } from "../src/services/video-generation.js";
import { imageFixture } from "./helpers/image-fixture.js";

/**
 * "Add from Studio": an image or a clip someone already made, copied into a
 * project on the server — the way round the upload limit that stopped a video
 * being dragged into the code view.
 */
const tmp = path.join(os.tmpdir(), `zelyq-studio-media-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "studio-media.db")}`,
  agentUrl: "http://127.0.0.1:59999",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  imageAssetsDir: path.join(tmp, "images"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4966, 4969],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let owner: { cookie: string; id: string };
let other: { cookie: string; id: string };
let projectId: string;
let imageId: string;
const png = imageFixture();

async function register(email: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: "Studio", password: "correct-horse-battery" },
  });
  return {
    cookie: `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`,
    id: response.json().user.id as string,
  };
}

/** A finished Studio image, the way a real generation leaves one. */
async function finishedImage(ownerId: string): Promise<string> {
  const id = newId("imageGeneration");
  await server.store.images.create(
    id,
    ownerId,
    {
      prompt: "A quiet harbour at dawn",
      size: "1024x1024",
      quality: "medium",
      idempotencyKey: randomUUID(),
    },
    "gpt-image-2",
  );
  await server.store.images.claim(id, 0, new Date(Date.now() + 60_000).toISOString());
  await server.store.images.saving(id, {
    width: 1024,
    height: 1024,
    sizeBytes: png.length,
    providerRequestId: null,
    usage: null,
  });
  await new ImageAssetStore(config.imageAssetsDir!).save(ownerId, id, png);
  await server.store.images.finish(id, "succeeded");
  return id;
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  owner = await register("owner@example.com");
  other = await register("other@example.com");
  const project = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie: owner.cookie },
    payload: { name: "Studio Media", template: "vite-react" },
  });
  assert.equal(project.statusCode, 201, project.body);
  projectId = project.json().project.id;
  imageId = await finishedImage(owner.id);
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const place = (cookie: string, body: Record<string, unknown>) =>
  server.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/studio-media`,
    headers: { cookie },
    payload: body,
  });

test("a Studio image is copied into the project, byte for byte", async () => {
  const response = await place(owner.cookie, {
    kind: "image",
    id: imageId,
    path: "public/harbour.png",
  });
  assert.equal(response.statusCode, 200, response.body);
  const onDisk = await fs.readFile(
    path.join(config.runtime.workspaceDir!, projectId, "public", "harbour.png"),
  );
  assert.ok(onDisk.equals(png));
});

test("only from your own library: someone else's image is not found", async () => {
  // `other` is not a member of this project's team either, so make it theirs.
  const theirs = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie: other.cookie },
    payload: { name: "Theirs", template: "vite-react" },
  });
  const response = await server.app.inject({
    method: "POST",
    url: `/api/projects/${theirs.json().project.id}/studio-media`,
    headers: { cookie: other.cookie },
    payload: { kind: "image", id: imageId, path: "public/stolen.png" },
  });
  assert.equal(response.statusCode, 404, response.body);
});

test("the file keeps its own extension, and the path stays inside the project", async () => {
  const renamed = await place(owner.cookie, { kind: "image", id: imageId, path: "public/a.jpg" });
  assert.equal(renamed.statusCode, 400, renamed.body);
  const escaped = await place(owner.cookie, {
    kind: "image",
    id: imageId,
    path: "../../escaped.png",
  });
  assert.equal(escaped.statusCode, 400, escaped.body);
});

test("a finished clip is copied; one still generating is refused", async () => {
  const workspaceDir = path.join(tmp, "video-workspace");
  const runtime = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4960, 4962],
    previewHost: "127.0.0.1",
  });
  await runtime.ensureProject("prj_video");
  const mp4 = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
  const done = `vid_${"a".repeat(32)}`;
  const running = `vid_${"b".repeat(32)}`;
  const videos = {
    get: async (_owner: string, id: string) =>
      ({
        status: id === done ? "succeeded" : "generating",
        asset: id === done ? { sizeBytes: mp4.length } : null,
      }) as unknown as Awaited<ReturnType<VideoGenerationService["get"]>>,
    assets: { readVideo: async () => mp4 } as unknown as VideoGenerationService["assets"],
  };
  const access = {
    requireUser: () => ({ id: "usr_test" }),
    requireProject: async () => ({ project: { id: "prj_video", teamId: "tem_test" } }),
    recordChange: async () => undefined,
  } as unknown as AccessControl;
  const app = Fastify();
  registerFileRoutes(app, {
    projects: {} as ProjectService,
    runtime,
    access,
    images: { read: async () => Buffer.alloc(0) },
    videos,
  });
  try {
    const placed = await app.inject({
      method: "POST",
      url: "/api/projects/prj_video/studio-media",
      payload: { kind: "video", id: done, path: "public/media/hero.mp4" },
    });
    assert.equal(placed.statusCode, 200, placed.body);
    const onDisk = await fs.readFile(path.join(workspaceDir, "prj_video", "public/media/hero.mp4"));
    assert.ok(onDisk.equals(mp4));

    const unfinished = await app.inject({
      method: "POST",
      url: "/api/projects/prj_video/studio-media",
      payload: { kind: "video", id: running, path: "public/media/later.mp4" },
    });
    assert.notEqual(unfinished.statusCode, 200);
    assert.match(unfinished.body, /has not finished/);
  } finally {
    await app.close();
    await runtime.dispose();
  }
});
