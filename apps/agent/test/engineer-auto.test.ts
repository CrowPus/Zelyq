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

/** What the scripted model was sent. */
type ModelLog = { calls: number; userMessages: string[] };

/** One scripted conversation; each model call takes the next step, and the
 * last step repeats once the script runs out.
 *
 * It holds the session to the rule the real APIs enforce: every tool call is
 * answered before the next request, or the request fails. Found in review: a
 * turn's last step left its calls unanswered, every later request in that
 * session got a 400, and a model that ignored the rule could not show it. */
function scriptedProvider(
  script: Step[],
  log: ModelLog = { calls: 0, userMessages: [] },
): ModelProvider {
  let i = 0;
  return {
    id: "anthropic",
    model: "scripted",
    createConversation() {
      let unanswered: string[] = [];
      const conversation: Conversation = {
        addUserMessage: (text: string) => {
          log.userMessages.push(text);
        },
        addToolResults: (results) => {
          const answered = new Set(results.map((result) => result.id));
          unanswered = unanswered.filter((id) => !answered.has(id));
        },
        async *stream() {
          log.calls += 1;
          if (unanswered.length > 0) {
            throw Object.assign(
              new Error(`400 tool_use ids were found without tool_result blocks: ${unanswered}`),
              { status: 400 },
            );
          }
          const step = script[Math.min(i++, script.length - 1)]!;
          for (const event of step.events) yield event;
          unanswered = step.result.toolCalls.map((call) => call.id);
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

type Event = { type: string; code?: string; message?: string; call?: { name: string } };

const parseFrames = (body: string): Event[] =>
  body
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));

/** An agent server with one Engineer session on a scratch project. */
async function open(
  script: Step[],
  session: Record<string, unknown>,
  files: Record<string, string> = {},
) {
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
  const log: ModelLog = { calls: 0, userMessages: [] };
  const provider = scriptedProvider(script, log);
  const server = buildAgentServer(config, { providerFactory: () => provider });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "s_eng", projectId, ...session }),
  });
  return {
    base,
    log,
    status: created.status,
    async prompt(message: string): Promise<Event[]> {
      const response = await fetch(`${base}/sessions/s_eng/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      return parseFrames(await response.text());
    },
    files: async () => (await fs.readdir(path.join(workspaceDir, projectId, "src"))).sort(),
    async close() {
      await server.close();
      await fs.rm(workspaceDir, { recursive: true, force: true });
    },
  };
}

async function run(
  script: Step[],
  session: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<{ status: number; events: Event[]; files: string[] }> {
  const agent = await open(script, session, files);
  try {
    if (agent.status !== 201) return { status: agent.status, events: [], files: [] };
    const events = await agent.prompt("build the lead tracker");
    return { status: agent.status, events, files: await agent.files() };
  } finally {
    await agent.close();
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
  // Two bounded repair passes after the initial build, then stop rather than loop.
  assert.equal(autoStop(events)?.code, "auto_stuck");
  assert.equal(turns(events), 3);
  assert.match(String(autoStop(events)?.message), /after 2 repair passes/);
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

// ---------------------------------------------------------------------------
// Found in review of the Auto Mode work
// ---------------------------------------------------------------------------

test("a tool call on a turn's last step does not break the session's next request", async () => {
  // Without Auto Mode too: every step calls a tool, the last one included.
  const agent = await open(Array.from({ length: STEPS * 3 }, edit), { engineerMode: true });
  try {
    const first = await agent.prompt("build the lead tracker");
    assert.equal(turns(first), 1);
    const second = await agent.prompt("keep going");
    const errors = second.filter((event) => event.type === "error");
    assert.deepEqual(errors, [], "the next request is not rejected over an unanswered call");
    assert.equal(turns(second), 1);
  } finally {
    await agent.close();
  }
});

test("each request gets a fresh Auto Mode run, not what the last one left of it", async () => {
  // Found in review: the first request used up the six passes, and the next
  // request stopped after one "at the 6-pass ceiling".
  const agent = await open(Array.from({ length: STEPS * 20 }, edit), {
    engineerMode: true,
    autoMode: true,
  });
  try {
    const first = await agent.prompt("build the lead tracker");
    assert.equal(autoStop(first)?.code, "auto_ceiling");
    const second = await agent.prompt("now add a settings page");
    assert.equal(turns(second), 6, "the second request gets its own six passes");
  } finally {
    await agent.close();
  }
});

test("a check that fails mid-turn is not waved through as done", async () => {
  // Found in review: the model answered a failing check with "that error is
  // unrelated … REMAINING: none", changed nothing, and the run ended there.
  const script = [
    edit(),
    say("Purpose: build it. Done.\nREMAINING: none"),
    say("Purpose: build it. That typecheck error is unrelated to my change.\nREMAINING: none"),
    edit(),
    say("Purpose: build it. Fixed.\nREMAINING: none"),
  ];
  const agent = await open(script, { engineerMode: true, autoMode: true }, failingCheck);
  try {
    const events = await agent.prompt("build the lead tracker");
    assert.ok(turns(events) >= 2, "a failing check started another pass");
    assert.ok(
      agent.log.userMessages.some((message) => /a check was failing/.test(message)),
      "the next pass is told the check was failing, not just to keep going",
    );
    // Still failing after that: it says so and stops, rather than going quiet.
    assert.equal(autoStop(events)?.code, "auto_stuck");
  } finally {
    await agent.close();
  }
});

test("the status line is read through markdown and plain synonyms", async () => {
  for (const line of ["**REMAINING:** none", "REMAINING: nothing", "REMAINING: N/A"]) {
    const { events } = await run([edit(), say(`Purpose: build it. Done.\n${line}`)], {
      engineerMode: true,
      autoMode: true,
    });
    assert.equal(turns(events), 1, `"${line}" ends the run`);
  }
});

test("Stop during the end-of-turn check stops Auto Mode", async () => {
  // Found in review: nothing was in flight to abort while a check ran, so the
  // turn finished, and the next pass started with nobody listening.
  const slowFailingCheck = {
    "package.json": JSON.stringify({
      name: "p",
      scripts: { typecheck: "sleep 1; echo 'TypeError: boom'; exit 1" },
    }),
  };
  const script = [
    ...Array.from({ length: STEPS - 1 }, edit),
    say("Purpose: build it. Out of room.\nREMAINING: the form"),
    ...Array.from({ length: STEPS * 3 }, edit),
  ];
  const agent = await open(script, { engineerMode: true, autoMode: true }, slowFailingCheck);
  try {
    const client = new AbortController();
    const response = await fetch(`${agent.base}/sessions/s_eng/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "build the lead tracker" }),
      signal: client.signal,
    });
    // Press Stop the moment the check starts, the way the gateway does.
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!/"name":"verify"/.test(seen)) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen += decoder.decode(chunk.value, { stream: true });
    }
    await fetch(`${agent.base}/sessions/s_eng/abort`, { method: "POST" });
    client.abort();
    const callsAtStop = agent.log.calls;

    let state = { busy: true };
    for (let i = 0; i < 100 && state.busy; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await (await fetch(`${agent.base}/sessions/s_eng/state`)).json();
    }
    // Long enough for a wrongly-started next pass to have made its first call.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(agent.log.calls, callsAtStop, "no model call after Stop");
  } finally {
    await agent.close();
  }
});

test("the next pass is shown the check that failed, not told it is above", async () => {
  // Found in review: when a pass ran out of steps, its failing check went into
  // the text the person sees and never into the model's conversation.
  const agent = await open(
    Array.from({ length: STEPS * 3 }, edit),
    { engineerMode: true, autoMode: true },
    failingCheck,
  );
  try {
    await agent.prompt("build the lead tracker");
    const next = agent.log.userMessages.find((message) => message.startsWith("keep going"));
    assert.match(String(next), /a check was failing/);
    assert.match(String(next), /TypeError: boom/, "the failure itself travels with the message");
  } finally {
    await agent.close();
  }
});

test("a second repair pass can recover a broken build without undoing feature work", async () => {
  const fix: Step = {
    events: [],
    result: {
      toolCalls: [
        {
          id: "repair",
          name: "write_file",
          input: { path: "src/healthy.ts", content: "export {};\n" },
        },
      ],
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 10 },
    },
  };
  const agent = await open(
    [
      ...Array.from({ length: STEPS * 2 }, edit),
      fix,
      say("Purpose: repair the build. Checks pass.\nREMAINING: none"),
    ],
    { engineerMode: true, autoMode: true },
    {
      "package.json": JSON.stringify({
        scripts: {
          typecheck: `node -e "if (!require('fs').existsSync('src/healthy.ts')) { console.error('TS2322: FooterProps mismatch'); process.exit(1); }"`,
        },
      }),
    },
  );
  try {
    const events = await agent.prompt("build the app");
    assert.equal(turns(events), 3);
    assert.equal(autoStop(events), undefined);
    const repairs = agent.log.userMessages.filter((m) => m.includes("This is a repair-only pass"));
    assert.equal(repairs.length, 2);
    for (const message of repairs) {
      assert.match(message, /TS2322: FooterProps mismatch/);
      assert.match(message, /Do not add features/);
    }
    assert.ok((await agent.files()).includes("work.ts"), "feature work is preserved");
  } finally {
    await agent.close();
  }
});
