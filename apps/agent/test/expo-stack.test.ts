import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import type { Conversation, ConversationOptions, ModelProvider } from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/**
 * 066 — a project on the Expo stack must reach the agent as Expo: the
 * <project> Stack line, and the RN skill force-woven as <stack_guide>. A
 * vite-react project (no template/stack/agentSkill on the request) must be
 * byte-identical to before. The system prompt is the only place this is
 * visible, so the provider records the ConversationOptions it was built with.
 */
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

const EXPO_SKILL_BODY = "Use View / Text / Pressable, never div / span / button.";

async function setup() {
  const seen: ConversationOptions[] = [];
  const workspaceDir = path.join(os.tmpdir(), `zelyq-expo-stack-${Date.now()}-${Math.random()}`);
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
      previewPortRange: [4971, 4979],
      previewHost: "127.0.0.1",
    },
  };
  const provider = recordingProvider(seen);
  const server = buildAgentServer(config, {
    providerFactory: () => provider,
    skills: [
      { name: "expo-react-native", description: "RN on Expo", body: EXPO_SKILL_BODY },
      { name: "senior-software-engineering", description: "eng", body: "eng body" },
    ],
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

test("066: an Expo session gets the stack line and the RN skill as <stack_guide>", async () => {
  const { base, seen, close } = await setup();
  try {
    await createSession(base, {
      template: "expo-react-native",
      stack: "React Native on Expo, previewed via Expo web (Metro).",
      agentSkill: "expo-react-native",
    });
    await runOne(base);
    const prompt = seen[0]!.systemPrompt;
    assert.match(prompt, /Template: expo-react-native/);
    assert.match(prompt, /Stack: React Native on Expo, previewed via Expo web \(Metro\)\./);
    assert.match(prompt, /<stack_guide>/);
    assert.match(prompt, /Use View \/ Text \/ Pressable, never div/);
    assert.doesNotMatch(prompt, /Stack: React 19 \+ TypeScript \+ Vite/);
  } finally {
    await close();
  }
});

test("066: a session with no template is unchanged — Vite stack line, no guide", async () => {
  const { base, seen, close } = await setup();
  try {
    await createSession(base, {});
    await runOne(base);
    const prompt = seen[0]!.systemPrompt;
    assert.match(prompt, /Template: vite-react/);
    assert.match(prompt, /Stack: React 19 \+ TypeScript \+ Vite \+ Tailwind CSS/);
    assert.doesNotMatch(prompt, /<stack_guide>/);
  } finally {
    await close();
  }
});

test("066: an unknown agentSkill name is dropped, not a failed session", async () => {
  const { base, seen, close } = await setup();
  try {
    await createSession(base, {
      template: "some-stack",
      stack: "A custom stack",
      agentSkill: "does-not-exist",
    });
    await runOne(base);
    const prompt = seen[0]!.systemPrompt;
    assert.match(prompt, /Stack: A custom stack/);
    assert.doesNotMatch(prompt, /<stack_guide>/);
  } finally {
    await close();
  }
});
