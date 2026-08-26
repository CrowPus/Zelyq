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
  TurnResult,
} from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/**
 * 047 Phase 3 — the Architect dispatches bounded builder sub-agents.
 *
 * One scripted provider serves both the parent (Architect) and every child
 * (builder): `createConversation` is called once per `AgentSession`, so a
 * queue of scripts hands script[0] to the parent and script[1..] to the
 * children in dispatch order.
 */
function queuedProvider(
  scripts: Array<Array<{ events: ProviderEvent[]; result: TurnResult }>>,
): ModelProvider {
  let session = 0;
  return {
    id: "anthropic",
    model: "scripted",
    createConversation() {
      const script = scripts[Math.min(session++, scripts.length - 1)]!;
      let i = 0;
      const conversation: Conversation = {
        addUserMessage: () => undefined,
        addToolResults: () => undefined,
        async *stream() {
          const step = script[Math.min(i++, script.length - 1)]!;
          for (const e of step.events) yield e;
          return step.result;
        },
      };
      return conversation;
    },
  };
}

const text = (t: string) => ({ type: "text" as const, text: t });
const say = (t: string): { events: ProviderEvent[]; result: TurnResult } => ({
  events: [text(t)],
  result: {
    toolCalls: [],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 2, outputTokens: 2 },
  },
});
const call = (name: string, input: Record<string, unknown>, id = `c_${name}_${Math.random()}`) => ({
  events: [text(`calling ${name}`)],
  result: {
    toolCalls: [{ id, name, input }],
    stopReason: "tool_use" as const,
    usage: { inputTokens: 5, outputTokens: 5 },
  },
});
const dispatch = (task: string, files: string[]) =>
  call("dispatch_task", {
    task,
    acceptanceCriteria: "the file exists",
    files,
  });
const builderWrites = (p: string) => [
  call("write_file", { path: p, content: `// ${p}\nexport const x = 1;\n` }),
  say(`wrote ${p}`),
];

async function setup(
  scripts: Array<Array<{ events: ProviderEvent[]; result: TurnResult }>>,
  mode: "architect" | "engineer" | "none",
) {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-orch-${Date.now()}-${Math.random()}`);
  const projectId = "prj_orch";
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
    apiKey: "k",
    maxTurnIterations: 8,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4971, 4979],
      previewHost: "127.0.0.1",
    },
  };
  // One shared provider instance across parent + every child, so its internal
  // session counter advances: parent gets script[0], child N gets script[N].
  const provider = queuedProvider(scripts);
  const server = buildAgentServer(config, { providerFactory: () => provider });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const body: Record<string, unknown> = { sessionId: "s_orch", projectId };
  if (mode === "architect") body.architectMode = true;
  if (mode === "engineer") body.engineerMode = true;
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(created.status, 201, await created.text());
  return { base, workspaceDir, projectId, close: () => server.app.close() };
}

async function turn(base: string): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const res = await fetch(`${base}/sessions/s_orch/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "go" }),
  });
  const t = await res.text();
  return t
    .split("\n\n")
    .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)));
}

test("dispatch_task runs a bounded builder and returns its report + changed files", async () => {
  const parent = [dispatch("build the widget", ["src/widget.ts"]), say("done, task complete")];
  const child = builderWrites("src/widget.ts");
  const { base, workspaceDir, projectId, close } = await setup([parent, child], "architect");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } };
    assert.ok(end, "a dispatch_task tool.end event");
    assert.equal(end.call.isError, false);
    assert.match(end.call.result, /Builder #1 finished/);
    assert.match(end.call.result, /src\/widget\.ts/);
    assert.match(end.call.result, /wrote src\/widget\.ts/); // the builder's own report
    const written = await fs.readFile(path.join(workspaceDir, projectId, "src/widget.ts"), "utf8");
    assert.match(written, /export const x/);
  } finally {
    await close();
  }
});

test("two dispatch_task calls in one turn run in parallel; the run counts both", async () => {
  const parent = [
    {
      events: [text("dispatching two")],
      result: {
        toolCalls: [
          {
            id: "d1",
            name: "dispatch_task",
            input: { task: "a", acceptanceCriteria: "x", files: ["src/a.ts"] },
          },
          {
            id: "d2",
            name: "dispatch_task",
            input: { task: "b", acceptanceCriteria: "x", files: ["src/b.ts"] },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("both done"),
  ];
  const { base, workspaceDir, projectId, close } = await setup(
    [parent, builderWrites("src/a.ts"), builderWrites("src/b.ts")],
    "architect",
  );
  try {
    await turn(base);
    for (const f of ["src/a.ts", "src/b.ts"]) {
      await fs.access(path.join(workspaceDir, projectId, f));
    }
    const orch = await (await fetch(`${base}/sessions/s_orch/orchestration`)).json();
    assert.equal(orch.subagents, 2);
  } finally {
    await close();
  }
});

test("the kill switch refuses further dispatch, on this turn and after", async () => {
  const parent = [
    dispatch("build a", ["src/a.ts"]),
    dispatch("build b", ["src/b.ts"]),
    say("stopped"),
  ];
  const { base, workspaceDir, projectId, close } = await setup(
    [parent, builderWrites("src/a.ts"), builderWrites("src/b.ts")],
    "architect",
  );
  try {
    // Stop before the turn runs.
    const stopped = await (
      await fetch(`${base}/sessions/s_orch/stop-orchestration`, { method: "POST" })
    ).json();
    assert.equal(stopped.killed, true);
    const events = await turn(base);
    const dispatchEnds = events.filter(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as Array<{ call: { isError: boolean; result: string } }>;
    assert.ok(dispatchEnds.length >= 1);
    assert.ok(
      dispatchEnds.every((e) => e.call.isError && /stopped/i.test(e.call.result)),
      "every dispatch after a stop is refused",
    );
    await assert.rejects(fs.access(path.join(workspaceDir, projectId, "src/a.ts")));
  } finally {
    await close();
  }
});

test("dispatch_task is refused outside Architect Mode", async () => {
  // An engineer-mode session's model should not have the tool, but if it emits
  // the call anyway the handler refuses it.
  const parent = [dispatch("build", ["src/x.ts"]), say("n/a")];
  const { base, close } = await setup([parent, builderWrites("src/x.ts")], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } } | undefined;
    // Either the tool wasn't offered (no call happened) or the handler refused it.
    if (end) {
      assert.equal(end.call.isError, true);
      assert.match(end.call.result, /only available in Architect Mode/);
    }
  } finally {
    await close();
  }
});
