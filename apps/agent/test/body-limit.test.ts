import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import type { Conversation, ModelProvider } from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/**
 * Regression: the server forwards a
 * resolved image attachment to the agent as part of the prompt's JSON
 * body, base64-encoded — roughly a third larger than the raw bytes on top
 * of everything else in the request. Fastify's own default `bodyLimit` is
 * 1MB, far under the 8MB attachment cap `AttachmentService` enforces —
 * so an ordinary screenshot 500'd with "Request body is too large" and no
 * useful message reaching the user, because the agent's own Fastify
 * instance never raised its limit to match, even though the server's
 * already had to (`app.ts`).
 */

const noopConversation: Conversation = {
  addUserMessage: () => undefined,
  addToolResults: () => undefined,
  async *stream() {
    for (const event of [] as never[]) yield event;
    return { toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
  },
};

const provider: ModelProvider = {
  id: "anthropic",
  model: "scripted",
  createConversation: () => noopConversation,
};

const config: AgentConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  provider: "anthropic",
  model: "scripted",
  effort: "high",
  apiKey: "test-key",
  maxTurnIterations: 5,
  runtime: {
    kind: "local",
    workspaceDir: path.join(os.tmpdir(), `zelyq-body-limit-test-${Date.now()}`),
    execTimeoutMs: 10_000,
    previewPortRange: [4981, 4989],
    previewHost: "127.0.0.1",
  },
};

const server = buildAgentServer(config, { providerFactory: () => provider });

after(async () => {
  await server.close();
});

test("a prompt carrying an attachment near the 8MB cap is accepted, not rejected as too large", async () => {
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "ses_body_limit", projectId: "prj_body_limit" }),
  });
  assert.equal(created.status, 201);

  // Base64 of ~7.5MB of raw bytes — comfortably under AttachmentService's
  // 8MB cap once decoded, and well past Fastify's 1MB default that broke
  // this live.
  const bigAttachment = {
    filename: "screenshot.png",
    mimeType: "image/png",
    data: Buffer.alloc(7.5 * 1024 * 1024, 1).toString("base64"),
  };

  const response = await fetch(`${base}/sessions/ses_body_limit/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "what is this?", attachments: [bigAttachment] }),
  });

  // Read once — an assertion message argument is evaluated eagerly, so
  // calling response.text() again afterward would double-consume the body.
  const body = await response.text();
  assert.equal(response.status, 200, `expected the turn to start, got ${response.status}: ${body}`);
});
