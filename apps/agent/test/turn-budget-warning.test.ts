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
 * D3 — when a turn is near its step cap, the model gets one message telling it
 * to land the work, instead of discovering the cap by being cut off. The
 * message must go into the conversation (not the system prompt, which would
 * blow the cache), fire once, and not fire at all when the cap is small enough
 * that there is nothing to pace.
 */
const injected: string[] = [];

function recordingProvider(toolTurns: number): ModelProvider {
  let turn = 0;
  const conversation: Conversation = {
    addUserMessage: (text: string) => {
      injected.push(text);
    },
    addToolResults: (_r: ToolResult[]) => undefined,
    async *stream(): AsyncGenerator<ProviderEvent, TurnResult, undefined> {
      // This scripted provider streams nothing; the loop below is only here so
      // the generator has a `yield` (biome's useYield) — same shape as
      // turn-fallback.test.ts.
      for (const event of [] as ProviderEvent[]) yield event;
      turn += 1;
      if (turn <= toolTurns) {
        return {
          toolCalls: [
            {
              id: `c${turn}`,
              name: "write_file",
              input: { path: `src/f${turn}.tsx`, content: "x" },
            },
          ],
          stopReason: "tool_use",
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
      return { toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 5 } };
    },
  };
  return { id: "anthropic", model: "scripted", createConversation: () => conversation };
}

async function runTurn(maxIterations: number, toolTurns: number): Promise<void> {
  injected.length = 0;
  const workspaceDir = path.join(os.tmpdir(), `zelyq-budget-test-${Date.now()}-${Math.random()}`);
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
    maxTurnIterations: maxIterations,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4991, 4998],
      previewHost: "127.0.0.1",
    },
  };
  const server = buildAgentServer(config, { providerFactory: () => recordingProvider(toolTurns) });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "ses_b", projectId: "prj_b" }),
    });
    await fetch(`http://127.0.0.1:${port}/sessions/ses_b/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "build something" }),
    });
  } finally {
    await server.app.close();
  }
}

const budgetLines = () => injected.filter((t) => /of this turn's \d+ steps/.test(t));

test("the budget warning fires once, near the cap", async () => {
  await runTurn(15, 20); // 15-step cap, model keeps calling tools past it
  assert.equal(budgetLines().length, 1, "exactly one budget warning");
  assert.match(budgetLines()[0]!, /1[123] of this turn's 15 steps/); // 80% of 15 = 12
  assert.match(budgetLines()[0]!, /safe stopping point/);
});

test("no budget warning when the model lands before the threshold", async () => {
  await runTurn(15, 3); // done in 3 steps, nowhere near 12
  assert.equal(budgetLines().length, 0);
});

test("no budget warning for a small cap — nothing to pace", async () => {
  await runTurn(6, 20);
  assert.equal(budgetLines().length, 0);
});
