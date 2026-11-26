import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import type { Conversation, ConversationOptions, ModelProvider } from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/** Records what the session hands the model: its prompt and tools. */
function recordingProvider(seen: ConversationOptions[]): ModelProvider {
  return {
    id: "anthropic",
    model: "scripted",
    createConversation(options: ConversationOptions) {
      seen.push(options);
      const conversation: Conversation = {
        addUserMessage: () => undefined,
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
  };
}

async function setup() {
  const seen: ConversationOptions[] = [];
  const workspaceDir = path.join(
    os.tmpdir(),
    `zelyq-platform-session-${Date.now()}-${Math.random()}`,
  );
  await fs.mkdir(path.join(workspaceDir, "prj_x", "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceDir, "prj_x", "src", "App.tsx"),
    "export default () => null;\n",
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
    maxTurnIterations: 2,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4984, 4988],
      previewHost: "127.0.0.1",
    },
  };
  const provider = recordingProvider(seen);
  const server = buildAgentServer(config, {
    providerFactory: () => provider,
  });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return { base, seen, close: () => server.app.close() };
}

async function createSession(base: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "s1", projectId: "prj_x", ...body }),
  });
  assert.equal(res.status, 201, await res.text());
}

async function runOne(base: string) {
  const res = await fetch(`${base}/sessions/s1/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  await res.text();
}

const PLATFORM = [
  "zelyq_platform",
  "save_pipeline",
  "run_pipeline",
  "pipeline_run",
  "deployed_app",
];

test("a session that can reach Zelyq gets the pipeline tools and the <shipping> block", async () => {
  const { base, seen, close } = await setup();
  try {
    await createSession(base, { previewBridge: { url: "http://127.0.0.1:1", token: "grant" } });
    await runOne(base);
    const options = seen.at(-1);
    assert.ok(options);
    const names = options.tools.map((tool) => tool.name);
    for (const name of PLATFORM) assert.ok(names.includes(name), `${name} offered`);
    assert.match(options.systemPrompt, /<shipping>/);
    assert.match(options.systemPrompt, /Call zelyq_platform first/);
  } finally {
    await close();
  }
});

test("without the grant, neither the tools nor the block are there", async () => {
  const { base, seen, close } = await setup();
  try {
    await createSession(base, {});
    await runOne(base);
    const options = seen.at(-1);
    assert.ok(options);
    const names = options.tools.map((tool) => tool.name);
    for (const name of PLATFORM) assert.ok(!names.includes(name), `${name} hidden`);
    assert.doesNotMatch(options.systemPrompt, /<shipping>/);
  } finally {
    await close();
  }
});
