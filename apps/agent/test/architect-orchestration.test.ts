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
const dispatch = (
  task: string,
  files: string[],
  acceptanceCriteria = "npm run build passes and the widget renders",
) =>
  call("dispatch_task", {
    task,
    acceptanceCriteria,
    files,
  });
const builderWrites = (p: string) => [
  call("write_file", { path: p, content: `// ${p}\nexport const x = 1;\n` }),
  say(`wrote ${p}`),
];

async function setup(
  scripts: Array<Array<{ events: ProviderEvent[]; result: TurnResult }>>,
  mode: "architect" | "engineer" | "none",
  { readyPackage = true }: { readyPackage?: boolean } = {},
) {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-orch-${Date.now()}-${Math.random()}`);
  const projectId = "prj_orch";
  await fs.mkdir(path.join(workspaceDir, projectId, "architecture", "decisions"), {
    recursive: true,
  });
  if (readyPackage) {
    // A finished-enough package so the dispatch gate lets a build through.
    await fs.writeFile(
      path.join(workspaceDir, projectId, "architecture", "build-plan.md"),
      "# Build plan\n\n## Task 1 — the widget\n- Files: src/widget.ts\n- Do: export a const.\n- Acceptance: the file exists and exports x.\n- Status: not started\n\n## Task 2 — the other widget\n- Files: src/other.ts\n- Do: export a const.\n- Acceptance: the file exists.\n- Status: not started\n",
    );
    await fs.writeFile(
      path.join(workspaceDir, projectId, "architecture", "decisions", "0001-stack.md"),
      "# 0001 — stack\nContext: x. Alternatives: a, b. Chosen: a. Consequence: y. Status: accepted.\n",
    );
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
  if (readyPackage && mode === "architect") {
    // A prior turn declared the package ready — so this session's first
    // "build it" turn is a legitimate, user-approved dispatch.
    const now = new Date().toISOString();
    body.history = [
      {
        id: "m0",
        sessionId: "s_orch",
        role: "user",
        content: "the plan is approved",
        createdAt: now,
      },
      {
        id: "m1",
        sessionId: "s_orch",
        role: "assistant",
        content: "Architecture package ready: the widget suite.",
        createdAt: now,
      },
    ];
  }
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
            input: {
              task: "a",
              acceptanceCriteria: "npm run build passes; a renders",
              files: ["src/a.ts"],
            },
          },
          {
            id: "d2",
            name: "dispatch_task",
            input: {
              task: "b",
              acceptanceCriteria: "npm run build passes; b renders",
              files: ["src/b.ts"],
            },
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

test("dispatch_task is refused when the design is not finished (no build-plan)", async () => {
  // The Architect (or an impatient user) tries to build during the interview —
  // no architecture/build-plan.md, no decisions/. Must refuse, spawn nothing.
  const parent = [
    dispatch("start building now", ["src/x.ts"]),
    say("understood, finishing the design"),
  ];
  const { base, workspaceDir, projectId, close } = await setup(
    [parent, builderWrites("src/x.ts")],
    "architect",
    { readyPackage: false },
  );
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } };
    assert.ok(end, "a dispatch_task tool.end");
    assert.equal(end.call.isError, true);
    assert.match(
      end.call.result,
      /have not declared the package ready|design is not finished|no architecture\/build-plan/i,
    );
    await assert.rejects(fs.access(path.join(workspaceDir, projectId, "src/x.ts")));
    const orch = await (await fetch(`${base}/sessions/s_orch/orchestration`)).json();
    assert.equal(orch.subagents, 0, "no builder was spawned");
  } finally {
    await close();
  }
});

test("architect mode caps new files under architecture/ per turn — no whole-package dump", async () => {
  // Six write_file calls to new architecture/ paths in one turn. Only the
  // first four land; 5 and 6 are refused. The design has to be built up over
  // turns, not dumped at once. (Decision records — 050 R2.1's allowlist only
  // accepts real package files under architecture/.)
  const writes = [1, 2, 3, 4, 5, 6].map((i) =>
    call("write_file", {
      path: `architecture/decisions/000${i}-choice-${i}.md`,
      content: `# ADR ${i}\n`,
    }),
  );
  // readyPackage seeds a prior "package ready" turn, which also unlocks the
  // design files past the interview gate — so this test exercises the
  // per-turn new-file cap in isolation.
  const { base, workspaceDir, projectId, close } = await setup(
    [[...writes, say("wrote the package")]],
    "architect",
    { readyPackage: true },
  );
  try {
    const events = await turn(base);
    const ends = events.filter(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "write_file",
    ) as Array<{ call: { isError: boolean; result: string } }>;
    const ok = ends.filter((e) => !e.call.isError).length;
    const refused = ends.filter((e) => e.call.isError);
    assert.equal(ok, 4, "exactly four new files land");
    assert.ok(
      refused.length >= 1 && refused.every((e) => /created 4 new files/i.test(e.call.result)),
    );
    for (const i of [1, 2, 3, 4]) {
      await fs.access(
        path.join(workspaceDir, projectId, `architecture/decisions/000${i}-choice-${i}.md`),
      );
    }
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/decisions/0005-choice-5.md")),
    );
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

test("049: the first dispatch of a pass must be a runnable skeleton", async () => {
  const parent = [
    dispatch("build the auth modal", ["src/AuthModal.tsx"], "the modal opens and closes"),
    say("understood, re-scoping"),
  ];
  const { base, close } = await setup([parent, builderWrites("src/AuthModal.tsx")], "architect");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } };
    assert.ok(end, "a dispatch_task tool.end");
    assert.equal(end.call.isError, true);
    assert.match(end.call.result, /first build task must produce a RUNNABLE skeleton/i);
    const orch = await (await fetch(`${base}/sessions/s_orch/orchestration`)).json();
    assert.equal(orch.subagents, 0, "no builder spawned for a non-skeleton first task");
  } finally {
    await close();
  }
});

test("049: a task naming more than five files is refused at dispatch", async () => {
  const parent = [
    dispatch(
      "build the whole dashboard",
      ["a.tsx", "b.tsx", "c.tsx", "d.tsx", "e.tsx", "f.tsx"],
      "npm run build passes and the dashboard renders",
    ),
    say("splitting it"),
  ];
  const { base, close } = await setup([parent, builderWrites("a.tsx")], "architect");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } };
    assert.equal(end.call.isError, true);
    assert.match(end.call.result, /at most 5|Split it/i);
  } finally {
    await close();
  }
});

test("051: the verify dispatch is exempt from the runnable-first and file-count gates and returns a checklist", async () => {
  const parent = [
    call("dispatch_task", {
      task: "verify and finish the project",
      acceptanceCriteria:
        "build passes; preview serves the app; .env.example present; README correct",
      files: [
        "README.md",
        ".env.example",
        ".github/workflows/ci.yml",
        ".gitignore",
        "vercel.json",
        "src/x",
      ],
      verify: true,
      tools: ["security_scan", "lint_project"],
      skills: ["application-security-engineering"],
    }),
    say("here is the checklist"),
  ];
  const verifier = [
    call("write_file", { path: ".env.example", content: "VITE_SUPABASE_URL=\n" }),
    say(
      "COMPLETION CHECKLIST\n- Build: PASS\n- Preview serves app: PASS\n- .env.example present: PASS\n- Security scan: FAIL — 1 medium finding, triaged in risks.md\npreview: http://127.0.0.1:4975",
    ),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, verifier], "architect");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } };
    assert.ok(end, "a dispatch_task tool.end");
    assert.equal(
      end.call.isError,
      false,
      "the verify dispatch is not refused for 6 files / no skeleton",
    );
    assert.match(end.call.result, /Verification finished/);
    assert.match(end.call.result, /COMPLETION CHECKLIST/);
    assert.match(end.call.result, /verbatim/i);
    await fs.access(path.join(workspaceDir, projectId, ".env.example"));
  } finally {
    await close();
  }
});
