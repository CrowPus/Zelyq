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
 * Browser frames have to reach the browser and never be written down.
 *
 * They ride the ordinary event stream, so the guarantee is structural: the
 * gateway broadcasts every event and only *stores* the ones its switch names.
 * That is easy to break by adding a case, which is what this pins.
 */

const FRAME = "/9j/4AAQSkZJRmZmZg==";

function fakeAgent() {
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url?.match(/^\/sessions\/.+\/state$/)) return send(404, {});
    if (req.method === "GET" && req.url === "/providers") {
      return send(200, {
        default: "google",
        providers: [
          {
            id: "google",
            label: "Gemini",
            defaultModel: "gemini-3.7-flash",
            apiKeyEnv: ["GEMINI_API_KEY"],
            docsUrl: "https://x",
            configured: true,
          },
        ],
      });
    }
    if (req.method === "POST" && req.url === "/sessions") {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        const input = JSON.parse(body);
        send(201, {
          sessionId: input.sessionId,
          projectId: input.projectId,
          provider: "google",
          model: "gemini-3.7-flash",
          effort: "high",
          engineerMode: false,
          busy: false,
          turns: 0,
          tokensIn: 0,
          tokensOut: 0,
        });
      });
      return;
    }
    if (req.method === "POST" && req.url?.match(/^\/sessions\/.+\/prompt$/)) {
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        emit({ type: "turn.start", sessionId: "x", messageId: "m1", at: new Date().toISOString() });
        emit({ type: "browser.open", sessionId: "x", callId: "c1", label: "example.com" });
        emit({
          type: "browser.frame",
          sessionId: "x",
          callId: "c1",
          data: FRAME,
          width: 800,
          height: 600,
        });
        emit({ type: "browser.close", sessionId: "x", callId: "c1" });
        emit({ type: "text.delta", sessionId: "x", messageId: "m1", text: "done" });
        emit({ type: "turn.end", sessionId: "x", messageId: "m1", stopReason: "end_turn" });
        res.end();
      });
      return;
    }
    send(404, {});
  });
  return { server };
}

const tmp = path.join(os.tmpdir(), `zelyq-livebrowser-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
let agent: ReturnType<typeof fakeAgent>;
let server: ZelyqServer;
let cookie: string;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  process.env.ZELYQ_PROVIDER = "google";
  process.env.GEMINI_API_KEY = "test-key";
  agent = fakeAgent();
  await new Promise<void>((r) => agent.server.listen(0, "127.0.0.1", r));
  const a = agent.server.address();
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "lb.db")}`,
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
    codexCredentialsPath: path.join(tmp, "codex.json"),
    claudeCredentialsPath: path.join(tmp, "claude.json"),
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4950, 4955],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const reg = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "lb@example.com", name: "T", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${reg.cookies.find((c) => c.name === "zelyq_session")?.value}`;
});

after(async () => {
  await server?.close();
  await new Promise<void>((r) => agent.server.close(() => r()));
  // Retried: the gateway's snapshot is best-effort and detached — it runs
  // `git add`/`git commit` in a `finally` *after* `turn.end` has already been
  // sent, so the test can reach this line while git is still writing
  // `.git/objects` and the removal fails with ENOTEMPTY. Seen in CI, not
  // reproducible on demand.
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  delete process.env.ZELYQ_PROVIDER;
  delete process.env.GEMINI_API_KEY;
});

test("frames reach the browser and are never written to the turn", async () => {
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Live browser" },
    })
  ).json().project;

  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  const seen: string[] = [];
  let frame: { data: string; width: number; height: number } | null = null;
  let sessionId = "";

  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      seen.push(msg.type);
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        ws.send(JSON.stringify({ type: "prompt", message: "clone example.com" }));
      }
      if (msg.type === "browser.frame") frame = msg;
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  // Reached the browser, intact.
  assert.ok(seen.includes("browser.open"), "browser.open must be relayed");
  assert.ok(seen.includes("browser.close"), "browser.close must be relayed");
  assert.ok(frame, "a frame must reach the browser");
  assert.equal(frame!.data, FRAME, "the frame arrives byte-identical");
  assert.equal(frame!.width, 800);

  // And nowhere near the database.
  const messages = await server.store.messages.listForSession(sessionId);
  const serialised = JSON.stringify(messages);
  assert.ok(!serialised.includes(FRAME), "no frame may be persisted on a message");
  assert.ok(!serialised.includes("browser.frame"), "no frame event may be persisted");

  const assistant = messages.find((m) => m.role === "assistant");
  assert.ok(assistant, "the turn was still recorded normally");
  assert.equal(assistant.content, "done", "and its text is unaffected");
});
