import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "@zelyq/db";
import { buildServer } from "../../src/app.js";
import { imageFixture } from "../helpers/image-fixture.js";
import { videoProviderFixture } from "../helpers/video-provider-fixture.js";

// Isolated application, no .env or live providers, real playable synthetic MP4.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-video-e2e-"));
for (const key of Object.keys(process.env))
  if (key.startsWith("ZELYQ_VIDEO_")) delete process.env[key];
process.env.ZELYQ_ALLOW_REGISTRATION = "true";
process.env.ZELYQ_IMAGE_API_KEY = "sk-browser-test-key";
process.env.ZELYQ_IMAGE_MODEL = "gpt-image-2";
const videoFetch = videoProviderFixture().fetch;
globalThis.fetch = ((url, init) =>
  String(url) === "https://api.openai.com/v1/images/generations"
    ? Promise.resolve(Response.json({ data: [{ b64_json: imageFixture().toString("base64") }] }))
    : videoFetch(url, init)) as typeof fetch;
const databaseUrl = `file:${root}/test.db`;
await runMigrations(databaseUrl);
const server = await buildServer({
  host: "127.0.0.1",
  port: 8095,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: [],
  databaseUrl,
  agentUrl: "http://127.0.0.1:59999",
  serverInternalUrl: "http://127.0.0.1:8095",
  provider: "anthropic",
  model: "",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  figmaEnabled: false,
  templatesDir: path.resolve("templates"),
  webDir: path.resolve("apps/web/dist"),
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: `${root}/secret.key`,
  attachmentsDir: `${root}/attachments`,
  uploadedSkillsDir: `${root}/skills`,
  runtime: {
    kind: "local",
    workspaceDir: `${root}/workspace`,
    execTimeoutMs: 30000,
    previewPortRange: [4980, 4985],
    previewHost: "127.0.0.1",
  },
});
await server.app.listen({ host: "127.0.0.1", port: 8095 });
async function close() {
  await server.close();
  await fs.rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
