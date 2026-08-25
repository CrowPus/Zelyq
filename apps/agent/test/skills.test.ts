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
 * Skills — see `042` in the council notes. A skill is a *directory*,
 * `SKILL.md` as its short entry point plus whatever deeper files it
 * chooses to carry — the shape got corrected mid-session after shipping
 * as one flat file per skill the first time, which wasn't a real skill,
 * just a longer tool description. `loadSkills` is exercised against a
 * real filesystem, real malformed directories included, the same standard
 * `plugins.test.ts` already holds for `037`. The live-turn test at the
 * bottom goes further: a real HTTP server, real tool execution, and two
 * separate `use_skill` calls in the same turn — the first for the catalog
 * entry, the second for a specific deeper file — proving progressive
 * disclosure actually works round-trip, not just that the loader produces
 * the right in-memory shape.
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

/** Writes one skill directory: SKILL.md plus any other files given by
 * relative path, matching how a real skill carries references/recipes/
 * templates/scripts underneath its entry point. */
async function writeSkillDir(
  root: string,
  skillName: string,
  skillMd: string,
  extraFiles: Record<string, string> = {},
): Promise<string> {
  const dir = path.join(root, skillName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), skillMd, "utf8");
  for (const [relative, content] of Object.entries(extraFiles)) {
    const file = path.join(dir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, "utf8");
  }
  return dir;
}

const VALID = `---
name: word-golf
description: Say hello in as few words as possible.
---

Just say "hi". Nothing else.
`;

test("no directories at all means nothing loaded, and nothing to crash on", async () => {
  const { logger } = capturingLogger();
  const result = await loadSkills(undefined, undefined, undefined, logger);
  assert.deepEqual(result, { skills: [], skipped: [] });
});

test("a missing built-in directory warns and returns empty, without crashing boot", async () => {
  const { logger, warnings } = capturingLogger();
  const result = await loadSkills(path.join(tmp, "does-not-exist"), undefined, undefined, logger);
  assert.deepEqual(result.skills, []);
  assert.equal(warnings.length, 1);
});

test("a real, valid skill directory loads with its name, description, and body intact", async () => {
  const root = path.join(tmp, "valid");
  await writeSkillDir(root, "word-golf", VALID);

  const { logger, infos } = capturingLogger();
  const result = await loadSkills(root, undefined, undefined, logger);

  assert.equal(result.skills.length, 1);
  const skill = result.skills[0]!;
  assert.equal(skill.name, "word-golf");
  assert.equal(skill.description, "Say hello in as few words as possible.");
  assert.equal(skill.body, 'Just say "hi". Nothing else.');
  assert.equal(skill.source, "built-in");
  assert.ok(infos.some((m) => m.includes("word-golf")));
});

test("a directory with no SKILL.md is skipped with a clear reason, not silently dropped", async () => {
  const root = path.join(tmp, "no-skill-md");
  await fs.mkdir(path.join(root, "empty-attempt"), { recursive: true });
  await fs.writeFile(path.join(root, "empty-attempt", "readme.md"), "not the right filename\n");

  const { logger, warnings } = capturingLogger();
  const result = await loadSkills(root, undefined, undefined, logger);

  assert.equal(result.skills.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason ?? "", /has no SKILL\.md/);
  assert.ok(warnings.some((m) => m.includes("empty-attempt")));
});

test("missing frontmatter is skipped with a clear reason", async () => {
  const root = path.join(tmp, "no-frontmatter");
  await writeSkillDir(root, "broken", "Just some instructions, no --- block at all.\n");

  const { logger, warnings } = capturingLogger();
  const result = await loadSkills(root, undefined, undefined, logger);

  assert.equal(result.skills.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason ?? "", /frontmatter/);
  assert.ok(warnings.some((m) => m.includes("broken")));
});

test("a name that isn't lowercase-and-hyphens is rejected, not silently accepted", async () => {
  const root = path.join(tmp, "bad-name");
  await writeSkillDir(root, "shouty", "---\nname: Stripe_Checkout\ndescription: d\n---\n\nbody\n");

  const result = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });
  assert.equal(result.skills.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /lowercase/);
});

test("a missing description is rejected — it's the only thing always in context", async () => {
  const root = path.join(tmp, "no-description");
  await writeSkillDir(root, "thin", "---\nname: thin\n---\n\nsome body\n");

  const result = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });
  assert.equal(result.skills.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /description/);
});

test("frontmatter with nothing after it is rejected — a skill with no instructions teaches nothing", async () => {
  const root = path.join(tmp, "empty-body");
  await writeSkillDir(root, "hollow", "---\nname: hollow\ndescription: d\n---\n\n   \n");

  const result = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });
  assert.equal(result.skills.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /no instructions/);
});

test("one bad skill directory does not stop the rest from loading", async () => {
  const root = path.join(tmp, "mixed");
  await writeSkillDir(root, "broken", "no frontmatter here\n");
  await writeSkillDir(root, "zzz-good", "---\nname: zzz-good\ndescription: d\n---\n\nbody\n");

  const result = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });
  assert.deepEqual(
    result.skills.map((s) => s.name),
    ["zzz-good"],
  );
  assert.equal(result.skipped.length, 1);
});

test("an operator skill with the same name as a built-in replaces it, source and all", async () => {
  const builtInRoot = path.join(tmp, "builtin-override");
  const operatorRoot = path.join(tmp, "operator-override");
  await writeSkillDir(
    builtInRoot,
    "greet",
    "---\nname: greet\ndescription: the box's version\n---\n\nbox body\n",
  );
  await writeSkillDir(
    operatorRoot,
    "greet",
    "---\nname: greet\ndescription: our house version\n---\n\nhouse body\n",
  );

  const { logger, infos } = capturingLogger();
  const result = await loadSkills(builtInRoot, undefined, operatorRoot, logger);

  assert.equal(result.skills.length, 1, "one skill, not two — the operator's wins outright");
  assert.equal(result.skills[0]?.description, "our house version");
  assert.equal(result.skills[0]?.source, "operator");
  assert.ok(infos.some((m) => m.includes("replacing")));
});

test("all three sources can carry the same name at once — uploaded beats built-in, operator beats both", async () => {
  const builtInRoot = path.join(tmp, "three-way-builtin");
  const uploadedRoot = path.join(tmp, "three-way-uploaded");
  const operatorRoot = path.join(tmp, "three-way-operator");
  await writeSkillDir(
    builtInRoot,
    "greet",
    "---\nname: greet\ndescription: the box's\n---\n\nbody\n",
  );
  await writeSkillDir(
    uploadedRoot,
    "greet",
    "---\nname: greet\ndescription: uploaded through Settings\n---\n\nbody\n",
  );
  await writeSkillDir(
    operatorRoot,
    "greet",
    "---\nname: greet\ndescription: the operator's own\n---\n\nbody\n",
  );

  const noop = { warn: () => undefined, info: () => undefined };

  const uploadedOnly = await loadSkills(builtInRoot, uploadedRoot, undefined, noop);
  assert.equal(uploadedOnly.skills[0]?.description, "uploaded through Settings");
  assert.equal(uploadedOnly.skills[0]?.source, "uploaded");

  const allThree = await loadSkills(builtInRoot, uploadedRoot, operatorRoot, noop);
  assert.equal(allThree.skills.length, 1, "still one skill, the most specific source wins");
  assert.equal(allThree.skills[0]?.description, "the operator's own");
  assert.equal(allThree.skills[0]?.source, "operator");
});

test("the repo's own skills/ directory actually loads — guards against future drift breaking the format", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const result = await loadSkills(path.join(repoRoot, "skills"), undefined, undefined, {
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

// ---------------------------------------------------------------------------
// use_skill — the catalog call and the follow-up path call
// ---------------------------------------------------------------------------

test("use_skill with just a name returns the entry point plus a list of what else is there", async () => {
  const root = path.join(tmp, "with-resources");
  await writeSkillDir(
    root,
    "deep-skill",
    "---\nname: deep-skill\ndescription: d\n---\n\ntop-level instructions\n",
    {
      "references/detail.md": "the deeper reference content",
      "recipes/example.md": "a worked example",
    },
  );
  const { skills } = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });

  const tool = buildUseSkillTool(skills);
  const result = await tool.run(fakeContext(), { name: "deep-skill" });

  assert.match(result.output, /top-level instructions/);
  assert.match(result.output, /references\/detail\.md/);
  assert.match(result.output, /recipes\/example\.md/);
  // The catalog call must not dump the deeper files' actual content —
  // that's the entire point of asking for them by path separately.
  assert.doesNotMatch(result.output, /the deeper reference content/);
});

test("use_skill with a path returns that specific file's real content", async () => {
  const root = path.join(tmp, "with-resources-2");
  await writeSkillDir(
    root,
    "deep-skill-2",
    "---\nname: deep-skill-2\ndescription: d\n---\n\ntop\n",
    { "references/detail.md": "THE ACTUAL DEEPER CONTENT" },
  );
  const { skills } = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });

  const tool = buildUseSkillTool(skills);
  const result = await tool.run(fakeContext(), {
    name: "deep-skill-2",
    path: "references/detail.md",
  });

  assert.equal(result.output, "THE ACTUAL DEEPER CONTENT");
  assert.notEqual(result.isError, true);
});

test("use_skill refuses a path that tries to escape the skill's own directory", async () => {
  const root = path.join(tmp, "traversal");
  await writeSkillDir(root, "guarded", "---\nname: guarded\ndescription: d\n---\n\nbody\n");
  await fs.writeFile(path.join(tmp, "secret.txt"), "should never be readable this way", "utf8");

  const { skills } = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });
  const tool = buildUseSkillTool(skills);
  const result = await tool.run(fakeContext(), { name: "guarded", path: "../secret.txt" });

  assert.equal(result.isError, true);
  assert.match(result.output, /outside/);
});

test("use_skill with an unknown path names the error clearly rather than throwing", async () => {
  const root = path.join(tmp, "missing-path");
  await writeSkillDir(root, "thin-skill", "---\nname: thin-skill\ndescription: d\n---\n\nbody\n");
  const { skills } = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });

  const tool = buildUseSkillTool(skills);
  const result = await tool.run(fakeContext(), {
    name: "thin-skill",
    path: "references/does-not-exist.md",
  });

  assert.equal(result.isError, true);
  assert.match(result.output, /Could not read/);
});

test("use_skill: an unknown skill name lists what is actually available", async () => {
  const root = path.join(tmp, "known-only");
  await writeSkillDir(root, "real-one", "---\nname: real-one\ndescription: d\n---\n\nbody\n");
  const { skills } = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });

  const tool = buildUseSkillTool(skills);
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
// A real live turn: the catalog reaches the prompt, and two separate
// use_skill calls — one for the entry point, one for a deeper file — both
// run through the same executeTool/ALL_TOOLS path a real session uses.
// ---------------------------------------------------------------------------

test("a live turn: the model reads a skill's entry point, then follows up for a deeper file, both for real", async () => {
  const root = path.join(tmp, "live-turn-skill");
  await writeSkillDir(
    root,
    "test-skill",
    "---\nname: test-skill\ndescription: A skill only this test knows about\n---\n\nTOP LEVEL BODY\n",
    { "references/detail.md": "THE DEEPER REFERENCE CONTENT" },
  );
  const { skills } = await loadSkills(root, undefined, undefined, {
    warn: () => undefined,
    info: () => undefined,
  });
  const tool = buildUseSkillTool(skills);
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
          events: [],
          result: {
            toolCalls: [
              {
                id: "call_2",
                name: "use_skill",
                input: { name: "test-skill", path: "references/detail.md" },
              },
            ],
            stopReason: "tool_use",
            usage: { inputTokens: 3, outputTokens: 1 },
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
    skills: [{ name: "test-skill", description: "A skill only this test knows about" }],
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
      .map(
        (line) =>
          JSON.parse(line.slice(6)) as { type: string; call?: { name: string; result?: string } },
      );

    const toolEnds = events.filter((event) => event.type === "tool.end");
    assert.equal(toolEnds.length, 2, "both use_skill calls must have actually run");

    const entryPoint = toolEnds[0]!;
    assert.match(entryPoint.call?.result ?? "", /TOP LEVEL BODY/);
    assert.match(entryPoint.call?.result ?? "", /references\/detail\.md/);
    assert.doesNotMatch(
      entryPoint.call?.result ?? "",
      /THE DEEPER REFERENCE CONTENT/,
      "the entry-point call must not have leaked the deeper file's content early",
    );

    const followUp = toolEnds[1]!;
    assert.equal(
      followUp.call?.result,
      "THE DEEPER REFERENCE CONTENT",
      "the second call must return the real file the first call only listed",
    );
  } finally {
    await server.close();
    // Never leak a test-only tool into whatever other file's process reuses
    // this same shared ALL_TOOLS array.
    const index = ALL_TOOLS.indexOf(tool);
    if (index !== -1) ALL_TOOLS.splice(index, 1);
  }
});
