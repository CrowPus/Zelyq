import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-voice-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const originalFetch = globalThis.fetch;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "voice.db")}`,
  agentUrl: "http://127.0.0.1:59999",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4960, 4965],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let ownerCookie: string;
let memberCookie: string;
let projectId: string;
let capturedForm: FormData | undefined;

async function register(email: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return `zelyq_session=${response.cookies.find((cookie) => cookie.name === "zelyq_session")!.value}`;
}

before(async () => {
  process.env.OPENAI_API_KEY = "sk-test-voice-key";
  globalThis.fetch = (async (_input, init) => {
    capturedForm = init?.body as FormData;
    return new Response(JSON.stringify({ text: "voice transcript" }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  ownerCookie = await register("voice-owner@example.com");
  memberCookie = await register("voice-member@example.com");
  const project = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie: ownerCookie },
    payload: { name: "Voice route test" },
  });
  assert.equal(project.statusCode, 201, project.body);
  projectId = project.json().project.id;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
  globalThis.fetch = originalFetch;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

test("a project editor can transcribe a browser recording with configured voice settings", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/voice/transcriptions`,
    headers: { cookie: ownerCookie },
    payload: {
      mimeType: "audio/webm;codecs=opus",
      data: Buffer.from("browser-recording").toString("base64"),
    },
  });

  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { text: "voice transcript" });
  assert.equal(capturedForm?.get("model"), "whisper-1");
  const file = capturedForm?.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.type, "audio/webm");
});

test("a user without project access cannot spend the configured voice API key", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/voice/transcriptions`,
    headers: { cookie: memberCookie },
    payload: { mimeType: "audio/webm", data: Buffer.from("audio").toString("base64") },
  });
  assert.equal(response.statusCode, 404, "project existence remains hidden from non-members");
});

test("unsupported audio is rejected before calling OpenAI", async () => {
  capturedForm = undefined;
  const response = await server.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/voice/transcriptions`,
    headers: { cookie: ownerCookie },
    payload: { mimeType: "text/plain", data: Buffer.from("not audio").toString("base64") },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(capturedForm, undefined);
});
