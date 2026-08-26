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
 * ZED-0001, Phase 1's structural anchor — the purpose-framing shape check on
 * the same forced post-loop gate the automatic-verification tests in
 * `verification.test.ts` already exercise. A scripted provider, same shape
 * as that file's, kept local for the same reason its own comment gives.
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
  engineerMode: boolean,
): Promise<{ base: string; close(): Promise<void> }> {
  const workspaceDir = path.join(
    os.tmpdir(),
    `zelyq-engineer-mode-test-${Date.now()}-${Math.random()}`,
  );
  const projectId = "prj_em";
  // No typecheck/build script — these tests isolate the structural anchor
  // from automatic verification, already covered on its own in
  // verification.test.ts. Both gates firing on the same scripted turn would
  // make it unclear which one produced a given hand-back.
  await fs.mkdir(path.join(workspaceDir, projectId), { recursive: true });

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
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4991, 4999],
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
    body: JSON.stringify({ sessionId: "ses_em", projectId, engineerMode }),
  });
  assert.equal(created.status, 201, await created.text());

  return { base, close: () => server.app.close() };
}

const writesAFileNoMarker = {
  events: [{ type: "text" as const, text: "Writing it." }],
  result: {
    toolCalls: [{ id: "call_1", name: "write_file", input: { path: "src/App.tsx", content: "x" } }],
    stopReason: "tool_use" as const,
    usage: { inputTokens: 5, outputTokens: 5 },
  },
};

const saysDoneNoMarker = {
  events: [{ type: "text" as const, text: "Done." }],
  result: {
    toolCalls: [],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 3, outputTokens: 2 },
  },
};

const saysDoneWithMarker = {
  events: [{ type: "text" as const, text: "Purpose: add the missing button. Done." }],
  result: {
    toolCalls: [],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 3, outputTokens: 2 },
  },
};

test("engineer mode: a turn that changes a file without the purpose marker is handed back once", async () => {
  const { base, close } = await setup(
    [writesAFileNoMarker, saysDoneNoMarker, saysDoneWithMarker],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    // Three script steps only resolve if the turn actually took the extra
    // round the hand-back forces — a turn that ended on the first "Done."
    // would never reach the third step at all.
    assert.equal(events.at(-1)?.type, "turn.end");
    const textDeltas = events
      .filter((event) => event.type === "text.delta")
      .map((event) => event.text)
      .join("");
    assert.match(textDeltas, /Purpose:/);
  } finally {
    await close();
  }
});

test("engineer mode: the hand-back happens only once, not forever, on a model that never adds the marker", async () => {
  const { base, close } = await setup(
    [writesAFileNoMarker, saysDoneNoMarker, saysDoneNoMarker, saysDoneNoMarker],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    // Bounded to one retry, not the iteration cap — the turn ends on the
    // second "Done.", the step right after the one hand-back.
    assert.equal(events.at(-1)?.type, "turn.end");
    const toolStarts = events.filter((event) => event.type === "tool.start");
    assert.equal(
      toolStarts.length,
      1,
      "only the original write_file call, no verify-style retries",
    );
  } finally {
    await close();
  }
});

test("engineer mode: a turn with the marker already present is not handed back", async () => {
  const { base, close } = await setup([writesAFileNoMarker, saysDoneWithMarker], true);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    assert.equal(events.at(-1)?.type, "turn.end");
    // Only two script steps provided — a hand-back would try to consume a
    // third and get the second step replayed instead, which the marker
    // check below would then also pass, making this assertion the honest
    // way to prove no extra round happened rather than just "it didn't crash".
    const toolStarts = events.filter((event) => event.type === "tool.start");
    assert.equal(toolStarts.length, 1);
  } finally {
    await close();
  }
});

test("engineer mode: a turn that changes nothing is exempt, marker or not", async () => {
  const readsOnly = {
    events: [{ type: "text" as const, text: "Just looking, nothing to change." }],
    result: {
      toolCalls: [],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 2, outputTokens: 2 },
    },
  };
  const { base, close } = await setup([readsOnly], true);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    assert.equal(events.at(-1)?.type, "turn.end");
    const errorEvents = events.filter((event) => event.type === "error");
    assert.equal(errorEvents.length, 0);
  } finally {
    await close();
  }
});

test("engineer mode off: a file changed with no marker is never handed back — default behavior unchanged", async () => {
  const { base, close } = await setup([writesAFileNoMarker, saysDoneNoMarker], false);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    assert.equal(events.at(-1)?.type, "turn.end");
    const toolStarts = events.filter((event) => event.type === "tool.start");
    assert.equal(toolStarts.length, 1, "no structural hand-back outside engineer mode");
  } finally {
    await close();
  }
});
