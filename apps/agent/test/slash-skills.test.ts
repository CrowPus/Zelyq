import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { AgentConfig } from "../src/config.js";
import type {
  Conversation,
  ModelProvider,
  ProviderEvent,
  TurnResult,
} from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";

/**
 * `/`-selected skills — see `044` in the council notes. Unlike `042`'s
 * catalog (the model's own choice whether to call `use_skill`), a name
 * explicitly picked from the composer is a guarantee: its body must
 * already be in the message the model sees on turn one, with no tool
 * call required. This is exercised against a real HTTP server and a real
 * `AgentSession`, capturing exactly what the conversation's own
 * `addUserMessage` receives — the actual boundary the guarantee has to
 * hold at.
 */

let capturedUserMessage = "";

function scriptedProvider(): ModelProvider {
  const conversation: Conversation = {
    addUserMessage: (text) => {
      capturedUserMessage = text;
    },
    addToolResults: () => undefined,
    async *stream() {
      const result: TurnResult = {
        toolCalls: [],
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
      yield { type: "text", text: "done" } satisfies ProviderEvent;
      return result;
    },
  };
  return { id: "anthropic", model: "scripted", createConversation: () => conversation };
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
  maxTurnIterations: 5,
  runtime: {
    kind: "local",
    workspaceDir: path.join(os.tmpdir(), `zelyq-slash-skills-${Date.now()}`),
    execTimeoutMs: 10_000,
    previewPortRange: [4996, 4999],
    previewHost: "127.0.0.1",
  },
};

const server = buildAgentServer(config, {
  providerFactory: scriptedProvider,
  skills: [
    { name: "shadcn-ui-setup", description: "Install shadcn/ui.", body: "THE FULL SKILL.MD BODY" },
    { name: "stripe-checkout", description: "Wire Stripe.", body: "STRIPE BODY" },
  ],
});

let base: string;

before(async () => {
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await server.close();
});

async function sendPrompt(sessionId: string, message: string, skills?: string[]) {
  await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: { sessionId, projectId: `prj_${sessionId}` },
  });

  const response = await fetch(`${base}/sessions/${sessionId}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, ...(skills ? { skills } : {}) }),
  });
  await response.text();
}

test("a skill explicitly selected via / is woven into the model's message on turn one — no tool call needed", async () => {
  capturedUserMessage = "";
  await sendPrompt("ses_slash_1", "design my website", ["shadcn-ui-setup"]);

  assert.match(capturedUserMessage, /THE FULL SKILL\.MD BODY/);
  assert.match(capturedUserMessage, /shadcn-ui-setup/);
  assert.ok(
    capturedUserMessage.endsWith("design my website"),
    "the user's actual request must still be there, and last",
  );
});

test("no skills selected leaves the message exactly as typed", async () => {
  capturedUserMessage = "";
  await sendPrompt("ses_slash_2", "just a normal message");
  assert.equal(capturedUserMessage, "just a normal message");
});

test("multiple selected skills all end up in the message the model actually sees", async () => {
  capturedUserMessage = "";
  await sendPrompt("ses_slash_3", "do both things", ["shadcn-ui-setup", "stripe-checkout"]);

  assert.match(capturedUserMessage, /THE FULL SKILL\.MD BODY/);
  assert.match(capturedUserMessage, /STRIPE BODY/);
});

test("a skill name the picker sent that no longer exists is skipped, not a failed turn", async () => {
  capturedUserMessage = "";
  await sendPrompt("ses_slash_4", "still works", ["a-skill-that-was-deleted"]);
  assert.equal(capturedUserMessage, "still works");
});
