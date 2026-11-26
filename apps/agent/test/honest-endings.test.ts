import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
 * A turn must not be reported as finished when it is not:
 * - a reply that was only thinking (or Gemini's malformed tool call, which
 *   arrives as "other" with nothing else) is retried, not taken as done;
 * - tool calls from a reply cut off at the output limit never run;
 * - a failing end-of-turn check sends the model back to repair it, a few
 *   rounds at most, and then the turn ends with a visible "still broken".
 */

type Step = { events: ProviderEvent[]; result: TurnResult };

function scripted(script: Step[], seen: { results: ToolResult[][]; messages: string[] }) {
  let i = 0;
  const conversation: Conversation = {
    addUserMessage: (text: string) => {
      seen.messages.push(text);
    },
    addToolResults: (results: ToolResult[]) => {
      seen.results.push(results);
    },
    async *stream() {
      const step = script[Math.min(i++, script.length - 1)] as Step;
      for (const event of step.events) yield event;
      return step.result;
    },
  };
  return {
    id: "anthropic",
    model: "scripted",
    createConversation: () => conversation,
  } as ModelProvider;
}

const usage = { inputTokens: 1, outputTokens: 1 };
const say = (text: string): Step => ({
  events: [{ type: "text", text }],
  result: { toolCalls: [], stopReason: "end_turn", usage },
});

async function run(script: Step[], maxTurnIterations = 12) {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-honest-${Date.now()}-${Math.random()}`);
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
    maxTurnIterations,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 20_000,
      previewPortRange: [4970, 4979],
      previewHost: "127.0.0.1",
    },
  };
  const seen = { results: [] as ToolResult[][], messages: [] as string[] };
  const server = buildAgentServer(config, { providerFactory: () => scripted(script, seen) });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    const created = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "ses_h", projectId: "prj_h" }),
    });
    assert.equal(created.status, 201);
    const res = await fetch(`${base}/sessions/ses_h/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "build it" }),
    });
    const events = (await res.text())
      .split("\n\n")
      .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
      .filter((l): l is string => Boolean(l))
      .map((l) => JSON.parse(l.slice(6))) as Array<{ type: string; [k: string]: unknown }>;
    return { events, seen, projectDir: path.join(workspaceDir, "prj_h") };
  } finally {
    await server.close();
  }
}

const errorCodes = (events: Array<{ type: string; [k: string]: unknown }>) =>
  events.filter((e) => e.type === "error").map((e) => e.code as string);

test("a reply that was only thinking is retried, not taken as a finished turn", async () => {
  const { events } = await run([
    {
      events: [{ type: "thinking", text: "Let me plan the components…" }],
      result: { toolCalls: [], stopReason: "end_turn", usage },
    },
    say("Built the page."),
  ]);
  assert.ok(errorCodes(events).includes("retrying"));
  const text = events
    .filter((e) => e.type === "text.delta")
    .map((e) => e.text)
    .join("");
  assert.match(text, /Built the page/);
});

test("a malformed reply with nothing in it (stop reason 'other') is retried", async () => {
  const { events } = await run([
    { events: [], result: { toolCalls: [], stopReason: "other", usage } },
    say("Done."),
  ]);
  assert.ok(errorCodes(events).includes("retrying"));
});

test("tool calls from a reply cut off at the output limit never run", async () => {
  const { events, seen, projectDir } = await run([
    {
      events: [],
      result: {
        toolCalls: [
          { id: "t1", name: "write_file", input: { path: "half.txt", content: "half a fi" } },
        ],
        stopReason: "max_tokens",
        usage,
      },
    },
    say("I will split it up."),
  ]);
  const started = events.filter((e) => e.type === "tool.start");
  assert.equal(started.length, 0, "the truncated call must not start");
  await assert.rejects(fs.access(path.join(projectDir, "half.txt")));
  const answered = seen.results.flat().find((r) => r.id === "t1");
  assert.ok(answered?.isError);
  assert.match(answered?.output ?? "", /cut off at the output length limit/);
});

test("a failing check gets repair rounds, then the turn ends marked broken on screen", async () => {
  const { events, seen } = await run([
    {
      events: [],
      result: {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            input: {
              path: "package.json",
              content: JSON.stringify({
                name: "x",
                scripts: { typecheck: "echo type error && exit 1" },
              }),
            },
          },
        ],
        stopReason: "tool_use",
        usage,
      },
    },
    // Every later reply claims success in words and changes nothing.
    say("All done."),
  ]);
  const verifies = events.filter(
    (e) => e.type === "tool.end" && (e.call as { name: string }).name === "verify",
  );
  // One check, then three repair rounds each checked again.
  assert.equal(verifies.length, 4);
  assert.ok(verifies.every((e) => (e.call as { isError: boolean }).isError));
  assert.equal(seen.messages.filter((m) => /repair round \d of 3/.test(m)).length, 3);
  assert.ok(
    errorCodes(events).includes("ended_broken"),
    "the person is told the app is not working",
  );
});

test("a check that passes after one repair ends the turn normally", async () => {
  const { events } = await run([
    {
      events: [],
      result: {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            input: {
              path: "package.json",
              content: JSON.stringify({ name: "x", scripts: { typecheck: "exit 1" } }),
            },
          },
        ],
        stopReason: "tool_use",
        usage,
      },
    },
    say("Done."),
    {
      events: [],
      result: {
        toolCalls: [
          {
            id: "w2",
            name: "write_file",
            input: {
              path: "package.json",
              content: JSON.stringify({ name: "x", scripts: { typecheck: "exit 0" } }),
            },
          },
        ],
        stopReason: "tool_use",
        usage,
      },
    },
    say("Fixed."),
  ]);
  assert.ok(!errorCodes(events).includes("ended_broken"));
  const last = events.filter((e) => e.type === "tool.end").at(-1) as {
    call: { name: string; isError: boolean };
  };
  assert.equal(last.call.name, "verify");
  assert.equal(last.call.isError, false);
});

test("successful edits to one file never trip the per-file limit", async () => {
  const writes: Step[] = Array.from({ length: 10 }, (_, n) => ({
    events: [],
    result: {
      toolCalls: [
        { id: `w${n}`, name: "write_file", input: { path: "notes.txt", content: `v${n}\n` } },
      ],
      stopReason: "tool_use",
      usage,
    },
  }));
  const { events } = await run([...writes, say("Done.")], 14);
  const refused = events.filter(
    (e) => e.type === "tool.end" && (e.call as { isError: boolean }).isError,
  );
  assert.equal(refused.length, 0);
});
