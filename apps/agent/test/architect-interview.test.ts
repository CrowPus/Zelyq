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
 * The Architect interviews before it designs, and it stops when told to.
 *
 * Structural, enforced in `session.ts` (the rest — explaining an unfinished
 * plan, pointing an insistent user at the Engineer — is the model's job):
 *   - until the "Interview complete:" line is written, the only package files
 *     the Architect may write are requirements.md and README.md;
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

// An 8-row status block, every topic answered, so the completion
// line is honoured.
const STATUS_BLOCK = [
  "| Topic | Status | Source | Note |",
  "| --- | --- | --- | --- |",
  "| Purpose and users | answered | user | ok |",
  "| Core functional requirements | answered | user | ok |",
  "| Explicit non-goals | answered | user | ok |",
  "| Constraints | answered | user | ok |",
  "| Data | answered | user | ok |",
  "| External dependencies | answered | user | ok |",
  "| Failure expectations | answered | user | ok |",
  "| Acceptance criteria | answered | user | ok |",
  "",
].join("\n");

test("after 'Interview complete:' the design files open up", async () => {
  const { base, workspaceDir, projectId, close } = await setup([
    {
      events: [text("recording the interview state")],
      result: {
        toolCalls: [
          {
            id: "wr",
            name: "write_file",
            input: { path: "architecture/requirements.md", content: STATUS_BLOCK },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("Interview complete: proceeding to the design."),
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

test("a 'blocked' status row keeps 'Interview complete:' from taking effect", async () => {
  const blockedBlock = STATUS_BLOCK.replace(
    "| Data | answered | user | ok |",
    "| Data | blocked | | need the retention policy |",
  );
  const { base, workspaceDir, projectId, close } = await setup([
    {
      events: [text("recording state")],
      result: {
        toolCalls: [
          {
            id: "wr",
            name: "write_file",
            input: { path: "architecture/requirements.md", content: blockedBlock },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("Interview complete: proceeding."),
    {
      events: [text("trying to write an ADR")],
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
    say("done"),
  ]);
  try {
    await turn(base, "design what you have");
    const events = await turn(base, "go on");
    const ends = writeEnds(events);
    assert.ok(
      ends.length >= 1 && ends.every((e) => e.call.isError),
      "the ADR write is still refused",
    );
    assert.ok(ends.every((e) => /interview is not closed/i.test(e.call.result)));
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/decisions/0001-stack.md")),
    );
  } finally {
    await close();
  }
});

test("the word 'blocked' in unrelated prose does not stop the interview closing", async () => {
  // Regression: the check was matching any line containing "blocked" plus a
  // colon — e.g. "Analytics: silent no-op if blocked or unavailable" — and
  // wedging the session in a re-declare loop.
  const reqs = `${STATUS_BLOCK}\n\n## External dependencies\n- Analytics: non-essential. Failure mode: silent no-op if blocked or unavailable.\n`;
  const { base, workspaceDir, projectId, close } = await setup([
    {
      events: [text("recording state")],
      result: {
        toolCalls: [
          {
            id: "wr",
            name: "write_file",
            input: { path: "architecture/requirements.md", content: reqs },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("Interview complete: moving on."),
    {
      events: [text("writing the data model")],
      result: {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            input: { path: "architecture/data-model.md", content: "# data model\n" },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("done"),
  ]);
  try {
    await turn(base, "go on");
    const events = await turn(base, "continue");
    const ends = writeEnds(events);
    assert.ok(
      ends.length >= 1 && ends.every((e) => !e.call.isError),
      "the design write goes through",
    );
    await fs.access(path.join(workspaceDir, projectId, "architecture/data-model.md"));
  } finally {
    await close();
  }
});

test("a real 'blocked' row refuses the marker only once, then lets it through", async () => {
  const blockedBlock = STATUS_BLOCK.replace(
    "| Data | answered | user | ok |",
    "| Data | blocked | | need retention policy |",
  );
  const { base, workspaceDir, projectId, close } = await setup([
    {
      events: [text("state, still blocked")],
      result: {
        toolCalls: [
          {
            id: "wr",
            name: "write_file",
            input: { path: "architecture/requirements.md", content: blockedBlock },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("Interview complete: first try."),
    say("Interview complete: second try — proceeding regardless."),
    {
      events: [text("writing the data model")],
      result: {
        toolCalls: [
          {
            id: "w1",
            name: "write_file",
            input: { path: "architecture/data-model.md", content: "# data model\n" },
          },
        ],
        stopReason: "tool_use" as const,
        usage: { inputTokens: 5, outputTokens: 5 },
      },
    },
    say("done"),
  ]);
  try {
    await turn(base, "go on"); // writes blocked block + first marker → refused once
    await turn(base, "the retention policy is 2 years, keep going"); // second marker → honoured
    const events = await turn(base, "continue"); // design write
    const ends = writeEnds(events);
    assert.ok(
      ends.length >= 1 && ends.every((e) => !e.call.isError),
      "the design write goes through",
    );
    await fs.access(path.join(workspaceDir, projectId, "architecture/data-model.md"));
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

test("a stop turn still lets the Architect record where things stand", async () => {
  // "stop" no longer freezes writing — the Architect can still note the state
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
