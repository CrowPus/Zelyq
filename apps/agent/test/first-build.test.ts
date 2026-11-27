import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRuntimeDriver } from "@zelyq/runtime";
import { buildSystemPrompt, FIRST_BUILD_BLOCK } from "../src/prompt.js";
import type { Conversation, ModelProvider } from "../src/providers/index.js";
import { AgentSession } from "../src/session.js";
import { isStarterProject } from "../src/starter.js";

/**
 * The first build of a new app is finished like a product; every later
 * request stays an edit. The guidance rides the turn's message, so it stops
 * the moment the starter screen is gone, even in the same chat.
 */

const STARTER_APP = `export default function App() {\n  return <h1>Your app starts here.</h1>;\n}\n`;

async function setup() {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-first-build-"));
  await fs.mkdir(path.join(workspaceDir, "prj_x", "src"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "prj_x", "src", "App.tsx"), STARTER_APP);
  const runtime = createRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 10_000,
    previewPortRange: [4996, 4999],
    previewHost: "127.0.0.1",
  });
  const messages: string[] = [];
  const systemPrompts: string[] = [];
  const provider: ModelProvider = {
    id: "anthropic",
    model: "scripted",
    createConversation(options) {
      systemPrompts.push(options.systemPrompt);
      const conversation: Conversation = {
        addUserMessage: (text) => messages.push(text),
        addToolResults: () => undefined,
        async *stream() {
          yield { type: "text" as const, text: "ok" };
          return {
            toolCalls: [],
            stopReason: "end_turn" as const,
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        },
      };
      return conversation;
    },
  } as ModelProvider;
  const session = new AgentSession({
    sessionId: "s1",
    projectId: "prj_x",
    projectName: "Converter",
    template: "vite-react",
    provider: "anthropic",
    model: "scripted",
    effort: "high",
    apiKey: "k",
    runtime,
    maxIterations: 2,
    providerFactory: () => provider,
  });
  return { workspaceDir, runtime, session, messages, systemPrompts };
}

test("a starter project's turn carries <first_build>; after the build, the next one does not", async () => {
  const { workspaceDir, runtime, session, messages, systemPrompts } = await setup();
  try {
    assert.equal(await isStarterProject(runtime, "prj_x"), true);
    await session.run("Build a kilometres to miles converter", () => undefined);
    assert.ok(messages[0]?.startsWith(FIRST_BUILD_BLOCK), "first build guided");
    assert.match(messages[0] ?? "", /Build a kilometres to miles converter$/);

    await fs.writeFile(
      path.join(workspaceDir, "prj_x", "src", "App.tsx"),
      "export default function App() { return <Converter />; }\n",
    );
    assert.equal(await isStarterProject(runtime, "prj_x"), false);
    await session.run("Make the result bigger", () => undefined);
    assert.equal(messages.at(-1), "Make the result bigger", "an edit stays an edit");

    // The system prompt never carries it: it lives as long as the chat.
    assert.ok(systemPrompts.every((prompt) => !prompt.includes("<first_build>")));
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test("<first_build> states principles, never a benchmark task's own example", async () => {
  assert.match(FIRST_BUILD_BLOCK, /Build exactly the\s+features it asks for/);
  assert.match(FIRST_BUILD_BLOCK, /Decide the design from what this app is for/);
  assert.match(FIRST_BUILD_BLOCK, /Never\s+invent facts/);
  assert.match(FIRST_BUILD_BLOCK, /appears exactly as written/);
  assert.match(FIRST_BUILD_BLOCK, /one short test file/);
  assert.match(FIRST_BUILD_BLOCK, /Lists and collections start empty/);
  assert.match(FIRST_BUILD_BLOCK, /components the\s+project already has/);
  assert.doesNotMatch(
    buildSystemPrompt({ projectName: "p", template: "vite-react" }),
    /first_build/,
  );
  // Guidance tuned to the tasks it is measured on teaches the agent to copy
  // them: one example (a ruler under a distance) came back in every converter.
  const { BENCH_CASES } = await import("../evals/bench.js");
  const guidance = FIRST_BUILD_BLOCK.toLowerCase();
  assert.ok(!/\$\d/.test(guidance), "no amount from a task");
  for (const word of [
    "kilomet",
    "mile",
    "ruler",
    "distance",
    "pricing",
    "yearly",
    "contact",
    "todo",
    "cart",
    "shop",
    "settings",
    "tab",
  ]) {
    assert.ok(!new RegExp(`\\b${word}`).test(guidance), `"${word}" comes from a benchmark task`);
  }
  for (const task of BENCH_CASES) {
    for (const quoted of task.prompt.match(/"[^"]{3,}"/g) ?? []) {
      assert.ok(!guidance.includes(quoted.toLowerCase()), `${quoted} is quoted from ${task.id}`);
    }
  }
});
