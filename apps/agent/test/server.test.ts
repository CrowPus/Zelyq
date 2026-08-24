import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import { buildAgentServer } from "../src/server.js";

const config: AgentConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  apiKey: undefined,
  maxTurnIterations: 5,
  runtime: {
    kind: "local",
    workspaceDir: path.join(os.tmpdir(), `zelyq-agent-test-${Date.now()}`),
    execTimeoutMs: 10_000,
    previewPortRange: [4900, 4910],
    previewHost: "127.0.0.1",
  },
};

const server = buildAgentServer(config);
after(async () => {
  await server.close();
});

test("health reports the runtime it is wired to", async () => {
  const response = await server.app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.service, "zelyq-agent");
  assert.equal(body.runtime.kind, "local");
  assert.equal(body.modelConfigured, false);
});

test("creating a session without any API key fails clearly", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: { sessionId: "ses_test", projectId: "prj_test" },
  });
  assert.equal(response.statusCode, 401);
  // The message must name the provider and its variable — "no API key" alone
  // leaves the user guessing which of two keys is missing.
  assert.match(response.json().error.message, /Claude API key/);
  assert.match(response.json().error.message, /ANTHROPIC_API_KEY/);
});

test("asking for a provider with no key names that provider, not the default", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: { sessionId: "ses_g", projectId: "prj_test", provider: "google" },
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.json().error.message, /Gemini API key/);
  assert.match(response.json().error.message, /GEMINI_API_KEY/);
});

test("an unknown provider is rejected as a bad request", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    // A name no registry entry claims. "openai" used to serve as the unknown
    // here, which stopped being true the moment it became a provider.
    payload: { sessionId: "ses_x", projectId: "prj_test", provider: "acme-models" },
  });
  assert.equal(response.statusCode, 400);
});

test("the providers endpoint reports what this instance can use", async () => {
  const response = await server.app.inject({ method: "GET", url: "/providers" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.default, "anthropic");
  const ids = body.providers.map((provider: { id: string }) => provider.id);
  assert.deepEqual(ids.sort(), [
    "anthropic",
    "custom",
    "deepseek",
    "google",
    "groq",
    "mistral",
    "openai",
    "openrouter",
    "xai",
  ]);
  for (const provider of body.providers) {
    assert.equal(typeof provider.configured, "boolean");
  }

  // The picker (`033`) needs a specific model to pick, not just a vendor —
  // Opus, Sonnet, and Haiku are three choices, not one "Claude" choice.
  const anthropic = body.providers.find((provider: { id: string }) => provider.id === "anthropic");
  assert.ok(anthropic.models?.length >= 3, "Claude's known tiers must be listed");
  assert.ok(anthropic.models.some((model: { value: string }) => model.value === "claude-opus-5"));

  // A vendor with nothing confirmed yet must not invent a model list either.
  const xai = body.providers.find((provider: { id: string }) => provider.id === "xai");
  assert.equal(xai.models, undefined);
});

test("prompting an unknown session is a 404, not a crash", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions/ses_missing/prompt",
    payload: { message: "hello" },
  });
  assert.equal(response.statusCode, 404);
});

test("aborting an unknown session is a 404", async () => {
  const response = await server.app.inject({ method: "POST", url: "/sessions/ses_missing/abort" });
  assert.equal(response.statusCode, 404);
});
