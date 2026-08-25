import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ALL_TOOLS } from "@zelyq/tools";
import type { AgentConfig } from "../src/config.js";
import type {
  Conversation,
  ModelProvider,
  ProviderEvent,
  ToolResult,
  TurnResult,
} from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";
import { buildUseSkillTool, loadSkills } from "../src/skills.js";

/**
 * Skills — see `042` in the council notes. `loadSkills` is exercised
 * against a real filesystem, real malformed files included, the same
 * standard `plugins.test.ts` already holds for `037` — a mocked reader
 * would only prove the mock agrees with the implementation. The last test
 * goes further, the way the proposal promised: a real live turn, through
 * a real HTTP server and real tool execution, proving the model can
 * actually reach a skill's full instructions, not just that the loader
 * produces the right in-memory shape.
 */

let tmp: string;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-skills-"));
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function capturingLogger() {
  const warnings: string[] = [];
  const infos: string[] = [];
  return {
    logger: { warn: (m: string) => warnings.push(m), info: (m: string) => infos.push(m) },
    warnings,
    infos,
  };
}

async function writeSkill(dir: string, filename: string, content: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), content, "utf8");
}

const VALID = `---
name: word-golf
description: Say hello in as few words as possible.
---

Just say "hi". Nothing else.
`;

test("no directories at all means nothing loaded, and nothing to crash on", async () => {
  const { logger } = capturingLogger();
  const result = await loadSkills(undefined, undefined, logger);
  assert.deepEqual(result, { skills: [], skipped: [] });
});

test("a missing built-in directory warns and returns empty, without crashing boot", async () => {
  const { logger, warnings } = capturingLogger();
  const result = await loadSkills(path.join(tmp, "does-not-exist"), undefined, logger);
  assert.deepEqual(result.skills, []);
  assert.equal(warnings.length, 1);
});

test("a real, valid skill loads with its name, description, and body intact", async () => {
  const dir = path.join(tmp, "valid");
  await writeSkill(dir, "word-golf.md", VALID);

  const { logger, infos } = capturingLogger();
  const result = await loadSkills(dir, undefined, logger);

  assert.equal(result.skills.length, 1);
  const skill = result.skills[0]!;
  assert.equal(skill.name, "word-golf");
  assert.equal(skill.description, "Say hello in as few words as possible.");
  assert.equal(skill.body, 'Just say "hi". Nothing else.');
  assert.equal(skill.source, "built-in");
  assert.ok(infos.some((m) => m.includes("word-golf")));
});

test("missing frontmatter is skipped with a clear reason, not silently dropped", async () => {
  const dir = path.join(tmp, "no-frontmatter");
  await writeSkill(dir, "broken.md", "Just some instructions, no --- block at all.\n");

  const { logger, warnings } = capturingLogger();
  const result = await loadSkills(dir, undefined, logger);

  assert.equal(result.skills.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason ?? "", /frontmatter/);
  assert.ok(warnings.some((m) => m.includes("broken.md")));
});

test("a name that isn't lowercase-and-hyphens is rejected, not silently accepted", async () => {
  const dir = path.join(tmp, "bad-name");
  await writeSkill(dir, "shouty.md", "---\nname: Stripe_Checkout\ndescription: d\n---\n\nbody\n");

  const { logger, warnings } = capturingLogger();
  const result = await loadSkills(dir, undefined, logger);

  assert.equal(result.skills.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /lowercase/);
  assert.ok(warnings.some((m) => m.includes("shouty.md")));
});

test("a missing description is rejected — it's the only thing always in context", async () => {
  const dir = path.join(tmp, "no-description");
  await writeSkill(dir, "thin.md", "---\nname: thin\n---\n\nsome body\n");

  const result = await loadSkills(dir, undefined, { warn: () => undefined, info: () => undefined });
  assert.equal(result.skills.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /description/);
});

test("frontmatter with nothing after it is rejected — a skill with no instructions teaches nothing", async () => {
  const dir = path.join(tmp, "empty-body");
  await writeSkill(dir, "hollow.md", "---\nname: hollow\ndescription: d\n---\n\n   \n");

  const result = await loadSkills(dir, undefined, { warn: () => undefined, info: () => undefined });
  assert.equal(result.skills.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /no instructions/);
});

test("one bad file does not stop the rest of the directory from loading", async () => {
  const dir = path.join(tmp, "mixed");
  await writeSkill(dir, "broken.md", "no frontmatter here\n");
  await writeSkill(dir, "zzz-good.md", "---\nname: zzz-good\ndescription: d\n---\n\nbody\n");

  const result = await loadSkills(dir, undefined, { warn: () => undefined, info: () => undefined });
  assert.deepEqual(
    result.skills.map((s) => s.name),
    ["zzz-good"],
  );
  assert.equal(result.skipped.length, 1);
});

test("an operator skill with the same name as a built-in replaces it, source and all", async () => {
  const builtIn = path.join(tmp, "builtin-override");
  const operator = path.join(tmp, "operator-override");
  await writeSkill(
    builtIn,
    "greet.md",
    "---\nname: greet\ndescription: the box's version\n---\n\nbox body\n",
  );
  await writeSkill(
    operator,
    "greet.md",
    "---\nname: greet\ndescription: our house version\n---\n\nhouse body\n",
  );

  const { logger, infos } = capturingLogger();
  const result = await loadSkills(builtIn, operator, logger);

  assert.equal(result.skills.length, 1, "one skill, not two — the operator's wins outright");
  assert.equal(result.skills[0]?.description, "our house version");
  assert.equal(result.skills[0]?.source, "operator");
  assert.ok(infos.some((m) => m.includes("replacing")));
});

test("the repo's own skills/ directory actually loads — guards against future drift breaking the format", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const result = await loadSkills(path.join(repoRoot, "skills"), undefined, {
    warn: () => undefined,
    info: () => undefined,
  });

  assert.equal(
    result.skipped.length,
    0,
    `a built-in skill failed to load: ${JSON.stringify(result.skipped)}`,
  );
  assert.ok(
    result.skills.some((s) => s.name === "stripe-checkout"),
    "stripe-checkout is missing from what actually shipped",
  );
  assert.ok(
    result.skills.some((s) => s.name === "shadcn-ui-setup"),
    "shadcn-ui-setup is missing from what actually shipped",
  );
  for (const skill of result.skills) {
    assert.ok(
      skill.description.length > 20,
      `${skill.name}'s description is too thin to be useful`,
    );
    assert.ok(skill.body.length > 100, `${skill.name}'s body looks empty or placeholder-only`);
  }
});

test("buildUseSkillTool: a known skill returns its full body", async () => {
  const tool = buildUseSkillTool([
    { name: "word-golf", description: "d", body: "the real instructions", source: "built-in" },
  ]);
  const result = await tool.run(fakeContext(), { name: "word-golf" });
  assert.equal(result.output, "the real instructions");
  assert.notEqual(result.isError, true);
});

test("buildUseSkillTool: an unknown skill names what is actually available", async () => {
  const tool = buildUseSkillTool([
    { name: "real-one", description: "d", body: "b", source: "built-in" },
  ]);
  const result = await tool.run(fakeContext(), { name: "made-up" });
  assert.equal(result.isError, true);
  assert.match(result.output, /real-one/);
});

function fakeContext() {
  return {
    projectId: "prj_test",
    runtime: {} as never,
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
  };
}

// ---------------------------------------------------------------------------
// A real live turn: the catalog reaches the prompt, and use_skill actually
// runs through the same executeTool/ALL_TOOLS path a real session uses.
// ---------------------------------------------------------------------------

test("a live turn: the prompt carries the catalog, and use_skill returns the real body through a real tool call", async () => {
  const skill = {
    name: "test-skill",
    description: "A skill only this test knows about",
    body: "THE REAL SKILL BODY",
    source: "built-in" as const,
  };
  const tool = buildUseSkillTool([skill]);
  ALL_TOOLS.push(tool);

  let capturedSystemPrompt = "";
  const provider: ModelProvider = {
    id: "anthropic",
    model: "scripted",
    createConversation: (options) => {
      capturedSystemPrompt = options.systemPrompt;
      let turnIndex = 0;
      const script: Array<{ events: ProviderEvent[]; result: TurnResult }> = [
        {
          events: [],
          result: {
            toolCalls: [{ id: "call_1", name: "use_skill", input: { name: "test-skill" } }],
            stopReason: "tool_use",
            usage: { inputTokens: 5, outputTokens: 2 },
          },
        },
        {
          events: [{ type: "text", text: "done" }],
          result: {
            toolCalls: [],
            stopReason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        },
      ];
      const conversation: Conversation = {
        addUserMessage: () => undefined,
        addToolResults: (_results: ToolResult[]) => undefined,
        async *stream() {
          const step = script[Math.min(turnIndex++, script.length - 1)]!;
          for (const event of step.events) yield event;
          return step.result;
        },
      };
      return conversation;
    },
  };

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
    maxTurnIterations: 5,
    runtime: {
      kind: "local",
      workspaceDir: path.join(os.tmpdir(), `zelyq-skills-turn-${Date.now()}`),
      execTimeoutMs: 10_000,
      previewPortRange: [4981, 4989],
      previewHost: "127.0.0.1",
    },
  };

  const server = buildAgentServer(config, {
    providerFactory: () => provider,
    skills: [{ name: skill.name, description: skill.description }],
  });

  try {
    await server.app.listen({ host: "127.0.0.1", port: 0 });
    const address = server.app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "ses_skill", projectId: "prj_skill" }),
    });
    assert.equal(created.status, 201);

    // The catalog is what reaches every session's prompt — asserted before
    // the turn even runs, so a broken catalog fails here, not by accident
    // further down.
    assert.match(capturedSystemPrompt, /<skills>/);
    assert.match(capturedSystemPrompt, /test-skill: A skill only this test knows about/);

    const response = await fetch(`${base}/sessions/ses_skill/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "do the thing" }),
    });
    const text = await response.text();
    const events = text
      .split("\n\n")
      .map((frame) => frame.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; call?: { result?: string } });

    const toolEnd = events.find((event) => event.type === "tool.end");
    assert.ok(toolEnd, "use_skill never ran");
    assert.equal(
      toolEnd?.call?.result,
      "THE REAL SKILL BODY",
      "the model must receive the skill's actual instructions, not a stand-in",
    );
  } finally {
    await server.close();
    // Never leak a test-only tool into whatever other file's process reuses
    // this same shared ALL_TOOLS array.
    const index = ALL_TOOLS.indexOf(tool);
    if (index !== -1) ALL_TOOLS.splice(index, 1);
  }
});
