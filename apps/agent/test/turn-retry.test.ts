import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import type {
  Conversation,
  ModelProvider,
  ProviderEvent,
  ToolResult,
  TurnResult,
} from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/**
 * A model call that comes back empty — no text, no tool calls, not a
 * refusal — is a transient provider hiccup, not a finished turn. The run
 * retries it a few times with backoff instead of leaving the user with
 * "No changes were made" and no way forward (found live: the Architect
 * stalled mid-package, every "proceed" an empty turn).
 */
function scripted(script: Array<{ events: ProviderEvent[]; result: TurnResult }>): ModelProvider {
  let i = 0;
  const conversation: Conversation = {
    addUserMessage: () => undefined,
    addToolResults: (_r: ToolResult[]) => undefined,
    async *stream() {
      const step = script[Math.min(i++, script.length - 1)]!;
      for (const e of step.events) yield e;
      return step.result;
    },
  };
  return { id: "anthropic", model: "scripted", createConversation: () => conversation };
}

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
    workspaceDir: path.join(os.tmpdir(), `zelyq-retry-test-${Date.now()}`),
    execTimeoutMs: 10_000,
    previewPortRange: [4960, 4969],
    previewHost: "127.0.0.1",
  },
};

async function collectTurn(url: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "go on" }),
  });
  return (await res.text())
    .split("\n\n")
    .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6))) as Array<{ type: string; [k: string]: unknown }>;
}

test("an empty model response is retried, not surfaced as 'No changes were made'", async () => {
  const server = buildAgentServer(config, {
    providerFactory: () =>
      scripted([
        // First call: the provider returns nothing at all.
        {
          events: [],
          result: {
            toolCalls: [],
            stopReason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 0 },
          },
        },
        // Retry: a real answer.
        {
          events: [{ type: "text", text: "Recovered and finished the package." }],
          result: {
            toolCalls: [],
            stopReason: "end_turn",
            usage: { inputTokens: 2, outputTokens: 4 },
          },
        },
      ]),
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    const created = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "ses_retry", projectId: "prj_retry" }),
    });
    assert.equal(created.status, 201);

    const events = await collectTurn(`${base}/sessions/ses_retry/prompt`);
    const retrying = events.find(
      (e) => e.type === "error" && (e as { code?: string }).code === "retrying",
    );
    assert.ok(retrying, "a retry notice was emitted for the empty response");
    assert.match(String((retrying as { message?: string }).message), /empty response/i);

    const text = events
      .filter((e) => e.type === "text.delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    assert.match(text, /Recovered and finished/);
    assert.doesNotMatch(text, /No changes were made/);

    const end = events.find((e) => e.type === "turn.end") as { stopReason?: string } | undefined;
    assert.equal(end?.stopReason, "end_turn");
  } finally {
    await server.close();
  }
});

test("Architect Mode: a persistently empty turn hands back a real way forward, not 'No changes were made'", async () => {
  const server = buildAgentServer(config, {
    providerFactory: () =>
      scripted([
        {
          events: [],
          result: {
            toolCalls: [],
            stopReason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 0 },
          },
        },
      ]),
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "ses_arch_empty",
        projectId: "prj_arch_empty",
        architectMode: true,
      }),
    });
    const events = await collectTurn(`${base}/sessions/ses_arch_empty/prompt`);
    const text = events
      .filter((e) => e.type === "text.delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    assert.match(text, /kept returning an empty response|skip the report|regenerate the report/i);
    assert.doesNotMatch(text, /No changes were made/);
  } finally {
    await server.close();
  }
});

test("a genuinely empty turn still resolves after the retry ceiling, not forever", async () => {
  const server = buildAgentServer(config, {
    providerFactory: () =>
      scripted([
        {
          events: [],
          result: {
            toolCalls: [],
            stopReason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 0 },
          },
        },
      ]),
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "ses_retry2", projectId: "prj_retry2" }),
    });
    const events = await collectTurn(`${base}/sessions/ses_retry2/prompt`);
    // It backs off a bounded number of times, then gives up and ends the
    // turn with the reconstructed fallback rather than looping.
    const retries = events.filter(
      (e) => e.type === "error" && (e as { code?: string }).code === "retrying",
    );
    assert.equal(retries.length, 3, "exactly MODEL_RETRY_MAX retry notices");
    assert.ok(
      events.some((e) => e.type === "turn.end"),
      "the turn still ends",
    );
  } finally {
    await server.close();
  }
});
