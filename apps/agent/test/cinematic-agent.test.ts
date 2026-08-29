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
 * 061 — the Cinematic engineer specialist. Same harness as
 * designer-agent.test.ts: one scripted provider serves the parent and every
 * dispatched child; script[0] is the parent, script[1..] the children in
 * dispatch order.
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
// A tool-call turn with no prose — the model emits only the tool call. (The
// parent accumulates child `text` deltas into the reply it inspects for the
// ASSETS NEEDED marker, so stray "calling X" text here would be unrealistic.)
const call = (name: string, input: Record<string, unknown>, id = `c_${name}_${Math.random()}`) => ({
  events: [] as ProviderEvent[],
  result: {
    toolCalls: [{ id, name, input }],
    stopReason: "tool_use" as const,
    usage: { inputTokens: 5, outputTokens: 5 },
  },
});

async function setup(
  scripts: Array<Array<{ events: ProviderEvent[]; result: TurnResult }>>,
  { seedSource = false }: { seedSource?: boolean } = {},
) {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-cinematic-${Date.now()}-${Math.random()}`);
  const projectId = "prj_cinematic";
  await fs.mkdir(path.join(workspaceDir, projectId, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, projectId, "src", "App.tsx"),
    "export default function App() {\n  return <div>app</div>;\n}\n",
  );
  if (seedSource) {
    await fs.mkdir(path.join(workspaceDir, projectId, "cinematic", "hero"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, projectId, "cinematic", "hero", "source.mp4"),
      "\x00\x00\x00\x18ftypmp42fake bytes",
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
    maxTurnIterations: 20,
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
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "s_c", projectId, engineerMode: true }),
  });
  assert.equal(created.status, 201, await created.text());
  return { base, workspaceDir, projectId, close: () => server.app.close() };
}

async function turn(
  base: string,
  message = "make the hero play as I scroll",
): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const res = await fetch(`${base}/sessions/s_c/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const t = await res.text();
  return t
    .split("\n\n")
    .map((f) => f.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)));
}

const endOf = (events: Array<{ type: string; [k: string]: unknown }>, name: string) =>
  events.find((e) => e.type === "tool.end" && (e.call as { name: string }).name === name) as
    | { call: { isError: boolean; result: string } }
    | undefined;

// ---------------------------------------------------------------------------
// Phase 1 — the fourth SpecialistKind, wired
// ---------------------------------------------------------------------------

test("Engineer Mode: cinematic_pass dispatches the child and relays its review", async () => {
  const parent = [call("cinematic_pass", { scope: "the landing hero" }), say("relayed")];
  const child = [
    call("write_file", {
      path: "architecture/CINEMATIC.md",
      content:
        "# Cinematic\n## Mode\nCinematic DOM — a DOM canvas is enough.\n## Assets\nRECEIVED\n",
    }),
    call("write_file", {
      path: "public/cinematic/hero/frame_0001.webp",
      content: "webp-bytes",
    }),
    call("write_file", {
      path: "src/components/ScrollHero.tsx",
      content: "export const ScrollHero = () => <canvas aria-hidden />;\n",
    }),
    say(
      "CINEMATIC.md refined — Cinematic DOM, 1 scene, mobile poster.\nCINEMATIC REVIEW\nScroll Storyboard implemented: PASS — ScrollHero.tsx, screenshot at 0/50/100%.",
    ),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], {
    seedSource: true,
  });
  try {
    const events = await turn(base);
    const end = endOf(events, "cinematic_pass");
    assert.ok(end, "a cinematic_pass tool.end event");
    assert.equal(end.call.isError, false, end.call.result);
    assert.match(end.call.result, /Cinematic pass finished/);
    assert.match(end.call.result, /VERBATIM/);
    assert.match(end.call.result, /CINEMATIC REVIEW/);
    await fs.access(path.join(workspaceDir, projectId, "src/components/ScrollHero.tsx"));
    await fs.access(path.join(workspaceDir, projectId, "public/cinematic/hero/frame_0001.webp"));
  } finally {
    await close();
  }
});

test("dispatch_task is still refused in Engineer Mode (no orchestration back door)", async () => {
  const parent = [
    call("dispatch_task", { task: "build a thing", acceptanceCriteria: "it builds" }),
    say("ok"),
  ];
  const { base, close } = await setup([parent, say("unused")]);
  try {
    const events = await turn(base);
    const end = endOf(events, "dispatch_task");
    assert.ok(end);
    assert.equal(end.call.isError, true);
    assert.match(end.call.result, /only available in Architect Mode/);
  } finally {
    await close();
  }
});

test("the Cinematic child's write scope: server / other architecture docs refused; UI + assets + CINEMATIC.md allowed", async () => {
  const parent = [call("cinematic_pass", {}), say("relayed")];
  const child = [
    call("write_file", { path: "server/db.ts", content: "export const secret = 1;\n" }),
    call("write_file", { path: "architecture/api.md", content: "# nope\n" }),
    call("write_file", {
      path: "architecture/CINEMATIC.md",
      content: "# Cinematic\n## Assets\nRECEIVED\n",
    }),
    call("write_file", {
      path: "public/cinematic/hero/frame_0001.webp",
      content: "webp",
    }),
    call("write_file", {
      path: "src/components/ScrollHero.tsx",
      content: "export const ScrollHero = () => <canvas aria-hidden />;\n",
    }),
    say("CINEMATIC.md refined.\nCINEMATIC REVIEW\nScroll Storyboard implemented: PASS"),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], {
    seedSource: true,
  });
  try {
    await turn(base);
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "server/db.ts")),
      "server/db.ts must not have been written",
    );
    await assert.rejects(
      fs.access(path.join(workspaceDir, projectId, "architecture/api.md")),
      "architecture/api.md must not have been written",
    );
    await fs.access(path.join(workspaceDir, projectId, "architecture/CINEMATIC.md"));
    await fs.access(path.join(workspaceDir, projectId, "public/cinematic/hero/frame_0001.webp"));
    await fs.access(path.join(workspaceDir, projectId, "src/components/ScrollHero.tsx"));
  } finally {
    await close();
  }
});

test("the frame tree is exempt from the 6-new-file checkpoint; plain src files still trip it", async () => {
  // 10 genuinely-new frame files + 1 component, in one turn — the frames are
  // exempt so the component still gets written.
  const parent = [call("cinematic_pass", {}), say("relayed")];
  const frameWrites = Array.from({ length: 10 }, (_, i) =>
    call("write_file", {
      path: `public/cinematic/hero/frame_${String(i).padStart(4, "0")}.webp`,
      content: "webp",
    }),
  );
  const child = [
    call("write_file", {
      path: "architecture/CINEMATIC.md",
      content: "# Cinematic\n## Assets\nRECEIVED\n",
    }),
    ...frameWrites,
    call("write_file", {
      path: "src/components/ScrollHero.tsx",
      content: "export const ScrollHero = () => <canvas aria-hidden />;\n",
    }),
    say("CINEMATIC.md refined.\nCINEMATIC REVIEW\nScroll Storyboard implemented: PASS"),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], {
    seedSource: true,
  });
  try {
    await turn(base);
    for (let i = 0; i < 10; i++) {
      await fs.access(
        path.join(
          workspaceDir,
          projectId,
          `public/cinematic/hero/frame_${String(i).padStart(4, "0")}.webp`,
        ),
      );
    }
    // The component after 10 frames must still have been written — the frames
    // are exempt, so they did not consume the checkpoint budget.
    await fs.access(path.join(workspaceDir, projectId, "src/components/ScrollHero.tsx"));
  } finally {
    await close();
  }
});

test("seven genuinely-new src components in one turn hit the checkpoint — the last is refused", async () => {
  const parent = [call("cinematic_pass", {}), say("relayed")];
  const child = [
    call("write_file", {
      path: "architecture/CINEMATIC.md",
      content: "# Cinematic\n## Assets\nRECEIVED\n",
    }),
    ...Array.from({ length: 7 }, (_, i) =>
      call("write_file", {
        path: `src/components/Scene${i}.tsx`,
        content: `export const Scene${i} = () => <div />;\n`,
      }),
    ),
    say("CINEMATIC REVIEW\nScroll Storyboard implemented: PASS"),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], {
    seedSource: true,
  });
  try {
    await turn(base);
    // CINEMATIC.md + 5 components fit under the 6-new-file checkpoint; the 6th
    // and 7th components are refused.
    const written: number[] = [];
    for (let i = 0; i < 7; i++) {
      const ok = await fs
        .access(path.join(workspaceDir, projectId, `src/components/Scene${i}.tsx`))
        .then(() => true)
        .catch(() => false);
      if (ok) written.push(i);
    }
    assert.ok(
      written.length < 7,
      `the checkpoint should have refused at least one component, but all 7 were written`,
    );
  } finally {
    await close();
  }
});

test("the Cinematic child's work streams as agent.activity with agent: cinematic", async () => {
  const parent = [call("cinematic_pass", { scope: "the hero" }), say("relayed")];
  const child = [
    call("start_preview", {}),
    call("write_file", {
      path: "architecture/CINEMATIC.md",
      content: "# Cinematic\n## Assets\nRECEIVED\n",
    }),
    call("write_file", {
      path: "src/components/ScrollHero.tsx",
      content: "export const ScrollHero = () => <canvas aria-hidden />;\n",
    }),
    say("CINEMATIC REVIEW\nScroll Storyboard implemented: PASS"),
  ];
  const { base, close } = await setup([parent, child], { seedSource: true });
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
    assert.ok(activity.every((a) => a.agent === "cinematic"));
    assert.equal(activity[0]!.phase, "start");
    assert.ok(activity.some((a) => a.phase === "step"));
    assert.equal(activity.at(-1)!.phase, "end");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Phase 2 — the asset gate (pause / resume)
// ---------------------------------------------------------------------------

test("no footage present: the pass writes SOURCE.md + a draft storyboard and returns ASSETS NEEDED — paused, not error, not done", async () => {
  const parent = [call("cinematic_pass", { scope: "the landing hero" }), say("relayed")];
  const child = [
    call("write_file", {
      path: "cinematic/landing-hero/SOURCE.md",
      content: "# Footage for the landing hero\nDrop your file here and reply go.\n",
    }),
    call("write_file", { path: "public/cinematic/landing-hero/.gitkeep", content: "" }),
    // the child also ignores the staging folder — this must NOT count as
    // "implementation" and must not defeat the pause detection.
    call("write_file", { path: ".gitignore", content: "node_modules\n/cinematic/\n" }),
    call("write_file", {
      path: "architecture/CINEMATIC.md",
      content: "# Cinematic\n## Scroll Storyboard\n- scene: hero\n## Assets\nAWAITING\n",
    }),
    say(
      'ASSETS NEEDED: I created cinematic/landing-hero/SOURCE.md with exactly what to provide. Add your clip to that folder and reply "go" — the pass resumes from the storyboard it already wrote.',
    ),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child]);
  try {
    const events = await turn(base);
    const end = endOf(events, "cinematic_pass");
    assert.ok(end);
    assert.equal(end.call.isError, false, "ASSETS NEEDED is not an error");
    assert.match(end.call.result, /PAUSED/);
    assert.match(end.call.result, /ENTIRE REPLY|paste it once/i);
    assert.match(end.call.result, /do NOT (add a preamble|repeat it)/i);
    assert.match(end.call.result, /ASSETS NEEDED:/);
    // SOURCE.md and the draft storyboard exist; no component was written.
    await fs.access(path.join(workspaceDir, projectId, "cinematic/landing-hero/SOURCE.md"));
    await fs.access(path.join(workspaceDir, projectId, "architecture/CINEMATIC.md"));
    const activityEnd = events.filter(
      (e) => e.type === "agent.activity" && (e as { phase: string }).phase === "end",
    ) as Array<{ title: string }>;
    assert.match(activityEnd.at(-1)!.title, /footage/i);
  } finally {
    await close();
  }
});

test("with footage present the gate does not fire — a real review comes back", async () => {
  const parent = [call("cinematic_pass", { scope: "the landing hero" }), say("relayed")];
  const child = [
    call("run_command", { command: "ffmpeg -i cinematic/hero/source.mp4 -vf fps=24 out%04d.webp" }),
    call("write_file", {
      path: "architecture/CINEMATIC.md",
      content: "# Cinematic\n## Assets\nRECEIVED — 96 frames at 1280x720\n",
    }),
    call("write_file", {
      path: "public/cinematic/hero/frame_0001.webp",
      content: "webp",
    }),
    call("write_file", {
      path: "src/components/ScrollHero.tsx",
      content: "export const ScrollHero = () => <canvas aria-hidden />;\n",
    }),
    say("CINEMATIC.md refined — Cinematic DOM, 96 frames.\nCINEMATIC REVIEW\nassets: PASS"),
  ];
  const { base, close } = await setup([parent, child], { seedSource: true });
  try {
    const events = await turn(base);
    const end = endOf(events, "cinematic_pass");
    assert.ok(end);
    assert.equal(end.call.isError, false, end.call.result);
    assert.match(end.call.result, /Cinematic pass finished/);
    assert.doesNotMatch(end.call.result, /PAUSED/);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Honesty gates (same shape as the Designer's)
// ---------------------------------------------------------------------------

test("a cinematic pass that changes 0 files is reported as a no-op", async () => {
  const parent = [call("cinematic_pass", {}), say("relayed")];
  const child = [say("CINEMATIC REVIEW\nScroll Storyboard implemented: NOT DONE")];
  const { base, close } = await setup([parent, child], { seedSource: true });
  try {
    const events = await turn(base);
    const end = endOf(events, "cinematic_pass");
    assert.ok(end);
    assert.equal(end.call.isError, true, end.call.result);
    assert.match(end.call.result, /changed NOTHING|made no changes|0 files/i);
  } finally {
    await close();
  }
});

test("a cinematic pass that writes only CINEMATIC.md is 'storyboard written, not implemented'", async () => {
  const parent = [call("cinematic_pass", {}), say("relayed")];
  const child = [
    call("write_file", {
      path: "CINEMATIC.md",
      content: "# Cinematic\n## Scroll Storyboard\n- scene: hero\n",
    }),
    say("CINEMATIC.md created — Cinematic DOM.\nScroll Storyboard implemented: NOT DONE"),
  ];
  const { base, workspaceDir, projectId, close } = await setup([parent, child], {
    seedSource: true,
  });
  try {
    const events = await turn(base);
    const end = endOf(events, "cinematic_pass");
    assert.ok(end);
    assert.equal(end.call.isError, true, end.call.result);
    assert.match(end.call.result, /did NOT implement it|not implemented|0 (other|code) file/i);
    await fs.access(path.join(workspaceDir, projectId, "CINEMATIC.md"));
  } finally {
    await close();
  }
});

test("a cinematic pass that writes code but never a storyboard is rejected as ungoverned", async () => {
  const parent = [call("cinematic_pass", {}), say("relayed")];
  const child = [
    call("write_file", {
      path: "src/components/ScrollHero.tsx",
      content: "export const ScrollHero = () => <canvas aria-hidden />;\n",
    }),
    call("write_file", { path: "src/index.css", content: ".hero { position: sticky; }\n" }),
    say("CINEMATIC REVIEW\nScroll Storyboard implemented: PASS"),
  ];
  const { base, close } = await setup([parent, child], { seedSource: true });
  try {
    const events = await turn(base);
    const end = endOf(events, "cinematic_pass");
    assert.ok(end);
    assert.equal(end.call.isError, true, end.call.result);
    assert.match(
      end.call.result,
      /NEVER wrote the scroll storyboard|none exists in the project|must write the .* first/i,
    );
  } finally {
    await close();
  }
});
