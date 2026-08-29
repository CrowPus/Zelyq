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
 * The Architect interviews on its own judgement — there is no scripted topic
 * list, no status-block schema, and no "Interview complete:" marker that
 * unlocks the package. What is still enforced in `session.ts`:
 *   - the Architect may write any package file whenever it decides it is
 *     ready to — the design files are never locked behind a gate;
 *   - on a turn whose message opens with stop / wait / pause / hold on, no
 *     builder is dispatched (writing is left alone).
 */
function scripted(steps: Array<{ events: ProviderEvent[]; result: TurnResult }>): ModelProvider {
  return {
    id: "anthropic",
    model: "scripted",
    createConversation() {
      let i = 0;
      const conversation: Conversation = {
        addUserMessage: () => undefined,
        addToolResults: () => undefined,
        async *stream() {
          const step = steps[Math.min(i++, steps.length - 1)]!;
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
const write = (p: string) => call("write_file", { path: p, content: `# ${p}\n` });

async function setup(
  steps: Array<{ events: ProviderEvent[]; result: TurnResult }>,
  history?: Array<Record<string, unknown>>,
) {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-interview-${Date.now()}-${Math.random()}`);
  const projectId = "prj_iv";
  await fs.mkdir(path.join(workspaceDir, projectId, "architecture"), { recursive: true });
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
      previewPortRange: [4991, 4999],
      previewHost: "127.0.0.1",
    },
  };
  const server = buildAgentServer(config, { providerFactory: () => scripted(steps) });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const body: Record<string, unknown> = { sessionId: "s_iv", projectId, architectMode: true };
  if (history) body.history = history;
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(created.status, 201, await created.text());
  return { base, workspaceDir, projectId, close: () => server.app.close() };
}

async function turn(base: string, message: string) {
  const res = await fetch(`${base}/sessions/s_iv/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const t = await res.text();
  return t
    .split("\n\n")
    .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6))) as Array<{ type: string; [k: string]: unknown }>;
}

const writeEnds = (events: Array<{ type: string; [k: string]: unknown }>) =>
  events.filter(
    (e) => e.type === "tool.end" && (e.call as { name: string }).name === "write_file",
  ) as Array<{ call: { isError: boolean; result: string } }>;

test("the design files are not gated — the Architect writes them when it decides it is ready", async () => {
  const { base, workspaceDir, projectId, close } = await setup([
    {
      events: [text("recording and drafting in one turn")],
      result: {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            input: { path: "architecture/requirements.md", content: "# reqs\n" },
          },
          {
            id: "w2",
            name: "write_file",
            input: { path: "architecture/decisions/0001-stack.md", content: "# adr\n" },
          },
          {
            id: "w3",
            name: "write_file",
            input: { path: "architecture/data-model.md", content: "# data\n" },
          },
          {
            id: "w4",
            name: "write_file",
            input: { path: "architecture/DESIGN.md", content: "# design\n" },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("first pass of the package written"),
  ]);
  try {
    const events = await turn(base, "here is what I want to build, go ahead");
    const ends = writeEnds(events);
    assert.equal(ends.length, 4);
    assert.ok(
      ends.every((e) => !e.call.isError),
      "no interview gate — every write lands",
    );
    for (const f of ["requirements.md", "decisions/0001-stack.md", "data-model.md", "DESIGN.md"]) {
      await fs.access(path.join(workspaceDir, projectId, "architecture", f));
    }
  } finally {
    await close();
  }
});

test("a write outside the package is still refused", async () => {
  const { base, workspaceDir, projectId, close } = await setup([
    call("write_file", { path: "src/App.tsx", content: "export const App = () => null;\n" }),
    say("tried to write code"),
  ]);
  try {
    const events = await turn(base, "just build it yourself");
    const ends = writeEnds(events);
    assert.ok(ends.length >= 1 && ends.every((e) => e.call.isError));
    await assert.rejects(fs.access(path.join(workspaceDir, projectId, "src/App.tsx")));
  } finally {
    await close();
  }
});

test("an interview turn that writes nothing is sent back to create requirements.md", async () => {
  // The model asks a question and ends the turn with no tool call. Because
  // architecture/requirements.md does not exist yet, the session forces it
  // back to write the file in the same turn before the reply lands.
  const { base, workspaceDir, projectId, close } = await setup([
    say("Great brief. **Question — deletion:** hard or soft delete for v1?"),
    {
      events: [text("recording what we have")],
      result: {
        toolCalls: [
          {
            id: "wr",
            name: "write_file",
            input: {
              path: "architecture/requirements.md",
              content: "# Requirements\n## Settled\n- A chat app.\n## Open\n- deletion semantics\n",
            },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("recorded — now, hard or soft delete?"),
  ]);
  try {
    await turn(base, "build me a small chat app, ChatGPT-style, Supabase backend");
    await fs.access(path.join(workspaceDir, projectId, "architecture/requirements.md"));
  } finally {
    await close();
  }
});

test("'package ready' over a package missing topology.json is sent back to finish it", async () => {
  const bigDesign = `Designed from first principles\n${"# section\nreal content line.\n".repeat(20)}`;
  const topo = JSON.stringify({
    layers: [
      { id: "c", label: "Client" },
      { id: "d", label: "Data" },
    ],
    nodes: [
      { id: "app", label: "App", layer: "c" },
      { id: "db", label: "DB", layer: "d" },
    ],
    edges: [{ from: "app", to: "db" }],
  });
  const { base, workspaceDir, projectId, close } = await setup([
    // Turn 1: declares ready with no tool call — package is missing topology.json.
    say("Architecture package ready: a small chat app."),
    // Turn 1 continued (after the nudge): writes topology.json.
    {
      events: [text("adding the system design")],
      result: {
        toolCalls: [
          {
            id: "t",
            name: "write_file",
            input: { path: "architecture/topology.json", content: topo },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("Architecture package ready: a small chat app."),
  ]);
  // Everything the completeness gate needs EXCEPT topology.json.
  const dir = path.join(workspaceDir, projectId, "architecture");
  await fs.mkdir(path.join(dir, "decisions"), { recursive: true });
  await fs.writeFile(path.join(dir, "decisions", "0001-stack.md"), "# 0001\nchoice.\n");
  for (const [f, body] of [
    ["requirements.md", "# reqs\nsettled: a chat app.\n"],
    ["data-model.md", "# data\none table.\n"],
    ["api.md", "# api\none query.\n"],
    ["DESIGN.md", bigDesign],
    ["infrastructure.md", "# infra\nstatic host.\n"],
    ["build-plan.md", "# plan\n## Task 1\n- do it.\n## Definition of Done\n- builds.\n"],
    ["build-context.md", "# ctx\nReact + Vite.\n"],
    ["risks.md", "# risks\nnone.\n"],
  ] as const) {
    await fs.writeFile(path.join(dir, f), body);
  }
  try {
    await turn(base, "the plan is approved, finalize it");
    await fs.access(path.join(dir, "topology.json"));
  } finally {
    await close();
  }
});

test("a stop turn still lets the Architect record where things stand", async () => {
  // "stop" does not freeze writing — the Architect can still note the state
  // or drop a handoff brief into requirements.md. Only dispatch is barred.
  const { base, workspaceDir, projectId, close } = await setup([
    write("architecture/requirements.md"),
    say("noted where we are — up to you whether to continue"),
  ]);
  try {
    const events = await turn(base, "stop — I need to rethink the scope");
    const ends = writeEnds(events);
    assert.ok(ends.length >= 1 && ends.every((e) => !e.call.isError));
    await fs.access(path.join(workspaceDir, projectId, "architecture/requirements.md"));
  } finally {
    await close();
  }
});

test("'Stop planning and build it yourself' — no builder is dispatched", async () => {
  const now = new Date().toISOString();
  const { base, workspaceDir, projectId, close } = await setup(
    [
      {
        events: [text("the user wants to skip the plan")],
        result: {
          toolCalls: [
            {
              id: "d1",
              name: "dispatch_task",
              input: { task: "build it", acceptanceCriteria: "works", files: ["src/App.tsx"] },
            },
          ],
          stopReason: "tool_use" as const,
          usage: { inputTokens: 5, outputTokens: 5 },
        },
      },
      say(
        "what you want now is the Engineer, not me — turn Architect Mode off and Engineer Mode on",
      ),
    ],
    [
      {
        id: "m0",
        sessionId: "s_iv",
        role: "user",
        content: "the plan is approved",
        createdAt: now,
      },
      {
        id: "m1",
        sessionId: "s_iv",
        role: "assistant",
        content: "Architecture package ready: the app.",
        createdAt: now,
      },
    ],
  );
  try {
    const events = await turn(
      base,
      "Stop planning. Write src/App.tsx yourself and make it functional.",
    );
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end, "a dispatch_task tool.end");
    assert.equal(end.call.isError, true);
    assert.match(end.call.result, /asked you to stop|Engineer, not/i);
    const orch = await (await fetch(`${base}/sessions/s_iv/orchestration`)).json();
    assert.equal(orch.subagents, 0, "no builder spawned");
    await assert.rejects(fs.access(path.join(workspaceDir, projectId, "src/App.tsx")));
  } finally {
    await close();
  }
});
