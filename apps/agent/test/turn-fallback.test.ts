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
 * A long tool-heavy turn can end with a stored message of length zero.
 * Every one of its round-trips called a tool and never once came back with
 * `toolCalls.length === 0` — the loop's only path to its
 * normal exit — so it just fell out when `iteration` reached
 * `maxTurnIterations`, taking whatever `assistantText` happened to hold
 * (nothing) straight into `turn.end`. These tests force that same shape
 * with a scripted provider that never stops calling tools, and check the
 * backstop that followed: a synthesized, honest summary instead of silence.
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
  return { id: "anthropic", model: "scripted", createConversation: () => conversation };
}

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

async function setup(
  script: Array<{ events: ProviderEvent[]; result: TurnResult }>,
  maxIterations = 5,
): Promise<{ base: string; close(): Promise<void> }> {
  const workspaceDir = path.join(
    os.tmpdir(),
    `zelyq-turn-fallback-test-${Date.now()}-${Math.random()}`,
  );
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
      previewPortRange: [4981, 4989],
      previewHost: "127.0.0.1",
    },
  };

  const server = buildAgentServer(config, { providerFactory: () => scriptedProvider(script) });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "ses_fb", projectId: "prj_fb" }),
  });
  assert.equal(created.status, 201, await created.text());

  return { base, close: () => server.app.close() };
}

/** A step that writes one file and says nothing at all. */
function writesWithoutText(fileName: string, callId: string) {
  return {
    events: [],
    result: {
      toolCalls: [{ id: callId, name: "write_file", input: { path: fileName, content: "x" } }],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
}

test("a turn that never stops calling tools still ends with a non-empty, honest summary", async () => {
  // 4 steps, every one a tool call, against a 3-iteration budget — the
  // loop must fall out of the `for` on iteration 3 having never reached
  // its own internal break.
  const { base, close } = await setup(
    [
      writesWithoutText("src/a.tsx", "call_1"),
      writesWithoutText("src/b.tsx", "call_2"),
      writesWithoutText("src/c.tsx", "call_3"),
      writesWithoutText("src/d.tsx", "call_4"),
    ],
    3,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_fb/prompt`);
    const end = events.at(-1) as {
      type: string;
      stopReason?: string;
      message?: { content: string; toolCalls: unknown[] };
    };
    assert.equal(end.type, "turn.end");
    assert.equal(end.stopReason, "max_iterations");
    const content = end.message?.content ?? "";
    assert.notEqual(content.length, 0, "26 files changed, zero explanation");
    assert.match(content, /step limit/);
    // Only 3 iterations ran (the budget), so only 3 files were actually
    // written — the summary must name exactly those, not the 4th the
    // script would have produced with a bigger budget.
    assert.match(content, /src\/a\.tsx/);
    assert.match(content, /src\/b\.tsx/);
    assert.match(content, /src\/c\.tsx/);
    assert.doesNotMatch(content, /src\/d\.tsx/);
    assert.equal(end.message?.toolCalls.length, 3);

    // The real bug: the server's WS gateway builds its own copy of the
    // message purely from `text.delta` events, then discards this event's
    // own `message` — see the comment above where this is emitted in
    // session.ts. A fix that only patched `turn.end`'s payload would pass
    // every assertion above and still leave that gateway's reconstruction
    // empty, the exact shape of the original bug report.
    const textDeltas = events
      .filter((event) => event.type === "text.delta")
      .map((event) => event.text)
      .join("");
    assert.equal(
      textDeltas,
      content,
      "the fallback must stream as text.delta too, not only ride inside turn.end's own message",
    );
  } finally {
    await close();
  }
});

test("a turn that ends normally but with genuinely empty model text still gets a synthesized summary", async () => {
  // The model calls one tool, then stops on its own (toolCalls: []) —
  // the loop's ordinary exit — but never produced any text either time.
  // This must not be confused with hitting the iteration cap: the model
  // chose to stop, it just said nothing while doing it.
  const { base, close } = await setup(
    [
      writesWithoutText("src/only.tsx", "call_1"),
      {
        events: [],
        result: {
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 3, outputTokens: 0 },
        },
      },
    ],
    5,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_fb/prompt`);
    const end = events.at(-1) as {
      type: string;
      stopReason?: string;
      message?: { content: string };
    };
    assert.equal(end.type, "turn.end");
    // The model did choose to stop here, unlike the test above — the
    // budget was never the issue, so this must not be reported as if it
    // were.
    assert.equal(end.stopReason, "end_turn");
    const content = end.message?.content ?? "";
    assert.notEqual(content.length, 0);
    assert.match(content, /finished without providing a summary/);
    assert.match(content, /src\/only\.tsx/);
    // Independent review: the first version of this test only checked
    // `message.content`, which is exactly the shape of hole that let the
    // gateway-discarding bug through in the first place — a version that
    // only streams the fallback on the iteration-cap path would pass every
    // assertion above and still leave this, the normal-exit empty-text
    // path, silently broken for anyone listening through the gateway.
    const textDeltas = events
      .filter((event) => event.type === "text.delta")
      .map((event) => event.text)
      .join("");
    assert.equal(textDeltas, content);
  } finally {
    await close();
  }
});

test("a turn that writes real closing text keeps exactly that text — the fallback never overwrites a real summary", async () => {
  const { base, close } = await setup(
    [
      writesWithoutText("src/real.tsx", "call_1"),
      {
        events: [{ type: "text" as const, text: "Added the missing button." }],
        result: {
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 3, outputTokens: 4 },
        },
      },
    ],
    5,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_fb/prompt`);
    const end = events.at(-1) as {
      type: string;
      stopReason?: string;
      message?: { content: string };
    };
    assert.equal(end.stopReason, "end_turn");
    assert.equal(end.message?.content, "Added the missing button.");
  } finally {
    await close();
  }
});

test("a stray sentence early in a turn does not disable the checkpoint backstop", async () => {
  // The near-miss: one line of real text
  // on the way in, then heads-down tool calls until the budget runs out.
  // Checking only "is the text empty" would let this slip through with
  // just "Working on it." as the entire account of a turn that actually
  // did real work — the reconstructed summary must still be appended.
  const { base, close } = await setup(
    [
      {
        events: [{ type: "text" as const, text: "Working on it." }],
        result: {
          toolCalls: [
            { id: "call_1", name: "write_file", input: { path: "src/x.tsx", content: "x" } },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 5, outputTokens: 5 },
        },
      },
      writesWithoutText("src/y.tsx", "call_2"),
      writesWithoutText("src/z.tsx", "call_3"),
    ],
    2,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_fb/prompt`);
    const end = events.at(-1) as {
      type: string;
      stopReason?: string;
      message?: { content: string };
    };
    assert.equal(end.stopReason, "max_iterations");
    const content = end.message?.content ?? "";
    // The model's own sentence must survive, not be thrown away —
    assert.match(content, /^Working on it\./);
    // — but it is not, on its own, an honest account of a capped turn.
    assert.match(content, /step limit/);
    assert.match(content, /src\/x\.tsx/);
    assert.match(content, /src\/y\.tsx/);
    const textDeltas = events
      .filter((event) => event.type === "text.delta")
      .map((event) => event.text)
      .join("");
    assert.equal(textDeltas, content);
  } finally {
    await close();
  }
});

test("whitespace-only text is appended to, not replaced by, the fallback — text.delta and content must still agree", async () => {
  const { base, close } = await setup(
    [
      {
        events: [{ type: "text" as const, text: "  \n\n " }],
        result: {
          toolCalls: [],
          stopReason: "end_turn" as const,
          usage: { inputTokens: 2, outputTokens: 1 },
        },
      },
    ],
    5,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_fb/prompt`);
    const end = events.at(-1) as {
      type: string;
      stopReason?: string;
      message?: { content: string };
    };
    assert.equal(end.stopReason, "end_turn");
    const content = end.message?.content ?? "";
    const textDeltas = events
      .filter((event) => event.type === "text.delta")
      .map((event) => event.text)
      .join("");
    // The exact invariant a straight `assistantText = fallback` broke: the
    // gateway persists whatever it saw stream by, whitespace included, so
    // this event's own content has to match that, not silently drop it.
    assert.equal(textDeltas, content);
    assert.match(content, /finished without providing a summary/);
  } finally {
    await close();
  }
});

test("a refusal does not get a synthetic 'no summary' body layered underneath it", async () => {
  const { base, close } = await setup(
    [
      {
        events: [],
        result: {
          toolCalls: [],
          stopReason: "refusal" as const,
          refusalReason: "that would require fabricating credentials",
          usage: { inputTokens: 4, outputTokens: 0 },
        },
      },
    ],
    5,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_fb/prompt`);
    const errorEvent = events.find((event) => event.type === "error");
    assert.ok(errorEvent, "the refusal must still surface its own error event");
    const end = events.at(-1) as {
      type: string;
      stopReason?: string;
      message?: { content: string };
    };
    assert.equal(end.type, "turn.end");
    // Honest about what actually happened, not the generic "end_turn" a
    // refusal used to report before this.
    assert.equal(end.stopReason, "refusal");
    assert.equal(
      end.message?.content,
      "",
      "no fallback text belongs underneath a refusal — the error event already explains it",
    );
  } finally {
    await close();
  }
});
