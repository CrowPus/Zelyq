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
 * Engineer Mode + Auto Mode: a turn that runs out of steps with the work
 * unfinished carries on by itself, instead of stopping and waiting for
 * "keep going". It stops when the model says the request is done, when it
 * stops making progress, or at a ceiling — never runs forever.
 */

// The last-step handling only applies from 12 steps up, so the budget here is
// the smallest that exercises it.
const STEPS = 12;

type Step = { events: ProviderEvent[]; result: TurnResult };

/** One scripted conversation; each model call takes the next step, and the
 * last step repeats once the script runs out. */
function scriptedProvider(script: Step[]): ModelProvider {
  let i = 0;
  return {
    id: "anthropic",
    model: "scripted",
    createConversation() {
      const conversation: Conversation = {
        addUserMessage: () => undefined,
        addToolResults: () => undefined,
        async *stream() {
          const step = script[Math.min(i++, script.length - 1)]!;
          for (const event of step.events) yield event;
          return step.result;
        },
      };
      return conversation;
    },
  };
}

let edits = 0;
/** A step that changes the project — the same file, different content each
 * time, so no new-file checkpoint or identical-call guard gets involved. */
const edit = (): Step => {
  edits += 1;
  return {
    events: [{ type: "text", text: "working" }],
    result: {
      toolCalls: [
        {
          id: `c_edit_${edits}`,
          name: "write_file",
          input: { path: "src/work.ts", content: `export const step = ${edits};\n` },
        },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 10 },
    },
  };
};

let looks = 0;
/** A step that only looks around and changes nothing. */
const look = (): Step => {
  looks += 1;
  return {
    events: [{ type: "text", text: "looking" }],
    result: {
      toolCalls: [{ id: `c_look_${looks}`, name: "list_files", input: { path: `dir${looks}` } }],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 10 },
    },
  };
};

const say = (text: string): Step => ({
  events: [{ type: "text", text }],
  result: { toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 5 } },
});

async function run(
  script: Step[],
  session: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<{
  status: number;
  events: Array<{ type: string; code?: string; message?: string }>;
  files: string[];
}> {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-eng-auto-${Date.now()}-${Math.random()}`);
  const projectId = "prj_eng";
  await fs.mkdir(path.join(workspaceDir, projectId, "src"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(workspaceDir, projectId, name), content);
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
    maxTurnIterations: STEPS,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4981, 4989],
      previewHost: "127.0.0.1",
    },
  };
  const provider = scriptedProvider(script);
  const server = buildAgentServer(config, { providerFactory: () => provider });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try {
    const created = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s_eng", projectId, ...session }),
    });
    if (created.status !== 201) return { status: created.status, events: [], files: [] };
    const response = await fetch(`${base}/sessions/s_eng/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "build the lead tracker" }),
    });
    const events = (await response.text())
      .split("\n\n")
      .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.slice(6)));
    const files = (await fs.readdir(path.join(workspaceDir, projectId, "src"))).sort();
    return { status: created.status, events, files };
  } finally {
    await server.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

const turns = (events: Array<{ type: string }>) =>
  events.filter((event) => event.type === "turn.end").length;
const autoStop = (events: Array<{ type: string; code?: string }>) =>
  events.find((event) => event.type === "error" && String(event.code).startsWith("auto_"));

test("Auto Mode is accepted with Engineer Mode", async () => {
  const { status } = await run([say("done")], { engineerMode: true, autoMode: true });
  assert.equal(status, 201);
});

test("Auto Mode with no building mode is still refused", async () => {
  const { status } = await run([say("n/a")], { autoMode: true });
  assert.equal(status, 400);
});

test("an Engineer turn that finishes within budget does not start another", async () => {
  const { events } = await run([edit(), say("All done.")], {
    engineerMode: true,
    autoMode: true,
  });
  assert.equal(turns(events), 1, "finished work ends the run");
  assert.equal(autoStop(events), undefined, "no stop notice for a normal finish");
});

test("an Engineer turn out of steps carries on by itself, and stops when it says it is done", async () => {
  // Pass 1 uses every step working. Pass 2 works, then on its last step says
  // the request is complete.
  const script = [
    ...Array.from({ length: STEPS }, edit),
    ...Array.from({ length: STEPS - 1 }, edit),
    say("Built the list, the form and the API.\nREMAINING: none"),
  ];
  const { events } = await run(script, { engineerMode: true, autoMode: true });
  assert.equal(turns(events), 2, "the second pass started without anyone saying keep going");
  assert.equal(autoStop(events), undefined, '"REMAINING: none" is a finish, not a stop');
});

test("without Auto Mode, an Engineer turn out of steps waits for the user as before", async () => {
  const { events } = await run(Array.from({ length: STEPS * 2 }, edit), { engineerMode: true });
  assert.equal(turns(events), 1);
});

test("passes that change nothing stop the run as stuck", async () => {
  const { events } = await run(Array.from({ length: STEPS * 4 }, look), {
    engineerMode: true,
    autoMode: true,
  });
  const stop = autoStop(events);
  assert.equal(stop?.code, "auto_stuck");
  assert.match(String(stop?.message), /changed nothing/);
  assert.equal(turns(events), 2, "two passes without progress, then it stops");
});

test("an Engineer run that never finishes stops at the pass ceiling, not never", async () => {
  const { events } = await run(Array.from({ length: STEPS * 10 }, edit), {
    engineerMode: true,
    autoMode: true,
  });
  const stop = autoStop(events);
  assert.equal(stop?.code, "auto_ceiling");
  assert.match(String(stop?.message), /pass ceiling/);
  assert.equal(turns(events), 6, "six passes, then a ceiling");
  assert.doesNotMatch(String(stop?.message), /take the rest to the Engineer/, "it is the Engineer");
});

test("a sentence that merely mentions the marker does not end the run", async () => {
  const script = [
    ...Array.from({ length: STEPS - 1 }, edit),
    say('Still wiring the form; I will write "REMAINING: none" once it is finished.'),
    ...Array.from({ length: STEPS - 1 }, edit),
    say("Finished.\nREMAINING: none"),
  ];
  const { events } = await run(script, { engineerMode: true, autoMode: true });
  assert.equal(turns(events), 2, "the mid-sentence mention was not taken as done");
});

/** A project whose typecheck always fails, so every end-of-turn check does. */
const failingCheck = {
  "package.json": JSON.stringify({
    name: "p",
    scripts: { typecheck: "echo 'TypeError: boom' && exit 1" },
  }),
};

test('"REMAINING: none" does not end the run while a check is failing', async () => {
  // Found live: the model wrote "REMAINING: none" while the app was broken,
  // and Auto Mode stopped on the broken app it had been switched on to prevent.
  const script = [
    ...Array.from({ length: STEPS - 1 }, edit),
    say("Everything is built.\nREMAINING: none"),
    ...Array.from({ length: STEPS - 1 }, edit),
    say("Fixed it.\nREMAINING: none"),
  ];
  const { events } = await run(script, { engineerMode: true, autoMode: true }, failingCheck);
  assert.ok(turns(events) >= 2, "a failing check started another pass despite the marker");
  // Still failing after that pass: it stops as not converging, rather than looping.
  assert.equal(autoStop(events)?.code, "auto_stuck");
});

test("a turn that wrote its own summary is never told it wrote none", async () => {
  const script = [
    ...Array.from({ length: STEPS - 1 }, edit),
    say("Built the form and the list.\nREMAINING: none"),
  ];
  const { events } = await run(script, { engineerMode: true }, failingCheck);
  const text = events
    .filter((event) => event.type === "text.delta")
    .map((event) => (event as { text?: string }).text ?? "")
    .join("");
  assert.match(text, /Built the form and the list/);
  assert.doesNotMatch(text, /before it could write a summary/);
});

test("the failure shown is the end of the output, where the cause is", async () => {
  const long = "x".repeat(5000);
  const files = {
    "package.json": JSON.stringify({
      name: "p",
      scripts: {
        typecheck: `echo '${long}' && echo 'ImportError: cannot import name Note' && exit 1`,
      },
    }),
  };
  const script = [...Array.from({ length: STEPS - 1 }, edit), say("done")];
  const { events } = await run(script, { engineerMode: true }, files);
  const text = events
    .filter((event) => event.type === "text.delta")
    .map((event) => (event as { text?: string }).text ?? "")
    .join("");
  assert.match(text, /ImportError: cannot import name Note/, "the cause survives shortening");
});

/** A step that creates a new component file. */
const create = (n: number): Step => ({
  events: [{ type: "text", text: "adding a component" }],
  result: {
    toolCalls: [
      {
        id: `c_new_${n}`,
        name: "write_file",
        input: { path: `src/Component${n}.tsx`, content: `export const C${n} = () => null;\n` },
      },
    ],
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 10 },
  },
});

test("in Auto Mode a spec that names many files gets every one of them", async () => {
  // Found live: the spec named ~9 files, the new-file checkpoint refused the
  // 7th, and the agent crammed the rest into a 700-line App.tsx.
  const script = [
    ...Array.from({ length: 9 }, (_, i) => create(i + 1)),
    say("Done.\nREMAINING: none"),
  ];
  const { files } = await run(script, { engineerMode: true, autoMode: true });
  assert.equal(files.filter((f) => f.startsWith("Component")).length, 9);
});

test("outside Auto Mode the new-file checkpoint still asks before more files appear", async () => {
  const script = [...Array.from({ length: 9 }, (_, i) => create(i + 1)), say("Done.")];
  const { files } = await run(script, { engineerMode: true });
  assert.ok(
    files.filter((f) => f.startsWith("Component")).length < 9,
    "the checkpoint still holds",
  );
});

test("a turn that stops early saying work is left carries on by itself", async () => {
  // Found live: the agent stopped mid-build to ask "reply continue", and Auto
  // Mode took any turn that had not used its last step as finished.
  // Real Engineer replies open with "Purpose:"; without it Engineer Mode asks
  // for one inside the same turn, which is not what this test is about.
  const script = [
    edit(),
    say(
      "Purpose: build LeadFlow. The backend is done.\nREMAINING: the React components and the README",
    ),
    edit(),
    say("Purpose: build LeadFlow. Everything is built.\nREMAINING: none"),
  ];
  const { events } = await run(script, { engineerMode: true, autoMode: true });
  assert.equal(turns(events), 2, "the next pass started without anyone typing continue");
  assert.equal(autoStop(events), undefined);
});

test('"NEEDS YOU" pauses Auto Mode and shows the question', async () => {
  const script = [
    edit(),
    say("I need one decision.\nNEEDS YOU: Should deleted leads be archived or removed?"),
  ];
  const { events } = await run(script, { engineerMode: true, autoMode: true });
  assert.equal(turns(events), 1, "it waits for the person rather than guessing");
  const paused = events.find((e) => e.type === "error" && e.code === "auto_paused");
  assert.match(String(paused?.message), /archived or removed/);
});

test("the Engineer is told about Auto Mode only when it is on", async () => {
  const { buildSystemPrompt } = await import("../src/prompt.js");
  const base = { projectId: "p", projectName: "P", provider: "anthropic", model: "m" } as never;
  const on = buildSystemPrompt({
    ...(base as object),
    engineerMode: {},
    engineerAuto: true,
  } as never);
  const off = buildSystemPrompt({ ...(base as object), engineerMode: {} } as never);
  assert.match(on, /<auto_mode>/);
  assert.match(on, /Never stop to ask the user to continue/);
  assert.doesNotMatch(off, /<auto_mode>/);
});
