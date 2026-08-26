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
 * ZED-0001, Phase 1's structural anchor — the purpose-framing shape check on
 * the same forced post-loop gate the automatic-verification tests in
 * `verification.test.ts` already exercise. A scripted provider, same shape
 * as that file's, kept local for the same reason its own comment gives.
 */
function scriptedProvider(
  script: Array<{ events: ProviderEvent[]; result: TurnResult }>,
): ModelProvider {
  let turnIndex = 0;
  const conversation: Conversation = {
    addUserMessage: () => undefined,
    addToolResults: (_results: ToolResult[]) => undefined,
    async *stream() {
      const step = script[Math.min(turnIndex++, script.length - 1)]!;
      for (const event of step.events) yield event;
      return step.result;
    },
  };
  return { id: "anthropic", model: "scripted", createConversation: () => conversation };
}

async function collectTurn(url: string): Promise<Array<{ type: string; [key: string]: unknown }>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "build something" }),
  });
  const text = await response.text();
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

async function setup(
  script: Array<{ events: ProviderEvent[]; result: TurnResult }>,
  engineerMode: boolean,
  maxIterations = 5,
  preExistingFiles: Record<string, string> = {},
): Promise<{ base: string; workspaceDir: string; projectId: string; close(): Promise<void> }> {
  const workspaceDir = path.join(
    os.tmpdir(),
    `zelyq-engineer-mode-test-${Date.now()}-${Math.random()}`,
  );
  const projectId = "prj_em";
  // No typecheck/build script — these tests isolate the structural anchor
  // from automatic verification, already covered on its own in
  // verification.test.ts. Both gates firing on the same scripted turn would
  // make it unclear which one produced a given hand-back.
  await fs.mkdir(path.join(workspaceDir, projectId), { recursive: true });
  // Simulates a project that didn't start empty this turn — the exact
  // shape of the false-positive a live incident found: a rewrite of a file
  // that was already there must never count toward the new-file cap.
  for (const [relativePath, content] of Object.entries(preExistingFiles)) {
    const absolute = path.join(workspaceDir, projectId, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
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
    apiKey: "test-key",
    maxTurnIterations: maxIterations,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4991, 4999],
      previewHost: "127.0.0.1",
    },
  };

  const server = buildAgentServer(config, { providerFactory: () => scriptedProvider(script) });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "ses_em", projectId, engineerMode }),
  });
  assert.equal(created.status, 201, await created.text());

  return { base, workspaceDir, projectId, close: () => server.app.close() };
}

const writesAFileNoMarker = {
  events: [{ type: "text" as const, text: "Writing it." }],
  result: {
    toolCalls: [{ id: "call_1", name: "write_file", input: { path: "src/App.tsx", content: "x" } }],
    stopReason: "tool_use" as const,
    usage: { inputTokens: 5, outputTokens: 5 },
  },
};

const saysDoneNoMarker = {
  events: [{ type: "text" as const, text: "Done." }],
  result: {
    toolCalls: [],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 3, outputTokens: 2 },
  },
};

const saysDoneWithMarker = {
  events: [{ type: "text" as const, text: "Purpose: add the missing button. Done." }],
  result: {
    toolCalls: [],
    stopReason: "end_turn" as const,
    usage: { inputTokens: 3, outputTokens: 2 },
  },
};

test("engineer mode: a turn that changes a file without the purpose marker is handed back once", async () => {
  const { base, close } = await setup(
    [writesAFileNoMarker, saysDoneNoMarker, saysDoneWithMarker],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    // Three script steps only resolve if the turn actually took the extra
    // round the hand-back forces — a turn that ended on the first "Done."
    // would never reach the third step at all.
    assert.equal(events.at(-1)?.type, "turn.end");
    const textDeltas = events
      .filter((event) => event.type === "text.delta")
      .map((event) => event.text)
      .join("");
    assert.match(textDeltas, /Purpose:/);
  } finally {
    await close();
  }
});

test("engineer mode: the hand-back happens only once, not forever, on a model that never adds the marker", async () => {
  // maxIterations is 5 (see setup's config) and the scripted provider
  // clamps to its last step once exhausted — a regressed, unbounded
  // hand-back would still eventually stop, at the iteration cap, and
  // still end on a "turn.end" event. Counting tool.start alone can't tell
  // that apart from the correct, once-bounded behavior: a hand-back never
  // produces a tool call itself, only a fresh round of text. Counting
  // iterations directly — one per "text.delta" burst — is what actually
  // distinguishes "stopped after one hand-back" (3: write, first "Done.",
  // second "Done.") from "regressed to unbounded" (5: ran to the cap).
  const { base, close } = await setup(
    [writesAFileNoMarker, saysDoneNoMarker, saysDoneNoMarker, saysDoneNoMarker],
    true,
  );
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    assert.equal(events.at(-1)?.type, "turn.end");
    const textBursts = events.filter((event) => event.type === "text.delta");
    assert.equal(
      textBursts.length,
      3,
      "3 iterations (write, hand-back, accepted) proves the bound — 5 would mean it ran to the cap instead",
    );
    const toolStarts = events.filter((event) => event.type === "tool.start");
    assert.equal(
      toolStarts.length,
      1,
      "only the original write_file call, no verify-style retries",
    );
  } finally {
    await close();
  }
});

test("engineer mode: a turn with the marker already present is not handed back", async () => {
  // Same reasoning as the test above: only two script steps are provided,
  // so a hand-back that fired would clamp to replaying the second step —
  // itself carrying the marker, so it would pass too, and the turn would
  // still end normally. Counting iterations, not just outcome, is what
  // actually proves no extra round happened.
  const { base, close } = await setup([writesAFileNoMarker, saysDoneWithMarker], true);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    assert.equal(events.at(-1)?.type, "turn.end");
    const textBursts = events.filter((event) => event.type === "text.delta");
    assert.equal(textBursts.length, 2, "write then done — a hand-back would make this 3");
    const toolStarts = events.filter((event) => event.type === "tool.start");
    assert.equal(toolStarts.length, 1);
  } finally {
    await close();
  }
});

test("engineer mode: a turn that changes nothing is exempt, marker or not", async () => {
  const readsOnly = {
    events: [{ type: "text" as const, text: "Just looking, nothing to change." }],
    result: {
      toolCalls: [],
      stopReason: "end_turn" as const,
      usage: { inputTokens: 2, outputTokens: 2 },
    },
  };
  const { base, close } = await setup([readsOnly], true);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    assert.equal(events.at(-1)?.type, "turn.end");
    const errorEvents = events.filter((event) => event.type === "error");
    assert.equal(errorEvents.length, 0);
  } finally {
    await close();
  }
});

test("engineer mode off: a file changed with no marker is never handed back — default behavior unchanged", async () => {
  const { base, close } = await setup([writesAFileNoMarker, saysDoneNoMarker], false);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    assert.equal(events.at(-1)?.type, "turn.end");
    const toolStarts = events.filter((event) => event.type === "tool.start");
    assert.equal(toolStarts.length, 1, "no structural hand-back outside engineer mode");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// The new-file checkpoint — added after a live incident: a vague, exploratory
// prompt ("I'm testing you, I want to build X") produced three imagined
// subsystems and 22 files before anything stopped it, in Engineer Mode, with
// the mode's own prose doing nothing to prevent it. This reproduces that
// shape directly: a scripted provider that keeps inventing new files exactly
// the way the real one did, and proves the cap actually refuses them rather
// than only asking nicely.
// ---------------------------------------------------------------------------

function writesFile(fileNumber: number) {
  return {
    events: [{ type: "text" as const, text: `Building piece ${fileNumber}.` }],
    result: {
      toolCalls: [
        {
          id: `call_${fileNumber}`,
          name: "write_file",
          input: { path: `src/invented/Piece${fileNumber}.tsx`, content: "x" },
        },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
}

test("engineer mode: the 7th new file in one turn is refused, not written", async () => {
  // 8 distinct new-file attempts, one per iteration — the shape the real
  // incident actually had (many small tool-call rounds), not one giant
  // batch — then a closing step with the marker already present, so the
  // turn actually ends instead of clamping to the last write forever.
  const script = [1, 2, 3, 4, 5, 6, 7, 8].map(writesFile).concat([saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 15);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    assert.equal(
      toolEnds.length,
      8,
      "all 8 attempts happen — refusal is a tool result, not a dropped call",
    );

    const succeeded = toolEnds.filter((event) => !(event.call as { isError: boolean }).isError);
    const refused = toolEnds.filter((event) => (event.call as { isError: boolean }).isError);
    assert.equal(succeeded.length, 6, "exactly 6 files actually get written — the checkpoint");
    assert.equal(refused.length, 2, "the 7th and 8th are both refused");
    // The 7th call is the one that trips the checkpoint; the 8th is a
    // mutating call refused because the checkpoint was already reached —
    // two different, deliberately distinct messages (see MUTATING_TOOL_NAMES
    // and the checkpointReached comment in session.ts).
    const [seventh, eighth] = refused.map((event) => (event.call as { result: string }).result);
    assert.match(seventh!, /refusing to create another/);
    assert.match(eighth!, /checkpoint was already reached/);
  } finally {
    await close();
  }
});

test("engineer mode: the checkpoint does not reopen once tripped, even for a later distinct path", async () => {
  const script = [1, 2, 3, 4, 5, 6, 7].map(writesFile).concat([saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 12);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const last = toolEnds.at(-1) as { call: { isError: boolean; input: { path: string } } };
    assert.equal(
      last.call.isError,
      true,
      "the 7th distinct path is still refused, not a fresh count",
    );
  } finally {
    await close();
  }
});

test("engineer mode: exactly at the checkpoint (6 files), nothing is refused", async () => {
  const script = [1, 2, 3, 4, 5, 6].map(writesFile).concat([saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 10);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    assert.equal(toolEnds.length, 6);
    assert.ok(
      toolEnds.every((event) => !(event.call as { isError: boolean }).isError),
      "6 new files is the allowed boundary, not already over it",
    );
  } finally {
    await close();
  }
});

test("engineer mode off: the checkpoint does not apply at all — default mode is unaffected", async () => {
  // Same shape that trips the cap in engineer mode, run with it off. This is
  // a deliberate scope decision (see the ZED-0001 incident addendum): the
  // same failure exists in default mode too, per prior research, but fixing
  // that is a separate decision this entry does not make unilaterally.
  const script = [1, 2, 3, 4, 5, 6, 7, 8].map(writesFile).concat([saysDoneNoMarker]);
  const { base, close } = await setup(script, false, 15);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    assert.equal(toolEnds.length, 8);
    assert.ok(
      toolEnds.every((event) => !(event.call as { isError: boolean }).isError),
      "no cap outside engineer mode",
    );
  } finally {
    await close();
  }
});

test("engineer mode: editing an already-created file is never blocked by the checkpoint", async () => {
  // 6 new files to trip the cap, then an edit_file on one of them — must
  // succeed, since the cap is about inventing more scope, not about
  // continuing to work on what's already there.
  const editStep = {
    events: [{ type: "text" as const, text: "Refining piece 1." }],
    result: {
      toolCalls: [
        {
          id: "call_edit",
          name: "edit_file",
          input: { path: "src/invented/Piece1.tsx", old_string: "x", new_string: "y" },
        },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  const script = [1, 2, 3, 4, 5, 6].map(writesFile).concat([editStep, saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 12);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const editResult = toolEnds.find(
      (event) => (event.call as { name: string }).name === "edit_file",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(editResult, "the edit_file call must actually have run");
    // It may still fail for its own reasons (the tool's own match logic),
    // but never with the checkpoint's specific refusal message.
    assert.doesNotMatch(editResult!.call.result, /refusing to create another/);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Two real gaps a live incident found in the checkpoint above, both fixed
// in the same round: a rewrite of a file that already existed got wrongly
// capped, and — once it did — the model routed around the refusal entirely
// through `run_command`, which the cap never touched.
// ---------------------------------------------------------------------------

test("engineer mode: rewriting a file that already existed before this turn is never capped, even past the checkpoint", async () => {
  const rewritesAppTsx = {
    events: [{ type: "text" as const, text: "Wiring it up." }],
    result: {
      toolCalls: [
        { id: "call_apptsx", name: "write_file", input: { path: "src/App.tsx", content: "y" } },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  const script = [1, 2, 3, 4, 5, 6].map(writesFile).concat([rewritesAppTsx, saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 12, {
    "src/App.tsx": "original template content",
  });
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const appTsxResult = toolEnds.find(
      (event) => (event.call as { input: { path?: string } }).input.path === "src/App.tsx",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(appTsxResult, "the App.tsx rewrite must actually have been attempted");
    assert.equal(
      appTsxResult!.call.isError,
      false,
      "a file that already existed before the turn must never be capped, no matter how many new files preceded it",
    );
  } finally {
    await close();
  }
});

test("engineer mode: a shell command that creates new files is counted toward the same cap", async () => {
  // A real command, run by the real LocalRuntimeDriver — this is exactly
  // the bypass the incident found: files created through run_command
  // never went through write_file's own check at all.
  const shellCreatesSevenFiles = {
    events: [{ type: "text" as const, text: "Scaffolding via a script." }],
    result: {
      toolCalls: [
        {
          id: "call_shell",
          name: "run_command",
          input: {
            command:
              "mkdir -p src/generated && for i in 1 2 3 4 5 6 7; do echo x > src/generated/f$i.ts; done",
          },
        },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  const attemptsAnEighthFile = {
    events: [{ type: "text" as const, text: "One more." }],
    result: {
      toolCalls: [
        { id: "call_8th", name: "write_file", input: { path: "src/one_more.ts", content: "x" } },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  const script = [shellCreatesSevenFiles, attemptsAnEighthFile, saysDoneWithMarker];
  const { base, close } = await setup(script, true, 10);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    // The corrective message fires as a synthetic user message, not a
    // tool result — visible here as an extra iteration's worth of text
    // before the model's next reply, i.e. the turn takes the 3rd script
    // step (attemptsAnEighthFile) and then a 4th (saysDoneWithMarker)
    // rather than ending after the 2nd.
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const eighthFileResult = toolEnds.find(
      (event) => (event.call as { input: { path?: string } }).input.path === "src/one_more.ts",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(eighthFileResult, "the 8th file's write_file attempt must actually have run");
    assert.equal(
      eighthFileResult!.call.isError,
      true,
      "write_file must be refused once files created via run_command already reached the checkpoint",
    );
    // The checkpoint was already reached by the run_command's own 7 files
    // (over the 6-file line) before this write_file attempt ever ran, so
    // this is the "already reached" message, not the "just reached" one.
    assert.match(eighthFileResult!.call.result, /checkpoint was already reached/);
  } finally {
    await close();
  }
});

test("engineer mode: a shell command creating fewer files than the checkpoint does not falsely trip it", async () => {
  const shellCreatesTwoFiles = {
    events: [{ type: "text" as const, text: "Small script." }],
    result: {
      toolCalls: [
        {
          id: "call_shell_small",
          name: "run_command",
          input: { command: "mkdir -p src/g && echo x > src/g/one.ts && echo x > src/g/two.ts" },
        },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  const script = [shellCreatesTwoFiles, saysDoneWithMarker];
  const { base, close } = await setup(script, true, 10);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const errorEvents = events.filter((event) => event.type === "error");
    assert.equal(errorEvents.length, 0);
    const textDeltas = events
      .filter((event) => event.type === "text.delta")
      .map((event) => event.text)
      .join("");
    assert.doesNotMatch(
      textDeltas,
      /refusing to create another/,
      "two new files from a shell command must not trip a 6-file checkpoint",
    );
  } finally {
    await close();
  }
});

test("engineer mode: a lockfile a shell command writes does not consume a slot in the checkpoint", async () => {
  // Found live: `npm install` creating package-lock.json got counted by
  // the reactive run_command check the same as an actually-invented
  // file, silently costing one of six real slots for something the
  // model never chose to create. This writes the lockfile directly, via
  // a real shell command through the real runtime, the same way the
  // other run_command tests in this file do — a real `npm install`
  // would be slow and network-dependent for no extra signal, since what
  // is being tested is the reactive diff's own filtering, not npm.
  const writesLockfile = {
    events: [{ type: "text" as const, text: "Installing a dependency." }],
    result: {
      toolCalls: [
        {
          id: "call_npm",
          name: "run_command",
          input: { command: "echo '{}' > package-lock.json" },
        },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  const script = [writesLockfile, ...[1, 2, 3, 4, 5, 6].map(writesFile), saysDoneWithMarker];
  const { base, close } = await setup(script, true, 12);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const refused = toolEnds.filter((event) => (event.call as { isError: boolean }).isError);
    assert.equal(
      refused.length,
      0,
      "all 6 real files must succeed — the lockfile must not have consumed one of the 6 slots",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// The real design flaw a second live incident found: refusing only the
// write that crosses the checkpoint, while leaving edit_file and
// run_command open, does not stop the model — it just removes the option
// to decompose properly, and it crams the remaining planned work into
// whatever file it can still touch instead. These tests are the actual
// fix: once the checkpoint is reached, no mutating tool runs, period.
// ---------------------------------------------------------------------------

test("engineer mode: once the checkpoint is reached, edit_file is refused too — not just new writes", async () => {
  const editsAppTsxAfterCheckpoint = {
    events: [{ type: "text" as const, text: "Cramming it in instead." }],
    result: {
      toolCalls: [
        {
          id: "call_cram",
          name: "edit_file",
          input: { path: "src/App.tsx", old_text: "x", new_text: "y" },
        },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  // 7 writes, not 6 — the 7th is what actually flips checkpointReached to
  // true. Six alone reaches the count but never trips anything, since
  // nothing has tried to go past it yet.
  const script = [1, 2, 3, 4, 5, 6, 7]
    .map(writesFile)
    .concat([editsAppTsxAfterCheckpoint, saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 12, { "src/App.tsx": "original" });
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const editResult = toolEnds.find(
      (event) => (event.call as { name: string }).name === "edit_file",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(editResult, "the edit_file attempt must actually have run");
    assert.equal(
      editResult!.call.isError,
      true,
      "edit_file must be refused too, once 6 new files were created this turn — this is the actual fix for cramming everything into one file instead of stopping",
    );
    assert.match(editResult!.call.result, /checkpoint was already reached/);
  } finally {
    await close();
  }
});

test("engineer mode: once the checkpoint is reached, a further run_command is refused too", async () => {
  const shellAfterCheckpoint = {
    events: [{ type: "text" as const, text: "One more script." }],
    result: {
      toolCalls: [
        { id: "call_more_shell", name: "run_command", input: { command: "npm install" } },
      ],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  // 7 writes, not 6 — see the comment on the edit_file test above.
  const script = [1, 2, 3, 4, 5, 6, 7]
    .map(writesFile)
    .concat([shellAfterCheckpoint, saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 12);
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const shellResult = toolEnds.find(
      (event) => (event.call as { name: string }).name === "run_command",
    ) as { call: { isError: boolean; result: string } } | undefined;
    assert.ok(
      shellResult,
      "the run_command attempt must actually have run through the refusal path",
    );
    assert.equal(shellResult!.call.isError, true);
    assert.match(shellResult!.call.result, /checkpoint was already reached/);
  } finally {
    await close();
  }
});

test("engineer mode: read-only tools still work after the checkpoint is reached", async () => {
  const readsAfterCheckpoint = {
    events: [{ type: "text" as const, text: "Checking what exists." }],
    result: {
      toolCalls: [{ id: "call_read", name: "read_file", input: { path: "src/App.tsx" } }],
      stopReason: "tool_use" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    },
  };
  // 7 writes, not 6 — this must genuinely reach checkpointReached first,
  // or this test would pass for the wrong reason (read_file always works,
  // checkpoint or not — the point is proving it still works once the
  // checkpoint actually has been reached).
  const script = [1, 2, 3, 4, 5, 6, 7]
    .map(writesFile)
    .concat([readsAfterCheckpoint, saysDoneWithMarker]);
  const { base, close } = await setup(script, true, 12, { "src/App.tsx": "original" });
  try {
    const events = await collectTurn(`${base}/sessions/ses_em/prompt`);
    const toolEnds = events.filter((event) => event.type === "tool.end");
    const readResult = toolEnds.find(
      (event) => (event.call as { name: string }).name === "read_file",
    ) as { call: { isError: boolean } } | undefined;
    assert.ok(readResult, "the read_file attempt must actually have run");
    assert.equal(
      readResult!.call.isError,
      false,
      "read-only tools must stay available after the checkpoint, so the model can still write an accurate summary",
    );
  } finally {
    await close();
  }
});
