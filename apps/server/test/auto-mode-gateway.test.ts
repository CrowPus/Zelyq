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
 * Auto Mode streams several agent turns — one per pass — down a single prompt.
 * Found live: the gateway built one message across all of them, so each later
 * pass repeated every earlier pass's text, a reload showed the whole run as a
 * single message, and only the last pass's tokens were ever counted.
 */

const PASSES = [
  { text: "Pass one built the API.", tool: "call_1", tokensIn: 100, tokensOut: 50 },
  { text: "Pass two built the UI.", tool: "call_2", tokensIn: 40, tokensOut: 20 },
];

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
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        // Two passes in ONE stream — what Auto Mode sends.
        PASSES.forEach((pass, index) => {
          const messageId = `agent_msg_${index + 1}`;
          const call = { id: pass.tool, name: "write_file", input: { path: `src/p${index}.ts` } };
          emit({ type: "turn.start", sessionId: "x", messageId, at: new Date().toISOString() });
          emit({ type: "text.delta", sessionId: "x", messageId, text: pass.text });
          emit({ type: "tool.start", sessionId: "x", messageId, call });
          emit({ type: "tool.end", sessionId: "x", messageId, call: { ...call, result: "ok" } });
          emit({
            type: "usage",
            sessionId: "x",
            tokensIn: pass.tokensIn,
            tokensOut: pass.tokensOut,
            turnTokensIn: pass.tokensIn,
            turnTokensOut: pass.tokensOut,
            turnCacheReadTokens: 0,
            turnCacheCreationTokens: 0,
          });
          emit({ type: "turn.end", sessionId: "x", messageId, stopReason: "end_turn" });
        });
        res.end();
      });
      return;
    }
    send(404, { error: { message: "not found" } });
  });
}

const tmp = path.join(os.tmpdir(), `zelyq-auto-gw-${Date.now()}`);
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
      previewPortRange: [4966, 4969],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ host: "127.0.0.1", port: 0 });
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

test("each Auto Mode pass is its own message, with its own text, tools, tokens and undo point", async () => {
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Auto passes" },
    })
  ).json().project;

  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });
  let sessionId = "";
  const ended: Array<{ content: string; snapshotId: string | null }> = [];
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        ws.send(JSON.stringify({ type: "prompt", message: "build it", engineerMode: true }));
      }
      if (msg.type === "turn.end") {
        ended.push({ content: msg.message.content, snapshotId: msg.message.snapshotId });
        if (ended.length === PASSES.length) {
          ws.close();
          resolve();
        }
      }
    });
  });

  // What the screen is handed at the end of each pass.
  assert.equal(ended[0]?.content, PASSES[0]?.text);
  assert.equal(ended[1]?.content, PASSES[1]?.text, "pass two must not repeat pass one's text");

  // Wait for the second save; turn.end is broadcast just before it lands.
  let assistants: Awaited<ReturnType<typeof server.store.messages.listForSession>> = [];
  for (let i = 0; i < 50; i++) {
    assistants = (await server.store.messages.listForSession(sessionId)).filter(
      (m) => m.role === "assistant",
    );
    if (assistants.length >= PASSES.length) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.equal(assistants.length, 2, "a reload shows one message per pass, not one for the run");
  assert.deepEqual(
    assistants.map((m) => m.content),
    PASSES.map((p) => p.text),
  );
  assert.deepEqual(
    assistants.map((m) => m.toolCalls.map((c) => c.id)),
    [["call_1"], ["call_2"]],
    "each pass keeps only its own tool calls",
  );
  assert.deepEqual(
    assistants.map((m) => [m.tokensIn, m.tokensOut]),
    [
      [100, 50],
      [40, 20],
    ],
  );
  const session = await server.store.sessions.findById(sessionId);
  assert.equal(session?.tokensIn, 140, "every pass is counted, not just the last");
  assert.equal(session?.tokensOut, 70);

  const [first, second] = assistants;
  assert.ok(first?.snapshotId && second?.snapshotId, "each pass can be undone");
  assert.notEqual(first.snapshotId, second.snapshotId, "undoing pass two leaves pass one alone");
});
