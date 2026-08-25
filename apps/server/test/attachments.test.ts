import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { AttachmentService } from "../src/services/attachments.js";

const tmp = path.join(os.tmpdir(), `zelyq-attachments-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

// A 1x1 transparent PNG, base64-encoded — small, real image bytes rather than
// an arbitrary string, so a test that checks the mimeType/bytes roundtrip is
// checking something a browser would actually produce.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("AttachmentService: store then get round-trips the bytes and metadata", async () => {
  const dir = path.join(tmp, "service-roundtrip");
  const service = new AttachmentService(dir);

  const ref = await service.store("prj_1", {
    filename: "pixel.png",
    mimeType: "image/png",
    data: PNG_BASE64,
  });

  assert.equal(ref.filename, "pixel.png");
  assert.equal(ref.mimeType, "image/png");
  assert.equal(ref.sizeBytes, Buffer.from(PNG_BASE64, "base64").length);
  assert.ok(ref.id.startsWith("atc_"), "attachment ids use the atc_ prefix");

  const found = await service.get("prj_1", ref.id);
  assert.ok(found);
  assert.deepEqual(found.ref, ref);
  assert.ok(found.data.equals(Buffer.from(PNG_BASE64, "base64")));
});

test("AttachmentService: get returns null for an unknown id", async () => {
  const service = new AttachmentService(path.join(tmp, "service-missing"));
  assert.equal(await service.get("prj_1", "atc_doesnotexist"), null);
});

test("AttachmentService: get returns null when the id belongs to a different project", async () => {
  const service = new AttachmentService(path.join(tmp, "service-isolation"));
  const ref = await service.store("prj_1", {
    filename: "pixel.png",
    mimeType: "image/png",
    data: PNG_BASE64,
  });
  assert.equal(
    await service.get("prj_2", ref.id),
    null,
    "an attachment must not be readable through a different project's id",
  );
});

test("AttachmentService: an oversized attachment is rejected before it touches disk", async () => {
  const dir = path.join(tmp, "service-oversized");
  const service = new AttachmentService(dir);
  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 1).toString("base64");

  await assert.rejects(
    () => service.store("prj_1", { filename: "big.png", mimeType: "image/png", data: big }),
    /8MB/,
  );

  await assert.rejects(fs.readdir(path.join(dir, "prj_1")));
});

test("AttachmentService: an empty attachment is rejected", async () => {
  const service = new AttachmentService(path.join(tmp, "service-empty"));
  await assert.rejects(
    () => service.store("prj_1", { filename: "empty.png", mimeType: "image/png", data: "" }),
    /empty/,
  );
});

test("AttachmentService: removeProject deletes everything stored for that project only", async () => {
  const dir = path.join(tmp, "service-remove");
  const service = new AttachmentService(dir);
  const keep = await service.store("prj_keep", {
    filename: "pixel.png",
    mimeType: "image/png",
    data: PNG_BASE64,
  });
  const gone = await service.store("prj_gone", {
    filename: "pixel.png",
    mimeType: "image/png",
    data: PNG_BASE64,
  });

  await service.removeProject("prj_gone");

  assert.equal(await service.get("prj_gone", gone.id), null);
  assert.ok(await service.get("prj_keep", keep.id), "an unrelated project's attachment survives");
});

// --- Route-level tests, against a real server ---------------------------

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "attachments.db")}`,
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
  attachmentsDir: path.join(tmp, "route-attachments"),
  uploadedSkillsDir: path.join(tmp, "route-skills"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4980, 4985],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, `register ${email}: ${response.body}`);
  const cookie = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(cookie, "no session cookie was set");
  return `zelyq_session=${cookie.value}`;
}

const as = (cookie: string) => ({ cookie });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("route: an editor can upload an attachment and read it back", async () => {
  const owner = await register("route-owner@example.com", "Owner");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Attachments route test" },
    })
  ).json().project;

  const upload = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/attachments`,
    headers: as(owner),
    payload: { filename: "pixel.png", mimeType: "image/png", data: PNG_BASE64 },
  });
  assert.equal(upload.statusCode, 201, upload.body);
  const { attachment } = upload.json();
  assert.equal(attachment.filename, "pixel.png");
  assert.equal(attachment.mimeType, "image/png");

  const get = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/attachments/${attachment.id}`,
    headers: as(owner),
  });
  assert.equal(get.statusCode, 200);
  assert.equal(get.headers["content-type"], "image/png");
  assert.ok(get.rawPayload.equals(Buffer.from(PNG_BASE64, "base64")));
});

test("route: an unknown attachment id 404s instead of leaking a stack trace", async () => {
  const owner = await register("route-404@example.com", "Owner");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "404 test" },
    })
  ).json().project;

  const get = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/attachments/atc_doesnotexist`,
    headers: as(owner),
  });
  assert.equal(get.statusCode, 404);
  assert.equal(get.json().error.code, "not_found");
});

test("route: a viewer can read an attachment but cannot upload one", async () => {
  const owner = await register("route-viewer-owner@example.com", "Owner");
  const viewer = await register("route-viewer@example.com", "Viewer");

  const teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: as(owner) })
  ).json().teams[0].id;
  await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: as(owner),
    payload: { email: "route-viewer@example.com", role: "viewer" },
  });

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Viewer role test", teamId },
    })
  ).json().project;

  const uploadAsViewer = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/attachments`,
    headers: as(viewer),
    payload: { filename: "pixel.png", mimeType: "image/png", data: PNG_BASE64 },
  });
  assert.equal(uploadAsViewer.statusCode, 403, "a viewer cannot upload");

  const uploadAsOwner = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/attachments`,
    headers: as(owner),
    payload: { filename: "pixel.png", mimeType: "image/png", data: PNG_BASE64 },
  });
  const { attachment } = uploadAsOwner.json();

  const readAsViewer = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/attachments/${attachment.id}`,
    headers: as(viewer),
  });
  assert.equal(readAsViewer.statusCode, 200, "a viewer can still read one back");
});

test("route: a non-member cannot upload or read, and gets a 404, not a 403", async () => {
  const owner = await register("route-owner-2@example.com", "Owner");
  const stranger = await register("route-stranger@example.com", "Stranger");

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Non-member test" },
    })
  ).json().project;

  const upload = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/attachments`,
    headers: as(stranger),
    payload: { filename: "pixel.png", mimeType: "image/png", data: PNG_BASE64 },
  });
  assert.equal(upload.statusCode, 404, "existence of the project must not leak to a non-member");
});

test("route: an oversized upload is rejected with 400", async () => {
  const owner = await register("route-oversized@example.com", "Owner");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: as(owner),
      payload: { name: "Oversized route test" },
    })
  ).json().project;

  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 1).toString("base64");
  const upload = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/attachments`,
    headers: as(owner),
    payload: { filename: "big.png", mimeType: "image/png", data: big },
  });
  assert.equal(upload.statusCode, 400);
});
