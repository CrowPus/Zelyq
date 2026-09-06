import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "@zelyq/db";
import sharp from "sharp";
import { buildServer } from "../../src/app.js";
import { imageFixture } from "../helpers/image-fixture.js";

// A standalone browser-test server. Never loads .env, starts an agent,
// contacts an image provider, or opens the user's database.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-image-e2e-"));
process.env.ZELYQ_IMAGE_API_KEY = "sk-browser-test-only";
process.env.ZELYQ_IMAGE_MODEL = "gpt-image-2";
delete process.env.ZELYQ_IMAGE_GENERATION_PROVIDER;
delete process.env.ZELYQ_IMAGE_GOOGLE_API_KEY;
delete process.env.ZELYQ_IMAGE_XAI_API_KEY;
delete process.env.ZELYQ_IMAGE_GOOGLE_MODEL;
delete process.env.ZELYQ_IMAGE_XAI_MODEL;
process.env.ZELYQ_ALLOW_REGISTRATION = "true";
globalThis.fetch = (async (url, init) => {
  const address = String(url);
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (address.startsWith("https://generativelanguage.googleapis.com/v1/models/")) {
    const body = JSON.parse(String(init?.body));
    if (new Headers(init?.headers).get("x-goog-api-key") !== "google-browser-test-key")
      throw new Error("Wrong Google credential");
    if (
      body.generationConfig.responseFormat.image.aspectRatio !== "ASPECT_RATIO_ONE_BY_ONE" &&
      body.generationConfig.responseFormat.image.aspectRatio !== "ASPECT_RATIO_THREE_BY_TWO" &&
      body.generationConfig.responseFormat.image.aspectRatio !== "ASPECT_RATIO_TWO_BY_THREE"
    )
      throw new Error("Wrong Google aspect ratio enum");
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: imageFixture(1248, 832).toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  }
  if (address === "https://api.x.ai/v1/images/generations") {
    if (new Headers(init?.headers).get("authorization") !== "Bearer xai-browser-test-key")
      throw new Error("Wrong xAI credential");
    const jpeg = await sharp(imageFixture()).jpeg().toBuffer();
    return new Response(JSON.stringify({ data: [{ b64_json: jpeg.toString("base64") }] }));
  }
  if (address === "https://api.openai.com/v1/images/edits") {
    if (!(init?.body instanceof FormData)) throw new Error("OpenAI edit expected FormData");
    if (init.body.getAll("image[]").length !== 1) throw new Error("Missing OpenAI reference");
    const [width, height] = String(init.body.get("size")).split("x").map(Number);
    return new Response(
      JSON.stringify({ data: [{ b64_json: imageFixture(width, height).toString("base64") }] }),
    );
  }
  if (address === "https://api.openai.com/v1/images/generations") {
    const body = JSON.parse(String(init?.body));
    const [width, height] = body.size.split("x").map(Number);
    return new Response(
      JSON.stringify({ data: [{ b64_json: imageFixture(width, height).toString("base64") }] }),
    );
  }
  throw new Error("Unexpected external request in browser test");
}) as typeof fetch;
const databaseUrl = `file:${root}/test.db`;
await runMigrations(databaseUrl);
const server = await buildServer({
  host: "127.0.0.1",
  port: 8094,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: [],
  databaseUrl,
  agentUrl: "http://127.0.0.1:59999",
  serverInternalUrl: "http://127.0.0.1:8094",
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
    previewPortRange: [4970, 4975],
    previewHost: "127.0.0.1",
  },
});
await server.app.listen({ host: "127.0.0.1", port: 8094 });
async function close() {
  await server.close();
  await fs.rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
