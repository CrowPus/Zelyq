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
 * A running turn belongs to the project, not to the browser tab. Found in
 * review: closing or reloading the tab deleted the project's room while its
 * turn still ran, so the reloaded tab saw no sign of the build, and a second
 * prompt was accepted and started beside the first.
 */

/** Resolved by the test to let the fake agent finish its turn. */
let release: () => void = () => undefined;
let prompts = 0;

function fakeAgent() {
  return http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url?.match(/^\/sessions\/.+\/state$/)) {
      send(404, { error: { message: "not found" } });
      return;
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
        send(201, {
          sessionId: input.sessionId,
          projectId: input.projectId,
          provider: "google",
          model: "gemini-3.7-flash",
          effort: "high",
          engineerMode: true,
          busy: false,
          turns: 0,
          tokensIn: 0,
          tokensOut: 0,
        });
      });
      return;
    }
    if (req.method === "POST" && req.url?.match(/^\/sessions\/.+\/prompt$/)) {
      prompts += 1;
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        const messageId = "agent_msg_1";
        emit({ type: "turn.start", sessionId: "x", messageId, at: new Date().toISOString() });
        emit({ type: "text.delta", sessionId: "x", messageId, text: "First half. " });
        new Promise<void>((resolve) => {
          release = resolve;
        }).then(() => {
          emit({ type: "text.delta", sessionId: "x", messageId, text: "Second half." });
          emit({ type: "turn.end", sessionId: "x", messageId, stopReason: "end_turn" });
          res.end();
        });
      });
      return;
    }
    send(404, { error: { message: "not found" } });
  });
}

const tmp = path.join(os.tmpdir(), `zelyq-reconnect-gw-${Date.now()}`);
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
    databaseUrl: `file:${path.join(tmp, "reconnect.db")}`,
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
      previewPortRange: [4956, 4959],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "reconnect@example.com", name: "Tester", password: "correct-horse-battery" },
  });
  const session = registered.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session);
  cookie = `zelyq_session=${session.value}`;
});

after(async () => {
  await server?.close();
  await new Promise<void>((resolve) => agent.close(() => resolve()));
  // The turn's own commit runs `git add`/`git commit` after `turn.end` is sent,
  // so git can still be writing `.git/objects` here — removal then fails with
  // ENOTEMPTY (seen in CI on #204). Same fix as gateway.test.ts.
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  delete process.env.ZELYQ_PROVIDER;
  delete process.env.GEMINI_API_KEY;
});

function open(projectId: string): WebSocket {
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${projectId}`, { headers: { cookie } });
}

test("a tab that reconnects mid-turn is caught up, and a second prompt waits its turn", async () => {
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Reconnect" },
    })
  ).json().project;

  // First tab: starts the turn, then goes away once the build is under way.
  const first = open(project.id);
  let sessionId = "";
  await new Promise<void>((resolve, reject) => {
    first.on("error", reject);
    first.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        first.send(JSON.stringify({ type: "prompt", message: "build it" }));
      }
      if (msg.type === "text.delta") {
        first.close();
        resolve();
      }
    });
  });
  await new Promise((r) => setTimeout(r, 100));

  // Second tab: replayed what it missed, refused a second prompt, then sees
  // the end of the same turn.
  const second = open(project.id);
  const seen: Array<{ type: string; [k: string]: unknown }> = [];
  await new Promise<void>((resolve, reject) => {
    second.on("error", reject);
    second.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      seen.push(msg);
      if (msg.type === "text.delta" && msg.text === "First half. ") {
        second.send(JSON.stringify({ type: "prompt", message: "and also this" }));
      }
      if (msg.type === "error" && msg.code === "conflict") release();
      if (msg.type === "turn.end") {
        second.close();
        resolve();
      }
    });
  });

  const types = seen.map((m) => m.type);
  assert.equal(types[0], "connected");
  assert.ok(types.includes("turn.start"), "the reconnected tab knows a turn is running");
  assert.ok(
    seen.some((m) => m.type === "error" && m.code === "conflict"),
    "the second prompt is refused while the first turn runs",
  );
  const text = seen
    .filter((m) => m.type === "text.delta")
    .map((m) => m.text)
    .join("");
  assert.equal(text, "First half. Second half.");
  assert.equal(prompts, 1, "the agent was asked for one turn only");

  let assistants: Awaited<ReturnType<typeof server.store.messages.listForSession>> = [];
  for (let i = 0; i < 50; i++) {
    assistants = (await server.store.messages.listForSession(sessionId)).filter(
      (m) => m.role === "assistant",
    );
    if (assistants.length >= 1) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0]?.content, "First half. Second half.");
});
