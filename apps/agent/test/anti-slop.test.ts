import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import type {
  Conversation,
  ConversationOptions,
  ModelProvider,
  ProviderEvent,
  TurnResult,
} from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/**
 * 064 — the anti-slop fix.
 *
 * The founder picked "Designer" from the `/agent` menu in default mode and
 * nothing happened: the specialist pass tools existed only in Architect or
 * Engineer Mode, so the model had a hint pointing at a tool it had never been
 * given, and improvised — a `use_skill` call, then a hand-written `DESIGN.md`
 * and a claim it had "applied the Designer lens".
 *
 * Separately, the Designer child was told to pick from a `<design_references>`
 * list that no code path ever handed it, so every pass fell through to
 * "author from first principles" — the stock dark-purple — and the
 * 74-reference library shipped in 056 was never read.
 *
 * These tests hold both open. Unlike the other specialist suites, this
 * provider records the `ConversationOptions` each `AgentSession` was built
 * with, because the two regressions live in the tool list and in the child's
 * system prompt — neither of which is visible in the SSE stream.
 */

interface Built {
  options: ConversationOptions;
  /** Every text added back into the conversation after creation — nudges,
   * tool-result envelopes, and the auto-verification hand-back all land here. */
  injected: string[];
}

function recordingProvider(
  scripts: Array<Array<{ events: ProviderEvent[]; result: TurnResult }>>,
  built: Built[],
): ModelProvider {
  let session = 0;
  return {
    id: "anthropic",
    model: "scripted",
    createConversation(options: ConversationOptions) {
      const record: Built = { options, injected: [] };
      built.push(record);
      const script = scripts[Math.min(session++, scripts.length - 1)]!;
      let i = 0;
      const conversation: Conversation = {
        addUserMessage: (text: string) => {
          record.injected.push(text);
        },
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
const call = (name: string, input: Record<string, unknown>) => ({
  events: [text(`calling ${name}`)],
  result: {
    toolCalls: [{ id: `c_${name}`, name, input }],
    stopReason: "tool_use" as const,
    usage: { inputTokens: 5, outputTokens: 5 },
  },
});

const CATALOG =
  "- linear: a calm, dense product surface\n- stripe: precise, restrained, trust-forward";

async function setup(
  scripts: Array<Array<{ events: ProviderEvent[]; result: TurnResult }>>,
  { mode }: { mode?: "engineer" | "architect" } = {},
) {
  const built: Built[] = [];
  const workspaceDir = path.join(os.tmpdir(), `zelyq-antislop-${Date.now()}-${Math.random()}`);
  const projectId = "prj_slop";
  await fs.mkdir(path.join(workspaceDir, projectId, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, projectId, "src", "App.tsx"),
    "export default function App() {\n  return <div>app</div>;\n}\n",
  );
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
    maxTurnIterations: 4,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4981, 4989],
      previewHost: "127.0.0.1",
    },
  };
  // ONE provider instance for the whole server: `createConversation` runs
  // once per AgentSession, so script[0] is the parent and script[1..] the
  // children in dispatch order. A factory that built a fresh provider per
  // call would reset that counter and hand the child the parent's script.
  const provider = recordingProvider(scripts, built);
  const server = buildAgentServer(config, {
    providerFactory: () => provider,
    designRefCatalogText: CATALOG,
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const body: Record<string, unknown> = { sessionId: "s_a", projectId };
  if (mode === "engineer") body.engineerMode = true;
  if (mode === "architect") body.architectMode = true;
  const created = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(created.status, 201, await created.text());
  return { base, built, close: () => server.app.close() };
}

async function prompt(base: string, message: string, agents?: string[]): Promise<void> {
  const res = await fetch(`${base}/sessions/s_a/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, ...(agents ? { agents } : {}) }),
  });
  await res.text();
}

const toolNames = (b: Built) => b.options.tools.map((t) => t.name);

// ---------------------------------------------------------------------------
// Part A — an `/agent` pick makes that specialist runnable, in any mode.
// ---------------------------------------------------------------------------

test("064: default mode with no /agent pick has no specialist pass tools", async () => {
  // The contract: a user who never types `/agent` sees an unchanged tool
  // block. If this fails, every default turn is paying for four tools it was
  // never meant to have.
  const { base, built, close } = await setup([[say("done")]]);
  try {
    await prompt(base, "build me a page");
    const names = toolNames(built[0]!);
    assert.ok(!names.includes("design_pass"));
    assert.ok(!names.includes("ops_pass"));
    assert.ok(!names.includes("qa_pass"));
    assert.ok(!names.includes("cinematic_pass"));
  } finally {
    await close();
  }
});

test("064: /agent designer grants design_pass in DEFAULT mode", async () => {
  // The founder's exact case. Before 064 the tool was gated on
  // architectMode || engineerMode, so this list came back without it and the
  // model could not comply with its own instruction.
  const { base, built, close } = await setup([[say("done")]]);
  try {
    await prompt(base, "make it look designed", ["designer"]);
    const names = toolNames(built[0]!);
    assert.ok(names.includes("design_pass"), "design_pass must be granted by the pick");
    // Only the one that was picked.
    assert.ok(!names.includes("ops_pass"));
    assert.ok(!names.includes("qa_pass"));
  } finally {
    await close();
  }
});

test("064: each specialist name grants its own pass tool", async () => {
  for (const [name, tool] of [
    ["devops", "ops_pass"],
    ["security", "qa_pass"],
    ["cinematic", "cinematic_pass"],
  ] as const) {
    const { base, built, close } = await setup([[say("done")]]);
    try {
      await prompt(base, "do it", [name]);
      assert.ok(toolNames(built[0]!).includes(tool), `${name} must grant ${tool}`);
    } finally {
      await close();
    }
  }
});

test("064: the grant is sticky across turns and never duplicates a tool", async () => {
  // Sticky by design: on Anthropic the tool block sits ahead of the system
  // prompt in the cache prefix, so a list that churns per turn would
  // invalidate the cache_control breakpoint on every turn after the pick.
  // Adding once costs one invalidation, then the prefix is stable again.
  const { base, built, close } = await setup([[say("one"), say("two"), say("three")]]);
  try {
    await prompt(base, "make it look designed", ["designer"]);
    await prompt(base, "and again", ["designer"]);
    await prompt(base, "now something else");
    const names = toolNames(built[0]!);
    assert.equal(
      names.filter((n) => n === "design_pass").length,
      1,
      "a second pick must not push a duplicate",
    );
    assert.ok(names.includes("design_pass"), "the grant survives a later turn with no pick");
  } finally {
    await close();
  }
});

test("064: an unknown /agent name is dropped, not a failed turn", async () => {
  const { base, built, close } = await setup([[say("done")]]);
  try {
    await prompt(base, "do the thing", ["not-a-specialist"]);
    const names = toolNames(built[0]!);
    assert.ok(!names.includes("design_pass"));
    assert.equal(built.length, 1, "the turn still ran");
  } finally {
    await close();
  }
});

test("064: Engineer Mode still has the specialist tools with no pick (no regression)", async () => {
  const { base, built, close } = await setup([[say("done")]], { mode: "engineer" });
  try {
    await prompt(base, "build it");
    const names = toolNames(built[0]!);
    for (const tool of ["design_pass", "ops_pass", "qa_pass", "cinematic_pass"]) {
      assert.ok(names.includes(tool), `${tool} must stay available in Engineer Mode`);
    }
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Part B — the Designer child receives <design_references>.
// ---------------------------------------------------------------------------

test("064: a design_pass in default mode dispatches a child that HAS the library", async () => {
  // The whole point of Part A + B shipping together: a Designer that runs and
  // still cannot see the 74 references would produce the same slop, while
  // looking fixed.
  const parent = [call("design_pass", { scope: "the whole app" }), say("relayed")];
  const child = [say('DESIGN.md refined — adapted from the "linear" reference')];
  const { base, built, close } = await setup([parent, child]);
  try {
    await prompt(base, "make it look designed", ["designer"]);
    assert.equal(built.length, 2, "the Designer child must actually be created");
    const childPrompt = built[1]!.options.systemPrompt;
    assert.match(childPrompt, /<design_references>/);
    assert.match(childPrompt, /- linear: a calm, dense product surface/);
    assert.match(childPrompt, /- stripe: precise, restrained, trust-forward/);
  } finally {
    await close();
  }
});

test("064: the child's own instructions still follow the reference block", async () => {
  // Order matters: step 2 of DESIGNER_SYSTEM_PROMPT reads the list before it
  // writes DESIGN.md, so the list has to be above it.
  const parent = [call("design_pass", {}), say("relayed")];
  const { base, built, close } = await setup([parent, [say("done")]]);
  try {
    await prompt(base, "design it", ["designer"]);
    const childPrompt = built[1]!.options.systemPrompt;
    const refs = childPrompt.indexOf("<design_references>");
    const own = childPrompt.indexOf("OWN THE GUIDE");
    assert.ok(refs >= 0 && own > refs, "the reference block must precede the Designer's steps");
  } finally {
    await close();
  }
});

test("064: a non-design specialist child does NOT get the design library", async () => {
  // A CI pipeline has no design language; this is dead weight in its prompt.
  const parent = [call("ops_pass", {}), say("relayed")];
  const { base, built, close } = await setup([parent, [say("done")]]);
  try {
    await prompt(base, "set up CI", ["devops"]);
    assert.equal(built.length, 2);
    assert.doesNotMatch(built[1]!.options.systemPrompt, /<design_references>/);
  } finally {
    await close();
  }
});

test("064: the Designer child gets the library in Engineer Mode too", async () => {
  // Root cause B was never a default-mode-only bug — it bit every mode.
  const parent = [call("design_pass", {}), say("relayed")];
  const { base, built, close } = await setup([parent, [say("done")]], { mode: "engineer" });
  try {
    await prompt(base, "design it");
    assert.equal(built.length, 2);
    assert.match(built[1]!.options.systemPrompt, /<design_references>/);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Part C — the weak-model backstop. The grant + the withAgents instruction
// get a capable model to call the pass tool on its own (verified live on
// gpt-5.2). A weak one (Gemini Flash) tends to just build files itself. If
// a picked specialist's pass tool is never called, the turn gets one firm
// re-nudge before it is allowed to end.
// ---------------------------------------------------------------------------

test("064: /agent designer + a turn that never calls design_pass gets one re-nudge", async () => {
  // The model "does the work itself" and stops. The session must send it back.
  const parent = [say("I restyled the components directly."), say("ok, done now")];
  const { base, built, close } = await setup([parent]);
  try {
    await prompt(base, "make it look designed", ["designer"]);
    // Keyed on the nudge's own wording — the woven prompt also names the tool.
    const nudges = built[0]!.injected.filter((m) => m.includes("but you have not called"));
    assert.equal(nudges.length, 1, "exactly one re-nudge");
    assert.match(nudges[0]!, /have `design_pass` available/);
    assert.match(nudges[0]!, /not doing the work yourself/);
  } finally {
    await close();
  }
});

test("064: the re-nudge is one-shot — a model that still refuses ends the turn", async () => {
  // Three plain replies: initial, post-nudge, and the fallback the loop would
  // ask for. If the backstop looped it would never terminate.
  const parent = [say("did it myself"), say("still not calling it"), say("nope")];
  const { base, built, close } = await setup([parent]);
  try {
    await prompt(base, "designer please", ["designer"]);
    const nudges = built[0]!.injected.filter((m) => m.includes("but you have not called"));
    assert.equal(nudges.length, 1, "never more than one specialist-pick nudge");
  } finally {
    await close();
  }
});

test("064: no re-nudge when the turn DID call the picked pass tool", async () => {
  const parent = [call("design_pass", { scope: "app" }), say("relayed the review")];
  const { base, built, close } = await setup([parent, [say("DESIGN.md refined")]]);
  try {
    await prompt(base, "make it look designed", ["designer"]);
    assert.ok(
      !built[0]!.injected.some((m) => m.includes("you have not called")),
      "a turn that ran the pass must not be nudged",
    );
  } finally {
    await close();
  }
});

test("064: no specialist-pick nudge when no /agent pick was made", async () => {
  const parent = [say("built the page, no pick here")];
  const { base, built, close } = await setup([parent]);
  try {
    await prompt(base, "just build a page");
    assert.ok(!built[0]!.injected.some((m) => m.includes("/agent menu")));
  } finally {
    await close();
  }
});
