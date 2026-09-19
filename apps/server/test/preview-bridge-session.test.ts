import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { WebSocket } from "ws";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * The gateway mints the preview capability on every prompt, but the agent
 * keeps the session — and the token — it was created with. Found in review:
 * minting replaced the token, so `start_preview` failed on every prompt after
 * a session's first with "Preview could not start".
 */

type FakeSession = { state: Record<string, unknown>; previewBridge?: { token: string } };

const sessions = new Map<string, FakeSession>();
const probeResults: number[] = [];
let serverBase = "";
function fakeAgent() {
  return http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const stateMatch = req.url?.match(/^\/sessions\/([^/]+)\/state$/);
    if (req.method === "GET" && stateMatch) {
      const s = sessions.get(stateMatch[1]!);
      if (!s) return send(404, { error: { message: "not found" } });
      return send(200, { ...s.state, busy: false });
    }
    if (req.method === "GET" && req.url === "/providers") {
      send(200, {
        default: "google",
        providers: [
          {
            id: "google",
            label: "Gemini",
            defaultModel: "gemini-3.7-flash",
            apiKeyEnv: ["GEMINI_API_KEY"],
            docsUrl: "https://aistudio.google.com/apikey",
            configured: true,
          },
        ],
      });
      return;
    }
    if (req.method === "POST" && req.url === "/sessions") {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        const input = JSON.parse(body);
        const state = {
          sessionId: input.sessionId,
          projectId: input.projectId,
          provider: input.provider ?? "google",
          model: input.model ?? "gemini-3.7-flash",
          effort: input.effort ?? "high",
          engineerMode: input.engineerMode ?? false,
          architectMode: input.architectMode ?? false,
          autoMode: input.autoMode ?? false,
          authMode: input.authMode ?? "api_key",
          turns: 0,
          tokensIn: 0,
          tokensOut: 0,
        };
        sessions.set(input.sessionId, { state, previewBridge: input.previewBridge });
        send(201, { ...state, busy: false });
      });
      return;
    }
    const promptMatch = req.url?.match(/^\/sessions\/([^/]+)\/prompt$/);
    if (req.method === "POST" && promptMatch) {
      req.on("data", () => undefined);
      req.on("end", async () => {
        const s = sessions.get(promptMatch[1]!);
        // What the agent's start_preview tool does, minus the preview itself:
        // an invalid body fails AFTER the capability check (400), a stale token fails it (401).
        const r = await fetch(`${serverBase}/api/internal/project-preview/start`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-zelyq-preview-bridge": s?.previewBridge?.token ?? "none",
          },
          body: JSON.stringify({ restart: "not-a-boolean" }),
        });
        probeResults.push(r.status);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        emit({ type: "turn.start", sessionId: "x", messageId: "m", at: new Date().toISOString() });
        emit({ type: "text.delta", sessionId: "x", messageId: "m", text: `probe ${r.status}` });
        emit({ type: "turn.end", sessionId: "x", messageId: "m", stopReason: "end_turn" });
        res.end();
      });
      return;
    }
    send(404, { error: { message: "not found" } });
  });
}

const tmp = path.join(os.tmpdir(), `zelyq-preview-bridge-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
let agent: http.Server;
let server: ZelyqServer;
let cookie: string;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  process.env.ZELYQ_PROVIDER = "google";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  agent = fakeAgent();
  await new Promise<void>((resolve) => agent.listen(0, "127.0.0.1", resolve));
  const a = agent.address();
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "auto.db")}`,
    agentUrl: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`,
    provider: "google",
    model: "gemini-3.7-flash",
    effort: "high",
    allowRegistration: true,
    sessionTtlDays: 30,
    templatesDir: path.join(repoRoot, "templates"),
    webDir: null,
    secretKey: undefined,
    secretKeyFile: path.join(tmp, "secret.key"),
    attachmentsDir: path.join(tmp, "attachments"),
    uploadedSkillsDir: path.join(tmp, "skills"),
    codexCredentialsPath: path.join(tmp, "codex-auth.json"),
    claudeCredentialsPath: path.join(tmp, "claude-credentials.json"),
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4946, 4949],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  {
    const ad = server.app.server.address();
    serverBase = `http://127.0.0.1:${typeof ad === "object" && ad ? ad.port : 0}`;
  }
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "auto@example.com", name: "Tester", password: "correct-horse-battery" },
  });
  const session = registered.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session);
  cookie = `zelyq_session=${session.value}`;
});

after(async () => {
  await server?.close();
  await new Promise<void>((resolve) => agent.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env.ZELYQ_PROVIDER;
  delete process.env.GEMINI_API_KEY;
});

test("the preview capability survives a second prompt on the same session", async () => {
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Bridge" },
    })
  ).json().project;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });
  let ends = 0;
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") ws.send(JSON.stringify({ type: "prompt", message: "first" }));
      if (msg.type === "turn.end") {
        ends += 1;
        if (ends === 1)
          setTimeout(() => ws.send(JSON.stringify({ type: "prompt", message: "second" })), 300);
        else {
          ws.close();
          resolve();
        }
      }
    });
  });
  // 400: the token was accepted and only the deliberately bad body refused.
  // 401 would be the token itself refused.
  assert.deepEqual(probeResults, [400, 400]);
});

test("the Backend panel is told why a database host is refused", async () => {
  // Found in review: these routes were registered before the server's error
  // handler and answered in Fastify's own shape, which the web client cannot
  // read — the panel said "Request failed with 400" instead of the reason.
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Refused host" },
    })
  ).json().project;
  const response = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${project.id}/backend`,
    headers: { cookie },
    payload: {
      engine: "postgresql",
      ownership: "external",
      databaseUrl: "postgresql://u:p@127.0.0.1/app",
      tables: [],
      readOnly: true,
      auth: "none",
      secrets: {},
    },
  });
  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.error?.code, "bad_request");
  assert.match(String(body.error?.message), /not permitted/);
});
