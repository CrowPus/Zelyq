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
  assert.deepEqual(body.plugins, [], "no plugin names were passed in, so none are reported");
});

test("health reports plugin tool names when the loader found any — see 037", async () => {
  const withPlugins = buildAgentServer(config, { pluginNames: ["roll_dice", "word_count"] });
  try {
    const response = await withPlugins.app.inject({ method: "GET", url: "/health" });
    assert.deepEqual(response.json().plugins, ["roll_dice", "word_count"]);
  } finally {
    await withPlugins.close();
  }
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

// ---------------------------------------------------------------------------
// A Codex subscription session speaks a different backend, with its own
// model names — see `045`'s OpenAI follow-up. Found live: silently falling
// back to defaultModelFor("openai") ("gpt-5.1", confirmed only for the
// ordinary public API) sent a model the Codex backend never recognised.
// ---------------------------------------------------------------------------

test("a Codex session with no model given is refused clearly, not defaulted wrong", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      sessionId: "ses_codex_no_model",
      projectId: "prj_test",
      provider: "openai",
      apiKey: "tok:acc_1",
      authMode: "subscription",
    },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /Codex session has no confirmed default model/);
});

test("a Codex session with an explicit model is accepted", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      sessionId: "ses_codex_with_model",
      projectId: "prj_test",
      provider: "openai",
      model: "gpt-5.3-codex",
      apiKey: "tok:acc_1",
      authMode: "subscription",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
});

test("an ordinary OpenAI session (no subscription mode) still gets its usual default with no model given", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      sessionId: "ses_openai_ordinary",
      projectId: "prj_test",
      provider: "openai",
      apiKey: "sk-a-real-key",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().model, "gpt-5.1");
});

// ---------------------------------------------------------------------------
// Engineer Mode's effort floor — ZED-0001, Phase 1. The client-side check is
// the primary UX (see the entry's Proposed decision), but a real constraint
// needs server-side enforcement too, the same discipline the Codex checks
// above already hold — a hand-crafted request must not bypass it.
// ---------------------------------------------------------------------------

test("engineer mode with effort below high is refused, not silently downgraded", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      sessionId: "ses_em_low_effort",
      projectId: "prj_test",
      apiKey: "sk-test",
      effort: "medium",
      engineerMode: true,
    },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error.message, /Engineer Mode needs reasoning effort at "high"/);
  assert.match(response.json().error.message, /"medium"/);
});

test("engineer mode with effort at high is accepted and reflected in session state", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      sessionId: "ses_em_high_effort",
      projectId: "prj_test",
      apiKey: "sk-test",
      effort: "high",
      engineerMode: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().engineerMode, true);
});

test("engineer mode with effort entirely omitted falls through to the process default, which is high", async () => {
  // config.effort is "high" (see the module-scope config above) — the same
  // fallthrough resolvedEffort = input.effort ?? config.effort already
  // takes for every other session, exercised here specifically for the
  // one field the floor check reads.
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      sessionId: "ses_em_no_effort_given",
      projectId: "prj_test",
      apiKey: "sk-test",
      engineerMode: true,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().effort, "high");
  assert.equal(response.json().engineerMode, true);
});

test("engineer mode off is unaffected by a low effort setting", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: {
      sessionId: "ses_em_off_low_effort",
      projectId: "prj_test",
      apiKey: "sk-test",
      effort: "low",
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().engineerMode, false);
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

  // Hosted vendors now carry a curated model shortlist so the picker has
  // real choices to offer.
  const xai = body.providers.find((provider: { id: string }) => provider.id === "xai");
  assert.ok(xai.models?.some((model: { value: string }) => model.value === "grok-4"));

  // `custom` still cannot — the model a user's own endpoint holds is that
  // endpoint's business, and guessing produces a 404 that reads like a bug.
  const custom = body.providers.find((provider: { id: string }) => provider.id === "custom");
  assert.ok(!custom.models || custom.models.length === 0);
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
