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
 * A provider that replays a fixed script — same shape as turn.test.ts's, kept
 * local here so each test can give it a different number of round-trips.
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

/** One project, seeded with the given package.json before the turn runs. */
async function setup(
  script: Array<{ events: ProviderEvent[]; result: TurnResult }>,
  packageJson: object | null,
): Promise<{ base: string; close(): Promise<void> }> {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-verify-test-${Date.now()}-${Math.random()}`);
  const projectId = "prj_verify";
  if (packageJson) {
    const root = path.join(workspaceDir, projectId);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(packageJson));
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
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4980, 4990],
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
    body: JSON.stringify({ sessionId: "ses_verify", projectId }),
  });
  assert.equal(created.status, 201);

  return { base, close: () => server.app.close() };
}

/** The step every script here uses to change a file. */
const writesAFile = {
  events: [{ type: "text" as const, text: "Writing it." }],
  result: {
    toolCalls: [{ id: "call_1", name: "write_file", input: { path: "src/App.tsx", content: "x" } }],
    stopReason: "tool_use" as const,
    usage: { inputTokens: 5, outputTokens: 5 },
  },
};

const saysDone = {
  events: [{ type: "text" as const, text: "Done." }],
  result: {
    toolCalls: [],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 3, outputTokens: 2 },
  },
};

test("a failing typecheck is handed back instead of ending the turn", async () => {
  const { base, close } = await setup([writesAFile, saysDone, saysDone], {
    scripts: { typecheck: "exit 1" },
  });
  try {
    const events = await collectTurn(`${base}/sessions/ses_verify/prompt`);
    const verifyCall = events.find(
      (event) => event.type === "tool.end" && (event.call as { name: string }).name === "verify",
    );
    assert.ok(verifyCall, "expected an automatic verify step");
    assert.equal((verifyCall!.call as { isError: boolean }).isError, true);

    // The turn did not end on the model's first "Done." — it took the extra
    // round the script only provides a third step for.
    assert.equal(events.at(-1)?.type, "turn.end");
  } finally {
    await close();
  }
});

test("a passing typecheck does not add an extra round", async () => {
  const { base, close } = await setup([writesAFile, saysDone], {
    scripts: { typecheck: "exit 0" },
  });
  try {
    const events = await collectTurn(`${base}/sessions/ses_verify/prompt`);
    const verifyCall = events.find(
      (event) => event.type === "tool.end" && (event.call as { name: string }).name === "verify",
    );
    assert.ok(verifyCall);
    assert.equal((verifyCall!.call as { isError: boolean }).isError, false);
    assert.equal(events.at(-1)?.type, "turn.end");
  } finally {
    await close();
  }
});

test("no typecheck or build script means no verify step at all", async () => {
  const { base, close } = await setup([writesAFile, saysDone], { scripts: { dev: "vite" } });
  try {
    const events = await collectTurn(`${base}/sessions/ses_verify/prompt`);
    assert.ok(
      !events.some(
        (event) => event.type === "tool.end" && (event.call as { name: string }).name === "verify",
      ),
      "expected no automatic verification step when the project declares neither script",
    );
    assert.equal(events.at(-1)?.type, "turn.end");
  } finally {
    await close();
  }
});

test("no file changes means no verification at all", async () => {
  // A turn that never writes anything has nothing to verify, regardless of
  // what the project declares.
  const readsOnly = {
    events: [{ type: "text" as const, text: "Just looking." }],
    result: {
      toolCalls: [],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 2, outputTokens: 2 },
    },
  };
  const { base, close } = await setup([readsOnly], { scripts: { typecheck: "exit 1" } });
  try {
    const events = await collectTurn(`${base}/sessions/ses_verify/prompt`);
    assert.ok(
      !events.some(
        (event) => event.type === "tool.end" && (event.call as { name: string }).name === "verify",
      ),
    );
    assert.equal(events.at(-1)?.type, "turn.end");
  } finally {
    await close();
  }
});
