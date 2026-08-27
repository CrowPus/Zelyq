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
 * 048 — the Architect interviews before it designs, and it stops when told to.
 *
 * Two structural gates, enforced in `session.ts`, not in prose:
 *   - until the "Interview complete:" line is written, the only package files
 *     the Architect may write are requirements.md and README.md;
 *   - a user turn that opens with stop / wait / pause / hold on writes nothing.
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

test("during the interview, only requirements.md and README.md may be written", async () => {
  const { base, workspaceDir, projectId, close } = await setup([
    {
      events: [text("recording and drafting")],
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
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("asked the next question"),
  ]);
  try {
    const events = await turn(base, "here is the purpose and the users");
    const ends = writeEnds(events);
    // requirements.md lands; the two design files are refused with the interview message.
    await fs.access(path.join(workspaceDir, projectId, "architecture/requirements.md"));
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/decisions/0001-stack.md")),
    );
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/data-model.md")),
    );
    const refused = ends.filter((e) => e.call.isError);
    assert.equal(refused.length, 2);
    assert.ok(refused.every((e) => /interview is not closed/i.test(e.call.result)));
  } finally {
    await close();
  }
});

test("after 'Interview complete:' the design files open up", async () => {
  const { base, workspaceDir, projectId, close } = await setup([
    {
      events: [text("Interview complete: proceeding to the design.")],
      result: {
        toolCalls: [],
        stopReason: "end_turn" as const,
        usage: { inputTokens: 2, outputTokens: 2 },
      },
    },
    {
      events: [text("writing the first ADR")],
      result: {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            input: { path: "architecture/decisions/0001-stack.md", content: "# adr\n" },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("ADR written"),
  ]);
  try {
    await turn(base, "that's enough, design what you have");
    const events = await turn(base, "go on");
    const ends = writeEnds(events);
    assert.ok(ends.length >= 1 && ends.every((e) => !e.call.isError), "the ADR write goes through");
    await fs.access(path.join(workspaceDir, projectId, "architecture/decisions/0001-stack.md"));
  } finally {
    await close();
  }
});

test("a resumed session whose history closed the interview can write design files at once", async () => {
  const now = new Date().toISOString();
  const { base, workspaceDir, projectId, close } = await setup(
    [write("architecture/data-model.md"), say("wrote the data model")],
    [
      {
        id: "m0",
        sessionId: "s_iv",
        role: "user",
        content: "design what you have",
        createdAt: now,
      },
      {
        id: "m1",
        sessionId: "s_iv",
        role: "assistant",
        content: "Interview complete: moving on.",
        createdAt: now,
      },
    ],
  );
  try {
    const events = await turn(base, "continue");
    const ends = writeEnds(events);
    assert.ok(ends.length >= 1 && ends.every((e) => !e.call.isError));
    await fs.access(path.join(workspaceDir, projectId, "architecture/data-model.md"));
  } finally {
    await close();
  }
});

test("a user turn that opens with 'stop' writes nothing", async () => {
  const { base, workspaceDir, projectId, close } = await setup([
    write("architecture/requirements.md"),
    say("stopping as asked"),
  ]);
  try {
    const events = await turn(base, "stop — I need to rethink the scope");
    const ends = writeEnds(events);
    assert.ok(ends.length >= 1 && ends.every((e) => e.call.isError));
    assert.ok(ends.every((e) => /asked you to stop/i.test(e.call.result)));
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/requirements.md")),
    );
  } finally {
    await close();
  }
});

test("'Stop planning and build it yourself' is still a stop — no writes, no dispatch", async () => {
  const now = new Date().toISOString();
  const { base, workspaceDir, projectId, close } = await setup(
    [
      {
        events: [text("racing the design")],
        result: {
          toolCalls: [
            {
              id: "w1",
              name: "write_file",
              input: { path: "architecture/decisions/0001.md", content: "# adr\n" },
            },
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
      say("understood — I design, I do not build"),
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
    const ends = events.filter((e) => e.type === "tool.end") as Array<{
      call: { name: string; isError: boolean; result: string };
    }>;
    assert.ok(ends.length >= 1);
    assert.ok(
      ends.every((e) => e.call.isError),
      "every tool call this turn is refused",
    );
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/decisions/0001.md")),
    );
  } finally {
    await close();
  }
});
