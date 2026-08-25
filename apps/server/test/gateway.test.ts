import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { createRuntimeDriver } from "@zelyq/runtime";
import { WebSocket } from "ws";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Stands in for the real agent — enough of its `/sessions` surface to prove
 * what the gateway actually asks for, not the model loop behind it. Tracks
 * every `POST /sessions` body it was given, so a test can assert on the
 * exact provider a prompt resolved to.
 */
function fakeAgent() {
  const created: Array<{ provider?: string; model?: string; baseUrl?: string }> = [];
  const prompts: Array<{
    message: string;
    attachments?: Array<{ filename: string; mimeType: string; data: string }>;
  }> = [];
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
          {
            id: "openai",
            label: "OpenAI",
            defaultModel: "gpt-5.1",
            apiKeyEnv: ["OPENAI_API_KEY"],
            docsUrl: "https://platform.openai.com/api-keys",
            configured: false,
          },
        ],
      });
      return;
    }
    if (req.method === "POST" && req.url === "/sessions") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const input = JSON.parse(body);
        created.push({ provider: input.provider, model: input.model, baseUrl: input.baseUrl });
        send(201, {
          sessionId: input.sessionId,
          projectId: input.projectId,
          provider: input.provider,
          model: input.model ?? "default-model",
          effort: "high",
          busy: false,
          turns: 0,
          tokensIn: 0,
          tokensOut: 0,
        });
      });
      return;
    }
    if (req.method === "POST" && req.url?.match(/^\/sessions\/.+\/prompt$/)) {
      let promptBody = "";
      req.on("data", (chunk) => {
        promptBody += chunk;
      });
      req.on("end", () => {
        const input = JSON.parse(promptBody);
        prompts.push({ message: input.message, attachments: input.attachments });
        writePromptResponse();
      });
      return;
    }
    function writePromptResponse() {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ type: "turn.start", sessionId: "x", messageId: "msg_1", at: new Date().toISOString() })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({
          type: "turn.end",
          sessionId: "x",
          messageId: "msg_1",
          stopReason: "end_turn",
          message: {
            id: "msg_1",
            sessionId: "x",
            role: "assistant",
            content: "hi",
            thinking: null,
            toolCalls: [],
            attachments: [],
            tokensIn: 1,
            tokensOut: 1,
            createdAt: new Date().toISOString(),
          },
        })}\n\n`,
      );
      res.end();
      return;
    }
    send(404, { error: { message: "not found" } });
  });
  return { server, created, prompts };
}

const tmp = path.join(os.tmpdir(), `zelyq-gateway-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let agent: ReturnType<typeof fakeAgent>;
let agentPort: number;
let server: ZelyqServer;

async function register(email: string): Promise<{ cookie: string }> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: "Tester", password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  const session = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session);
  return { cookie: `zelyq_session=${session.value}` };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });

  // SettingsService resolves "provider" from process.env directly — the same
  // way the real app does — not from the ServerConfig object below, which
  // only seeds a brand-new session's initial value. Setting it here is what
  // makes this test exercise the actual live-resolution path.
  process.env.ZELYQ_PROVIDER = "google";

  agent = fakeAgent();
  await new Promise<void>((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
  const address = agent.server.address();
  agentPort = typeof address === "object" && address ? address.port : 0;

  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "gateway.db")}`,
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
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4970, 4975],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ host: "127.0.0.1", port: 0 });
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => agent.server.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env.ZELYQ_PROVIDER;
});

test("a prompt resolves the live-configured provider, not a stale one baked into the session", async () => {
  const { cookie } = await register("provider-test@example.com");

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Provider live test" },
    })
  ).json().project;

  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        ws.send(JSON.stringify({ type: "prompt", message: "say hello" }));
      }
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  assert.equal(agent.created.length, 1, "exactly one session should have been created");
  assert.equal(
    agent.created[0]?.provider,
    "google",
    "the live-configured provider must reach the agent, not a stale stored one",
  );
});

test("a session already stored with a different provider is corrected on the next prompt", async () => {
  // Reproduces the exact regression, not just the happy path: a session
  // whose stored row disagrees with the live setting — exactly what every
  // real session on a real instance looked like before this fix.
  const { cookie } = await register("stale-session@example.com");

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Stale session test" },
    })
  ).json().project;

  agent.created.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  let sessionId = "";
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", async (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        // Connecting is what creates the session row — corrupt it here,
        // before the prompt, to reproduce exactly what every real session
        // on a real instance looked like: created correctly, then never
        // updated again as settings changed underneath it.
        sessionId = msg.sessionId;
        await server.store.sessions.setModel(sessionId, "anthropic", "claude-opus-5");
        const stale = await server.store.sessions.findById(sessionId);
        assert.equal(
          stale?.provider,
          "anthropic",
          "the row must actually be stale before the test proves anything",
        );
        ws.send(JSON.stringify({ type: "prompt", message: "hi" }));
      }
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  assert.equal(
    agent.created[0]?.provider,
    "google",
    "a stale stored provider must not win over the live setting",
  );

  const corrected = await server.store.sessions.findById(sessionId);
  assert.equal(corrected?.provider, "google", "the stored row must be corrected, not left stale");
});

test("a provider picked from the chat itself overrides the live setting for that prompt, and is remembered", async () => {
  // See `033`: the composer's own model control, not a settings change —
  // proves the override reaches the agent and the session row picks it up,
  // the same way `031`'s fix already proved for the settings-driven path.
  const { cookie } = await register("picker-test@example.com");

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Picker test" },
    })
  ).json().project;

  agent.created.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  let sessionId = "";
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        ws.send(JSON.stringify({ type: "prompt", message: "hi", provider: "openai" }));
      }
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  assert.equal(
    agent.created[0]?.provider,
    "openai",
    "a provider picked in the chat must reach the agent, even though the live setting is google",
  );

  const stored = await server.store.sessions.findById(sessionId);
  assert.equal(stored?.provider, "openai", "the picked provider is remembered on the session row");
});

test("a specific model picked from the chat reaches the agent, not just its provider's default", async () => {
  // The picker (`033`) offers Opus, Sonnet, and Haiku as separate choices,
  // not one "Claude" choice that quietly always uses the default tier.
  const { cookie } = await register("model-tier-test@example.com");

  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Model tier test" },
    })
  ).json().project;

  agent.created.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        ws.send(
          JSON.stringify({
            type: "prompt",
            message: "hi",
            provider: "anthropic",
            model: "claude-haiku-4-5-20251001",
          }),
        );
      }
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  assert.equal(agent.created[0]?.provider, "anthropic");
  assert.equal(
    agent.created[0]?.model,
    "claude-haiku-4-5-20251001",
    "the specific model picked must reach the agent, not the provider's own default",
  );
});

test("a base URL configured for the live provider is not forwarded to a provider picked instead", async () => {
  // The scenario `033` calls out explicitly: settings has a base URL meant
  // for whatever provider is actually configured (google, here) — picking
  // a different provider from the chat must not redirect it there too.
  await server.store.settings.set("modelBaseUrl", "http://localhost:9/not-for-openai");

  const { cookie } = await register("baseurl-isolation@example.com");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Base URL isolation test" },
    })
  ).json().project;

  agent.created.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "connected") {
          ws.send(JSON.stringify({ type: "prompt", message: "hi", provider: "openai" }));
        }
        if (msg.type === "turn.end") {
          ws.close();
          resolve();
        }
      });
    });

    assert.equal(agent.created[0]?.provider, "openai");
    assert.equal(
      agent.created[0]?.baseUrl,
      undefined,
      "google's own base URL must not reach a provider picked instead of it",
    );
  } finally {
    await server.store.settings.remove("modelBaseUrl");
  }
});

test("GET /api/providers is available to anyone signed in, and never carries a key", async () => {
  const { cookie } = await register("picker-reads@example.com");

  const anonymous = await server.app.inject({ method: "GET", url: "/api/providers" });
  assert.equal(anonymous.statusCode, 401, "signing in is still required");

  const response = await server.app.inject({
    method: "GET",
    url: "/api/providers",
    headers: { cookie },
  });
  assert.equal(
    response.statusCode,
    200,
    "an ordinary account, not just an instance admin, can read it",
  );

  const body = response.json();
  assert.equal(body.default, "google");
  assert.deepEqual(
    body.providers.map((provider: { id: string; configured: boolean }) => provider.id),
    ["google", "openai"],
  );
  assert.equal(body.providers[0].configured, true);
  assert.equal(body.providers[1].configured, false);

  const serialised = JSON.stringify(body);
  assert.ok(!serialised.includes("apiKeyEnv"), "the env var backing a provider must not leak");
  assert.ok(!serialised.includes("docsUrl"), "only what the picker needs is returned");
});

// --- Attachments (see `037`) ---------------------------------------------

// A 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function upload(
  cookie: string,
  projectId: string,
  input: { filename: string; mimeType: string; data: string },
): Promise<{ id: string }> {
  const response = await server.app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/attachments`,
    headers: { cookie },
    payload: input,
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().attachment;
}

test("an uploaded image reaches the agent as base64 image data, and is persisted on the message row", async () => {
  const { cookie } = await register("attach-image@example.com");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Image attachment test" },
    })
  ).json().project;

  const attachment = await upload(cookie, project.id, {
    filename: "pixel.png",
    mimeType: "image/png",
    data: PNG_BASE64,
  });

  agent.prompts.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  let sessionId = "";
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        ws.send(
          JSON.stringify({
            type: "prompt",
            message: "what is this?",
            attachments: [attachment.id],
          }),
        );
      }
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  assert.equal(agent.prompts.length, 1);
  assert.equal(
    agent.prompts[0]?.message,
    "what is this?",
    "the prompt text is not rewritten for an image",
  );
  assert.equal(agent.prompts[0]?.attachments?.length, 1);
  assert.equal(agent.prompts[0]?.attachments?.[0]?.mimeType, "image/png");
  assert.equal(agent.prompts[0]?.attachments?.[0]?.data, PNG_BASE64);

  const history = await server.store.messages.listForSession(sessionId);
  const userMessage = history.find((m) => m.role === "user");
  assert.equal(
    userMessage?.content,
    "what is this?",
    "the stored transcript keeps exactly what was typed",
  );
  assert.equal(userMessage?.attachments.length, 1);
  assert.equal(userMessage?.attachments[0]?.id, attachment.id);
  assert.equal(userMessage?.attachments[0]?.filename, "pixel.png");
});

test("an uploaded text file is inlined into the prompt sent to the agent, not sent as an image", async () => {
  const { cookie } = await register("attach-text@example.com");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Text attachment test" },
    })
  ).json().project;

  const attachment = await upload(cookie, project.id, {
    filename: "notes.txt",
    mimeType: "text/plain",
    data: Buffer.from("remember to fix the header").toString("base64"),
  });

  agent.prompts.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  let sessionId = "";
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        ws.send(
          JSON.stringify({ type: "prompt", message: "apply this", attachments: [attachment.id] }),
        );
      }
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  assert.equal(agent.prompts.length, 1);
  assert.ok(
    agent.prompts[0]?.message.includes("remember to fix the header"),
    "the file's text content is inlined into the prompt sent to the agent",
  );
  assert.ok(agent.prompts[0]?.message.startsWith("apply this"), "the typed prompt still leads");
  assert.ok(
    !agent.prompts[0]?.attachments?.length,
    "a text file is never sent through the image-attachments channel",
  );

  const history = await server.store.messages.listForSession(sessionId);
  const userMessage = history.find((m) => m.role === "user");
  assert.equal(
    userMessage?.content,
    "apply this",
    "the stored transcript is exactly what was typed, without the inlined file text",
  );
  assert.equal(userMessage?.attachments[0]?.filename, "notes.txt");
});

test("an unknown attachment id refuses the turn with a clear error, before anything is persisted", async () => {
  const { cookie } = await register("attach-missing@example.com");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Missing attachment test" },
    })
  ).json().project;

  agent.prompts.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  let sessionId = "";
  const errorMessage = await new Promise<string>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        sessionId = msg.sessionId;
        ws.send(
          JSON.stringify({ type: "prompt", message: "hi", attachments: ["atc_doesnotexist"] }),
        );
      }
      if (msg.type === "error") {
        ws.close();
        resolve(msg.message);
      }
    });
  });

  assert.match(errorMessage, /could not be found/);
  assert.equal(agent.prompts.length, 0, "the agent must never be reached for a bad attachment id");
  const history = await server.store.messages.listForSession(sessionId);
  assert.equal(history.length, 0, "nothing is persisted when the turn is refused up front");
});

test("a non-image, non-UTF8 attachment is refused with a clear error, not silently mangled", async () => {
  const { cookie } = await register("attach-binary@example.com");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Binary attachment test" },
    })
  ).json().project;

  // Not a registered image mimeType, and not valid UTF-8 either — an
  // arbitrary binary blob, the kind a user might attach by mistake.
  const attachment = await upload(cookie, project.id, {
    filename: "data.bin",
    mimeType: "application/octet-stream",
    data: Buffer.from([0xff, 0xfe, 0x00, 0x01, 0xc0, 0xc1]).toString("base64"),
  });

  agent.prompts.length = 0;
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  const errorMessage = await new Promise<string>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        ws.send(JSON.stringify({ type: "prompt", message: "hi", attachments: [attachment.id] }));
      }
      if (msg.type === "error") {
        ws.close();
        resolve(msg.message);
      }
    });
  });

  assert.match(errorMessage, /isn't an image or a text file/);
  assert.equal(agent.prompts.length, 0);
});

// --- Git integration (see `035`) -----------------------------------------

test("a turn that changes a file produces a real git commit in the project's own workspace", async () => {
  const { cookie } = await register("git-commit@example.com");
  const project = (
    await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Git commit test" },
    })
  ).json().project;

  // The fake agent never touches the filesystem — this stands in for
  // whatever a real turn's tool calls would have written, so the turn
  // itself, run through the real WS flow, is what's actually exercised.
  const projectDir = path.join(tmp, "workspace", project.id);
  await fs.writeFile(path.join(projectDir, "changed-by-turn.txt"), "hello");

  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/projects/${project.id}`, {
    headers: { cookie },
  });

  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "connected") {
        ws.send(JSON.stringify({ type: "prompt", message: "add a file" }));
      }
      if (msg.type === "turn.end") {
        ws.close();
        resolve();
      }
    });
  });

  const runtime = createRuntimeDriver({
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 10_000,
    previewPortRange: [4996, 4999],
    previewHost: "127.0.0.1",
  });
  try {
    // commitTurn runs in the gateway's own `finally`, *after* turn.end is
    // already broadcast — receiving that message on the wire is not proof
    // the server has finished (or even started) committing yet. Poll
    // rather than assume synchronous completion.
    let log = await runtime.exec(project.id, { command: "git log --oneline" });
    for (let attempt = 0; attempt < 50 && log.exitCode !== 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      log = await runtime.exec(project.id, { command: "git log --oneline" });
    }
    assert.equal(log.exitCode, 0, "the project must be a real git repository by now");
    assert.equal(log.stdout.trim().split("\n").length, 1, "exactly one commit for the one turn");
    assert.match(log.stdout, /Before: add a file/);

    const status = await runtime.exec(project.id, { command: "git status --porcelain" });
    assert.equal(
      status.stdout.trim(),
      "",
      "the file that changed was actually committed, not left dirty",
    );
  } finally {
    await runtime.dispose();
  }
});
