import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
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
 * A provider that replays a fixed script, so the whole turn — streaming, tool
 * execution, and the SSE transport — can be tested without a network or a key.
 */
function scriptedProvider(
  script: Array<{ events: ProviderEvent[]; result: TurnResult }>,
): ModelProvider {
  let turnIndex = 0;
  const conversation: Conversation = {
    addUserMessage: () => undefined,
    addToolResults: (_results: ToolResult[]) => undefined,
    async *stream() {
      const step = script[Math.min(turnIndex++, script.length - 1)]!;
      for (const event of step.events) yield event;
      return step.result;
    },
  };
  return {
    id: "anthropic",
    model: "scripted",
    createConversation: () => conversation,
  };
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
    workspaceDir: path.join(os.tmpdir(), `zelyq-turn-test-${Date.now()}`),
    execTimeoutMs: 10_000,
    previewPortRange: [4970, 4980],
    previewHost: "127.0.0.1",
  },
};

/** Reads a real SSE response into the list of event types it carried. */
async function collectTurn(url: string): Promise<Array<{ type: string; [key: string]: unknown }>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "build something" }),
  });
  const text = await response.text();
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

const server = buildAgentServer(config, {
  providerFactory: () =>
    scriptedProvider([
      {
        events: [
          { type: "thinking", text: "planning" },
          { type: "text", text: "Listing the project first." },
        ],
        result: {
          toolCalls: [{ id: "call_1", name: "list_files", input: {} }],
          stopReason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      },
      {
        events: [{ type: "text", text: "Done." }],
        result: {
          toolCalls: [],
          stopReason: "end_turn",
          usage: { inputTokens: 3, outputTokens: 2 },
        },
      },
    ]),
});

after(async () => {
  await server.close();
});

test("a turn streams to completion instead of aborting itself", async () => {
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "ses_turn", projectId: "prj_turn" }),
  });
  assert.equal(created.status, 201);

  const events = await collectTurn(`${base}/sessions/ses_turn/prompt`);
  const types = events.map((event) => event.type);

  // Regression: "close" on the *request* stream fires as soon as a POST body is
  // consumed. Listening there aborted every turn milliseconds after it began —
  // the turn looked like it started and then silently stopped.
  assert.ok(!types.includes("aborted"), `turn was aborted: ${types.join(" -> ")}`);

  assert.equal(types[0], "turn.start");
  assert.ok(types.includes("thinking.delta"));
  assert.ok(types.includes("text.delta"));
  assert.ok(types.includes("tool.start"));
  assert.ok(types.includes("tool.end"));
  assert.equal(types.at(-1), "turn.end");

  // Usage accumulates across both round-trips of the turn.
  const usage = events.filter((event) => event.type === "usage").at(-1);
  assert.equal(usage?.tokensIn, 13);
  assert.equal(usage?.tokensOut, 7);

  const final = events.at(-1) as { message?: { content: string; toolCalls: unknown[] } };
  assert.match(final.message?.content ?? "", /Listing the project first\.Done\./);
  assert.equal(final.message?.toolCalls.length, 1);
});
