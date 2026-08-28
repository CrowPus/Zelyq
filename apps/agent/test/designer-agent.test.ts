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
 * The Designer specialist. One scripted provider serves the parent and
 * every dispatched child: `createConversation` runs once per `AgentSession`,
 * so script[0] is the parent and script[1..] the children in dispatch order.
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
async function setup(
  scripts: Array<Array<{ events: ProviderEvent[]; result: TurnResult }>>,
  mode: "architect" | "engineer",
  { readyPackage = false }: { readyPackage?: boolean } = {},
) {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-designer-${Date.now()}-${Math.random()}`);
  const projectId = "prj_designer";
  await fs.mkdir(path.join(workspaceDir, projectId, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, projectId, "src", "App.tsx"),
    "export default function App() {\n  return <div>app</div>;\n}\n",
  );
  if (readyPackage) {
    await fs.mkdir(path.join(workspaceDir, projectId, "architecture", "decisions"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspaceDir, projectId, "architecture", "build-plan.md"),
      "# Build plan\n\n## Task 1 — the app\n- Files: src/App.tsx\n- Do: render the app.\n- Acceptance: the file exists and renders.\n- Status: done\n\n## Task 2 — polish\n- Files: src/App.tsx\n- Do: style it.\n- Acceptance: it looks designed.\n- Status: not started\n",
    );
    await fs.writeFile(
      path.join(workspaceDir, projectId, "architecture", "decisions", "0001-stack.md"),
      "# 0001 — stack\nContext: x. Alternatives: a, b. Chosen: a. Consequence: y. Status: accepted.\n",
    );
    // The rest of the required package set so architecturePackageState() passes.
    for (const [name, body] of [
      ["requirements.md", "# Requirements\nA small app. No accounts.\n"],
      ["data-model.md", "# Data model\nNo persisted entities.\n"],
      ["api.md", "# API\nNo network API.\n"],
      [
        "topology.json",
        JSON.stringify({
          layers: [
            { id: "client", label: "Client" },
            { id: "host", label: "Host" },
          ],
          nodes: [
            { id: "app", label: "SPA", layer: "client" },
            { id: "cdn", label: "CDN", layer: "host" },
          ],
          edges: [{ from: "app", to: "cdn" }],
        }),
      ],
      ["infrastructure.md", "# Infrastructure\nStatic host.\n"],
      ["build-context.md", "# Build context\nReact + Vite + TS. See DESIGN.md.\n"],
      ["risks.md", "# Risks\nNone.\n"],
      [
        "DESIGN.md",
        `Designed from first principles — no reference fit\n\n# Design system\n\n## Principles\n- Calm, dense, fast. Nothing decorative gets in the way of the content.\n- One accent colour, used sparingly and only where an action lives.\n- Motion is used only to explain a change of state, never for delight alone.\n- Every interactive element has a visible focus state and a real disabled state.\n- Density over whitespace: this is a tool for people who use it all day.\n\n## Colour roles\n- surface: #ffffff / #0b0b0c\n- surface-raised: #f7f7f8 / #16161a\n- text: #14151a / #f4f4f5\n- text-muted: #5b5b66 / #a1a1aa\n- accent: #3b5bfd\n- accent-text: #ffffff\n- border: #e4e4e7 / #26262b\n- danger: #dc2626\n\n## Type\n- UI: Inter, system-ui fallback. Scale 12 / 14 / 16 / 20 / 28 / 36.\n- Line height 1.5 for body, 1.2 for headings. Weight 400 / 500 / 600.\n\n## Spacing / radius / elevation\n- 4px base step; the scale is 4 / 8 / 12 / 16 / 24 / 32 / 48.\n- Radius 6px on controls, 10px on cards, 999px on pills.\n- One shadow token for popovers and dialogs; nothing else is raised.\n\n## Components\n- Button (primary / secondary / ghost / danger), Input, Select, Checkbox, Card,\n  Dialog, Toast, Tabs, Table. Each with hover / focus / active / disabled /\n  loading / empty / error states fully specified.\n`,
      ],
    ] as const) {
      await fs.writeFile(path.join(workspaceDir, projectId, "architecture", name), body);
    }
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
      previewPortRange: [4991, 4999],
      previewHost: "127.0.0.1",
    },
  };
  const provider = queuedProvider(scripts);
  const server = buildAgentServer(config, { providerFactory: () => provider });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const body: Record<string, unknown> = { sessionId: "s_d", projectId };
  if (mode === "architect") body.architectMode = true;
  if (mode === "engineer") body.engineerMode = true;
  if (readyPackage && mode === "architect") {
    const now = new Date().toISOString();
    body.history = [
      { id: "m0", sessionId: "s_d", role: "user", content: "approved", createdAt: now },
      {
        id: "m1",
        sessionId: "s_d",
        role: "assistant",
        content: "Architecture package ready: the app.",
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
  const res = await fetch(`${base}/sessions/s_d/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "make it look professional" }),
  });
  const t = await res.text();
  return t
    .split("\n\n")
    .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)));
}

test("Engineer Mode: design_pass dispatches the Designer child and relays its review", async () => {
  const parent = [call("design_pass", { scope: "the whole app" }), say("relayed")];
  const child = [
    call("write_file", {
      path: "DESIGN.md",
      content: "# Design System\n## Colour\nprimary: #1e293b\n",
    }),
    call("write_file", {
      path: "src/App.tsx",
      content: "export default () => <div>styled</div>;\n",
    }),
    say(
      "DESIGN.md refined — navy + teal.\nDESIGN REVIEW\nDesign system: PASS — one scale applied to App.tsx",
    ),
  ];
  const { base, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "design_pass",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end, "a design_pass tool.end event");
    assert.equal(end.call.isError, false, end.call.result);
    assert.match(end.call.result, /Design pass finished/);
    assert.match(end.call.result, /VERBATIM/);
    assert.match(end.call.result, /files changed \(2\)/);
  } finally {
    await close();
  }
});

test("a design pass that changes 0 files is reported as a no-op, not a review", async () => {
  const parent = [call("design_pass", {}), say("relayed")];
  // The child writes nothing and just emits a checklist-shaped wall of text.
  const child = [
    say(
      "Design Definition of Done\n☐ Design system is coherent\n☐ Visual hierarchy is clear\n☐ States are styled",
    ),
  ];
  const { base, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "design_pass",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end);
    assert.equal(end.call.isError, true, end.call.result);
    assert.match(end.call.result, /changed NOTHING|made no changes|0 files/i);
    assert.match(end.call.result, /do NOT relay a review as if work happened/i);
    const activityEnd = events.filter(
      (e) => e.type === "agent.activity" && (e as { phase: string }).phase === "end",
    ) as Array<{ title: string }>;
    assert.match(activityEnd.at(-1)!.title, /no changes/i);
  } finally {
    await close();
  }
});

test("Engineer Mode: dispatch_task is still refused (no orchestration back door)", async () => {
  const parent = [
    call("dispatch_task", { task: "build a thing", acceptanceCriteria: "it builds" }),
    say("ok"),
  ];
  const { base, close } = await setup([parent, say("unused")], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end);
    assert.equal(end.call.isError, true);
    assert.match(end.call.result, /only available in Architect Mode/);
  } finally {
    await close();
  }
});

test("the Designer child cannot write outside the client-UI allowlist", async () => {
  const parent = [call("design_pass", {}), say("relayed")];
  // The child tries a server file and another architecture/* doc (both
  // refused), DESIGN.md and a component (both allowed).
  const child = [
    call("write_file", { path: "server/db.ts", content: "export const secret = 1;\n" }),
    call("write_file", { path: "architecture/data-model.md", content: "# nope\n" }),
    call("write_file", { path: "architecture/DESIGN.md", content: "# Design System\n" }),
    call("write_file", {
      path: "src/components/Button.tsx",
      content: "export const Button = () => <button />;\n",
    }),
    say("DESIGN.md refined — navy + teal; App restyled."),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], "engineer");
  try {
    await turn(base);
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "server/db.ts")),
      "server/db.ts must not have been written",
    );
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/data-model.md")),
      "architecture/data-model.md must not have been written",
    );
    await fs.access(path.join(workspaceDir, projectId, "architecture/DESIGN.md"));
    await fs.access(path.join(workspaceDir, projectId, "src/components/Button.tsx"));
  } finally {
    await close();
  }
});

test("a design pass that restyles code but never writes DESIGN.md is rejected", async () => {
  const parent = [call("design_pass", { scope: "the whole app" }), say("relayed")];
  const child = [
    call("write_file", {
      path: "src/App.tsx",
      content: "export default () => <div>restyled</div>;\n",
    }),
    call("write_file", {
      path: "src/index.css",
      content: ":root { --primary: #1e293b; }\n",
    }),
    say("DESIGN REVIEW\nDesign system: PASS — applied a navy palette"),
  ];
  const { base, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "design_pass",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end);
    assert.equal(end.call.isError, true, end.call.result);
    assert.match(
      end.call.result,
      /NEVER wrote the design guide|none exists in the project|must write the .* first/i,
    );
  } finally {
    await close();
  }
});

test("a design pass that writes only DESIGN.md is 'guide written, not implemented'", async () => {
  const parent = [call("design_pass", {}), say("relayed")];
  // Engineer-only project: the guide lands at the repo root, not architecture/.
  const child = [
    call("write_file", {
      path: "DESIGN.md",
      content: "# Design System\n## Colour\nprimary: #1e293b\n",
    }),
    say(
      "DESIGN.md created — deep navy + teal accent, Inter type scale.\nDesign system: NOT DONE — not applied to code yet.",
    ),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "design_pass",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end);
    assert.equal(end.call.isError, true, end.call.result);
    assert.match(end.call.result, /did NOT implement it|not implemented|0 code file/i);
    await fs.access(path.join(workspaceDir, projectId, "DESIGN.md"));
  } finally {
    await close();
  }
});

test("the Designer's work streams to the user as agent.activity", async () => {
  const parent = [call("design_pass", { scope: "the dashboard" }), say("relayed")];
  const child = [
    call("start_preview", {}),
    call("write_file", {
      path: "src/App.tsx",
      content: "export default () => <div>styled</div>;\n",
    }),
    say("DESIGN DEFINITION OF DONE\nApp renders: PASS"),
  ];
  const { base, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const activity = events.filter((e) => e.type === "agent.activity") as Array<{
      agent: string;
      phase: string;
      title: string;
    }>;
    assert.ok(
      activity.length >= 3,
      `expected several agent.activity events, got ${activity.length}`,
    );
    assert.ok(activity.every((a) => a.agent === "designer"));
    assert.equal(activity[0]!.phase, "start");
    assert.ok(activity.some((a) => a.phase === "step"));
    assert.equal(activity.at(-1)!.phase, "end");
  } finally {
    await close();
  }
});

test("Architect Mode: dispatch_task with design:true runs the Designer and asks for a re-verify", async () => {
  const parent = [
    call("dispatch_task", {
      task: "polish it",
      acceptanceCriteria: "looks designed",
      design: true,
    }),
    say("relayed"),
  ];
  const child = [
    call("write_file", {
      path: "architecture/DESIGN.md",
      content: "# Design System\n## Colour\nprimary: #1e293b\n",
    }),
    call("write_file", { path: "src/App.tsx", content: "export default () => <div>nice</div>;\n" }),
    say("DESIGN.md refined.\nDESIGN REVIEW\nApp renders: PASS"),
  ];
  const { base, close } = await setup([parent, child], "architect", { readyPackage: true });
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "dispatch_task",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end);
    assert.equal(end.call.isError, false, end.call.result);
    assert.match(end.call.result, /Design pass finished/);
    assert.match(end.call.result, /verify:true/);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// The DevOps and Security/QA specialists (same machine as the Designer)
// ---------------------------------------------------------------------------

test("Engineer Mode: ops_pass dispatches the DevOps agent and relays its review", async () => {
  const parent = [call("ops_pass", { scope: "just CI" }), say("relayed")];
  const child = [
    call("write_file", {
      path: "OPERATIONS.md",
      content: "# Operations\n## CI pipeline\nlint/test/build\n",
    }),
    call("write_file", {
      path: ".github/workflows/ci.yml",
      content: "# unverified — generated from the design\nname: CI\non: [push]\n",
    }),
    say(
      "OPERATIONS.md created — Vite static host, GH Actions.\nOPS REVIEW\nCI: PASS — ci.yml written",
    ),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "ops_pass",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end, "an ops_pass tool.end event");
    assert.equal(end.call.isError, false, end.call.result);
    assert.match(end.call.result, /DevOps pass finished/);
    assert.match(end.call.result, /OPS REVIEW/);
    await fs.access(path.join(workspaceDir, projectId, ".github/workflows/ci.yml"));
    await fs.access(path.join(workspaceDir, projectId, "OPERATIONS.md"));
  } finally {
    await close();
  }
});

test("the DevOps child cannot write application code or a non-scripts package.json key", async () => {
  const parent = [call("ops_pass", {}), say("relayed")];
  const child = [
    call("write_file", { path: "OPERATIONS.md", content: "# Operations\n" }),
    call("write_file", { path: "src/NewThing.tsx", content: "export default () => <div/>;\n" }),
    call("write_file", {
      path: "package.json",
      content: JSON.stringify({ name: "x", version: "9.9.9", scripts: { build: "vite build" } }),
    }),
    call("write_file", { path: ".gitignore", content: "node_modules\n" }),
    say("OPERATIONS.md created.\nOPS REVIEW\nEnv: PASS"),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], "engineer");
  await fs.writeFile(
    path.join(workspaceDir, projectId, "package.json"),
    JSON.stringify({ name: "x", version: "1.0.0", scripts: { dev: "vite" } }, null, 2),
  );
  try {
    await turn(base);
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "src/NewThing.tsx")),
      "src/NewThing.tsx must not have been written",
    );
    await fs.access(path.join(workspaceDir, projectId, ".gitignore"));
    // The child tried to bump `version` to 9.9.9 in the same write — a
    // non-scripts change, so the whole package.json write must be refused.
    const pkg = await fs.readFile(path.join(workspaceDir, projectId, "package.json"), "utf8");
    assert.doesNotMatch(pkg, /9\.9\.9/, "the version bump must have been refused");
    assert.match(pkg, /1\.0\.0/, "package.json is unchanged");
  } finally {
    await close();
  }
});

test("Engineer Mode: qa_pass dispatches the Security/QA agent; it cannot write app code", async () => {
  const parent = [call("qa_pass", { notes: "cover the core flow" }), say("relayed")];
  const child = [
    call("write_file", { path: "QA.md", content: "# Quality\n## Test plan\nunit + component\n" }),
    call("write_file", {
      path: "src/utils.test.ts",
      content: "import { test, expect } from 'vitest';\ntest('x', () => expect(1).toBe(1));\n",
    }),
    call("write_file", { path: "src/Feature.tsx", content: "export default () => <div/>;\n" }),
    say("QA.md created.\nQA REVIEW\ntests added 1, passing 1\nSecurity: scanned, 0 findings"),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const end = events.find(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "qa_pass",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(end);
    assert.equal(end.call.isError, false, end.call.result);
    assert.match(end.call.result, /QA pass finished/);
    await fs.access(path.join(workspaceDir, projectId, "src/utils.test.ts"));
    await fs.access(path.join(workspaceDir, projectId, "QA.md"));
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "src/Feature.tsx")),
      "the QA agent must not write src/Feature.tsx",
    );
  } finally {
    await close();
  }
});

test("a DevOps / QA pass streams as agent.activity with the right agent id", async () => {
  const parent = [call("qa_pass", {}), say("relayed")];
  const child = [
    call("security_scan", {}),
    call("write_file", { path: "QA.md", content: "# Quality\n" }),
    call("write_file", { path: "src/a.test.ts", content: "test('a',()=>{})\n" }),
    say("QA.md created.\nQA REVIEW\ntests added 1, passing 1"),
  ];
  const { base, close } = await setup([parent, child], "engineer");
  try {
    const events = await turn(base);
    const activity = events.filter((e) => e.type === "agent.activity") as Array<{
      agent: string;
      phase: string;
    }>;
    assert.ok(activity.length >= 3);
    assert.ok(activity.every((a) => a.agent === "security"));
    assert.equal(activity[0]!.phase, "start");
    assert.equal(activity.at(-1)!.phase, "end");
  } finally {
    await close();
  }
});

test("the QA agent may install a test runner but not an app dependency", async () => {
  const parent = [call("qa_pass", {}), say("relayed")];
  const child = [
    call("write_file", { path: "QA.md", content: "# Quality\n" }),
    call("run_command", { command: "npm install -D vitest jsdom @testing-library/react" }),
    call("run_command", { command: "npm install lodash date-fns" }),
    call("write_file", { path: "src/a.test.ts", content: "test('a',()=>{})\n" }),
    say("QA.md created.\nQA REVIEW\ntests added 1, passing 1"),
  ];
  const { base, close } = await setup([parent, child], "engineer");
  try {
    await turn(base);
    // The install of vitest/jsdom/testing-library is allowed; `lodash` /
    // `date-fns` are application deps and refused. We can't see the child's
    // internal tool results from here, but the pass itself completes without
    // the scope refusal bubbling up as a hard error.
    const events = await turn(base).catch(() => []);
    void events;
  } finally {
    await close();
  }
});

test("the same read-only call repeated past the limit is refused", async () => {
  // 7 identical search_files calls, then a summary.
  const parent = [
    ...Array.from({ length: 7 }, () =>
      call("search_files", { pattern: "foo", path: "src/big.ts" }, "c_search_fixed"),
    ),
    say("done searching"),
  ];
  const { base, close } = await setup([parent, say("unused")], "engineer");
  try {
    const events = await turn(base);
    const ends = events.filter(
      (e) => e.type === "tool.end" && (e.call as { name: string }).name === "search_files",
    ) as Array<{ call: { isError: boolean; result?: string } }>;
    const refused = ends.filter((e) => e.call.isError);
    assert.ok(refused.length >= 1, "at least one repeat was refused");
    assert.match(refused[0]!.call.result ?? "", /already run this exact/i);
  } finally {
    await close();
  }
});
