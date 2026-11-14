import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { runOpsTurn } from "../src/ops-turn.js";
import type {
  Conversation,
  ModelProvider,
  ProviderEvent,
  TurnResult,
} from "../src/providers/types.js";

/**
 * One turn of Ops in the agent service: the model runs here, every tool call
 * goes to the Zelyq server's bridge with the turn's token, and the turn stops
 * at its limits.
 */

type Step = { events: ProviderEvent[]; result: TurnResult };
const call = (name: string, input: Record<string, unknown> = {}): Step => ({
  events: [],
  result: {
    toolCalls: [{ id: `c_${name}_${Math.random()}`, name, input }],
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 2 },
  },
});
const say = (text: string): Step => ({
  events: [{ type: "text", text }],
  result: { toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } },
});

function scripted(script: Step[], seen: { results: unknown[] }) {
  let i = 0;
  return (): ModelProvider => ({
    id: "anthropic",
    model: "scripted",
    createConversation(): Conversation {
      return {
        addUserMessage: () => undefined,
        addToolResults: (results) => {
          seen.results.push(...results);
        },
        async *stream() {
          const step = script[Math.min(i++, script.length - 1)] as Step;
          for (const event of step.events) yield event;
          return step.result;
        },
      };
    },
  });
}

async function bridge(handler: (tool: string, input: unknown, token: string) => unknown) {
  const calls: { tool: string; token: string }[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const parsed = JSON.parse(body) as { tool: string; input: unknown };
      const token = String(request.headers["x-zelyq-ops-bridge"]);
      calls.push({ tool: parsed.tool, token });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(handler(parsed.tool, parsed.input, token)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/ops-bridge`;
  return { url, calls, close: () => server.close() };
}

const base = {
  provider: "anthropic",
  model: "claude-opus-5",
  apiKey: "test",
  authMode: "api_key" as const,
  systemPrompt: "You are Ops.",
  history: [],
  message: "What environments do we have?",
  tools: [{ name: "list_environments", description: "x", input_schema: { type: "object" } }],
  limits: { rounds: 10, tokens: 1_000_000, minutes: 5 },
};

test("every tool call goes to the server's bridge with the turn's token; the last words are the answer", async () => {
  const server = await bridge((tool) => ({
    output: `${tool}: staging, production`,
    isError: false,
  }));
  const seen = { results: [] as unknown[] };
  try {
    const result = await runOpsTurn(
      { ...base, bridge: { url: server.url, token: "t".repeat(32) } },
      fetch,
      scripted([call("list_environments"), say("You have two: staging and production.")], seen),
    );
    assert.equal(result.text, "You have two: staging and production.");
    assert.equal(result.stopped, null);
    assert.equal(result.rounds, 2);
    assert.deepEqual(server.calls, [{ tool: "list_environments", token: "t".repeat(32) }]);
    assert.match(JSON.stringify(seen.results), /staging, production/);
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 7 });
  } finally {
    server.close();
  }
});

test("a turn stops at its limit and says how to go on", async () => {
  const server = await bridge(() => ({ output: "ok", isError: false }));
  try {
    const result = await runOpsTurn(
      {
        ...base,
        limits: { ...base.limits, rounds: 3 },
        bridge: { url: server.url, token: "t".repeat(32) },
      },
      fetch,
      scripted([call("list_environments")], { results: [] }),
    );
    assert.match(result.stopped ?? "", /stopped after 3 steps[\s\S]*go on/);
    assert.equal(server.calls.length, 3);
  } finally {
    server.close();
  }
});

test("a model known to be too small for operations work is refused before anything runs", async () => {
  await assert.rejects(
    runOpsTurn(
      {
        ...base,
        provider: "mistral",
        model: "mistral-small-latest",
        bridge: { url: "http://127.0.0.1:1/api/ops-bridge", token: "t".repeat(32) },
      },
      fetch,
      scripted([say("hi")], { results: [] }),
    ),
    /too small for Ops/,
  );
});
