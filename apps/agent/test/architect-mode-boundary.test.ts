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
 * 048 — Architect Mode's tool boundary. Same scripted-provider shape as
 * engineer-mode.test.ts. Architect Mode may write only under `architecture/`
 * and may run nothing; both are enforced in `session.ts` before the real
 * tool runs.
 */
function scriptedProvider(
  script: Array<{ events: ProviderEvent[]; result: TurnResult }>,
): ModelProvider {
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

async function collectTurn(url: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "plan something" }),
  });
  const text = await res.text();
  return text
    .split("\n\n")
    .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6))) as Array<{ type: string; [k: string]: unknown }>;
}

async function setup(
  script: Array<{ events: ProviderEvent[]; result: TurnResult }>,
  architectMode: boolean,
) {
  const workspaceDir = path.join(
    os.tmpdir(),
    `zelyq-architect-test-${Date.now()}-${Math.random()}`,
  );
  const projectId = "prj_am";
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
    maxTurnIterations: 6,
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
  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "ses_am", projectId, architectMode }),
  });
  assert.equal(created.status, 201, await created.text());
  return { base, workspaceDir, projectId, close: () => server.app.close() };
}

const done = {
  events: [{ type: "text" as const, text: "Done." }],
  result: {
    toolCalls: [],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 2, outputTokens: 2 },
  },
};
const step = (name: string, input: Record<string, unknown>) => ({
  events: [{ type: "text" as const, text: `Calling ${name}.` }],
  result: {
    toolCalls: [{ id: `c_${name}`, name, input }],
    stopReason: "tool_use" as const,
    usage: { inputTokens: 5, outputTokens: 5 },
  },
});

test("architect mode: a write outside architecture/ is refused at the boundary", async () => {
  const { base, workspaceDir, projectId, close } = await setup(
    [step("write_file", { path: "src/App.tsx", content: "x" }), done],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_am/prompt`);
    const end = events.find((e) => e.type === "tool.end") as {
      call: { isError: boolean; result: string };
    };
    assert.equal(end.call.isError, true);
    assert.match(end.call.result, /only write under architecture\//);
    await assert.rejects(fs.access(path.join(workspaceDir, projectId, "src/App.tsx")));
  } finally {
    await close();
  }
});

test("architect mode: architecture/../src escape is refused (path canonicalized)", async () => {
  const { base, close } = await setup(
    [step("write_file", { path: "architecture/../src/App.tsx", content: "x" }), done],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_am/prompt`);
    const end = events.find((e) => e.type === "tool.end") as { call: { isError: boolean } };
    assert.equal(end.call.isError, true);
  } finally {
    await close();
  }
});

test("architect mode: run_command is refused", async () => {
  const { base, close } = await setup(
    [step("run_command", { command: "npm i react" }), done],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_am/prompt`);
    const end = events.find((e) => e.type === "tool.end") as {
      call: { isError: boolean; result: string };
    };
    assert.equal(end.call.isError, true);
    assert.match(end.call.result, /does not run commands/);
  } finally {
    await close();
  }
});

test("architect mode: a write under architecture/ goes through", async () => {
  const { base, workspaceDir, projectId, close } = await setup(
    [step("write_file", { path: "architecture/README.md", content: "# Plan" }), done],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_am/prompt`);
    const end = events.find((e) => e.type === "tool.end") as { call: { isError: boolean } };
    assert.equal(end.call.isError, false);
    const written = await fs.readFile(
      path.join(workspaceDir, projectId, "architecture/README.md"),
      "utf8",
    );
    assert.match(written, /# Plan/);
  } finally {
    await close();
  }
});

test("architect mode off: writes and commands are unaffected — default behaviour", async () => {
  const { base, close } = await setup([step("run_command", { command: "echo hi" }), done], false);
  try {
    const events = await collectTurn(`${base}/sessions/ses_am/prompt`);
    const end = events.find((e) => e.type === "tool.end") as {
      call: { isError: boolean; result: string };
    };
    // Not refused by the architect boundary — it ran (echo succeeds).
    assert.doesNotMatch(end.call.result ?? "", /does not run commands/);
  } finally {
    await close();
  }
});

test("architect mode: editing architecture/ never triggers the verify step", async () => {
  // The project has a typecheck script, but Architect Mode only touches
  // markdown and `tsc` is not installed — verify would fail every turn and
  // pull the model into explaining a non-problem. It must not run.
  const { base, workspaceDir, projectId, close } = await setup(
    [step("write_file", { path: "architecture/requirements.md", content: "# reqs\n" }), done],
    true,
  );
  await fs.writeFile(
    path.join(workspaceDir, projectId, "package.json"),
    JSON.stringify({ name: "p", scripts: { typecheck: "tsc --noEmit" } }),
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_am/prompt`);
    const verifyEvents = events.filter(
      (e) =>
        (e.type === "tool.start" || e.type === "tool.end") &&
        (e.call as { name: string }).name === "verify",
    );
    assert.equal(verifyEvents.length, 0, "no verify tool events in Architect Mode");
  } finally {
    await close();
  }
});

test("default mode: editing files does still trigger verify (contrast)", async () => {
  const { base, workspaceDir, projectId, close } = await setup(
    [step("write_file", { path: "src/x.ts", content: "export const x = 1;\n" }), done],
    false,
  );
  await fs.writeFile(
    path.join(workspaceDir, projectId, "package.json"),
    JSON.stringify({ name: "p", scripts: { typecheck: 'node -e "process.exit(0)"' } }),
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_am/prompt`);
    const verifyStart = events.find(
      (e) => e.type === "tool.start" && (e.call as { name: string }).name === "verify",
    );
    assert.ok(verifyStart, "verify runs when neither Architect nor Engineer gating suppresses it");
  } finally {
    await close();
  }
});

test("server rejects engineerMode + architectMode set together", async () => {
  const { base, close } = await setup([done], false);
  try {
    const res = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "ses_both",
        projectId: "prj_am",
        engineerMode: true,
        architectMode: true,
      }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /mutually exclusive/);
  } finally {
    await close();
  }
});
