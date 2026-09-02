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
 * Token accounting, end to end.
 *
 * The agent emits a SESSION-CUMULATIVE running total on the `usage` event, for
 * the live gauge. The gateway used to store that on the message row and then
 * add it to the session total, so `sessions.tokens_in` grew with the square of
 * the turn count: the existing corpus is 2.1x inflated with no way to
 * rebaseline it.
 *
 * The fake agent below emits exactly what the real one does — a growing
 * cumulative figure — across two turns. If the gateway is reading the right
 * field, the session ends at the sum of the two turns. If it regresses, this
 * lands at the compounded figure and says so.
 */

/** Turn 1 costs 100/50 and turn 2 costs 40/20, reported cumulatively. */
const TURNS = [
  { turnIn: 100, turnOut: 50, cumIn: 100, cumOut: 50, cacheRead: 900, cacheWrite: 10 },
  { turnIn: 40, turnOut: 20, cumIn: 140, cumOut: 70, cacheRead: 300, cacheWrite: 0 },
];

function fakeAgent() {
  let turn = 0;
  const server = http.createServer((req, res) => {
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
          provider: input.provider ?? "google",
          model: input.model ?? "gemini-3.7-flash",
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
        const step = TURNS[Math.min(turn++, TURNS.length - 1)]!;
        const messageId = `msg_${turn}`;
        res.writeHead(200, { "content-type": "text/event-stream" });
        const emit = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        emit({
          type: "turn.start",
          sessionId: "x",
          messageId,
          at: new Date().toISOString(),
        });
        emit({
          type: "usage",
          sessionId: "x",
          // Cumulative — what the live gauge reads, and what the gateway
          // must NOT store or sum.
          tokensIn: step.cumIn,
          tokensOut: step.cumOut,
          cacheReadTokens: step.cacheRead,
          cacheCreationTokens: step.cacheWrite,
          // This turn only — what belongs on the row and in the total.
          turnTokensIn: step.turnIn,
          turnTokensOut: step.turnOut,
          turnCacheReadTokens: step.cacheRead,
          turnCacheCreationTokens: step.cacheWrite,
        });
        emit({ type: "turn.end", sessionId: "x", messageId, stopReason: "end_turn" });
        res.end();
      });
      return;
    }
    send(404, { error: { message: "not found" } });
  });
  return { server };
}

const tmp = path.join(os.tmpdir(), `zelyq-usage-gw-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let agent: ReturnType<typeof fakeAgent>;
let server: ZelyqServer;
let cookie: string;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  process.env.ZELYQ_PROVIDER = "google";
  process.env.GEMINI_API_KEY = "test-gemini-key";

  agent = fakeAgent();
  await new Promise<void>((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
  const a = agent.server.address();
  const agentPort = typeof a === "object" && a ? a.port : 0;

  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "usage.db")}`,
    agentUrl: `http://127.0.0.1:${agentPort}`,
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
      previewPortRange: [4960, 4965],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ host: "127.0.0.1", port: 0 });

  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "usage@example.com", name: "Tester", password: "correct-horse-battery" },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const session = registered.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session);
  cookie = `zelyq_session=${session.value}`;
});

after(async () => {
  await server?.close();
  await new Promise<void>((resolve) => agent.server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env.ZELYQ_PROVIDER;
  delete process.env.GEMINI_API_KEY;
});

test("two turns leave the session total at their sum, not at a compounded running total", async () => {
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Usage accounting" },
    })
  ).json().project;

  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  let sessionId = "";
  let turnsSeen = 0;
  const sendSecond = () => {
    setTimeout(() => ws.send(JSON.stringify({ type: "prompt", message: "second" })), 25);
  };
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        ws.send(JSON.stringify({ type: "prompt", message: "first" }));
      }
      if (msg.type === "turn.end") {
        turnsSeen += 1;
        if (turnsSeen === 1) {
          // `turn.end` is broadcast before the gateway's own `finally` has
          // released the room, so a prompt sent on this tick comes back as a
          // conflict. Retry until it is accepted — the same thing the real UI
          // does when someone types fast.
          sendSecond();
        } else {
          ws.close();
          resolve();
        }
      }
      if (msg.type === "error" && msg.code === "conflict") sendSecond();
    });
  });

  assert.equal(turnsSeen, 2);

  const session = await server.store.sessions.findById(sessionId);
  assert.ok(session);
  // 100 + 40, and 50 + 20. The pre-fix gateway summed the cumulative figures
  // and reached 240 / 120 — and diverged further with every extra turn.
  assert.equal(session.tokensIn, 140, "session input must be the sum of the two turns");
  assert.equal(session.tokensOut, 70, "session output must be the sum of the two turns");

  const messages = await server.store.messages.listForSession(sessionId);
  const assistants = messages.filter((m) => m.role === "assistant");
  assert.equal(assistants.length, 2);
  assert.deepEqual(
    assistants.map((m) => [m.tokensIn, m.tokensOut]),
    [
      [100, 50],
      [40, 20],
    ],
    "each row must carry ITS turn's usage, not the running total",
  );

  // The cache split is what makes a row priceable at all — a read bills at
  // ~0.1x and a write at ~1.25x, so a row without them cannot be turned into
  // money. It was computed by the agent and dropped at the gateway until now.
  assert.deepEqual(
    assistants.map((m) => [m.cacheReadTokens, m.cacheCreationTokens]),
    [
      [900, 10],
      [300, 0],
    ],
  );
  assert.deepEqual(
    assistants.map((m) => m.usageSchema),
    [1, 1],
  );
});
