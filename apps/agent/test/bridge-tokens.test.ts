import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
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
 * One agent session serves everybody editing a project and is reused across
 * prompts, so the bridge tokens it was created with belong to whoever sent its
 * first prompt. Found in review: once someone else prompted, those tokens were
 * retired and every preview call was refused. Each prompt now carries the
 * tokens minted for its sender.
 */

type Step = { events: ProviderEvent[]; result: TurnResult };

const startPreview = (id: string): Step => ({
  events: [],
  result: {
    toolCalls: [{ id, name: "start_preview", input: {} }],
    stopReason: "tool_use",
    usage: { inputTokens: 1, outputTokens: 1 },
  },
});
const say = (text: string): Step => ({
  events: [{ type: "text", text }],
  result: { toolCalls: [], stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } },
});

function scripted(script: Step[]): ModelProvider {
  let i = 0;
  return {
    id: "anthropic",
    model: "scripted",
    createConversation(): Conversation {
      return {
        addUserMessage: () => undefined,
        addToolResults: () => undefined,
        async *stream() {
          const step = script[Math.min(i++, script.length - 1)]!;
          for (const event of step.events) yield event;
          return step.result;
        },
      };
    },
  };
}

test("each prompt's bridge tokens are the ones the tools use", async () => {
  const seen: string[] = [];
  const bridge = http.createServer((req, res) => {
    seen.push(String(req.headers["x-zelyq-preview-bridge"]));
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ preview: { status: "running", url: "http://x", lastError: null } }));
  });
  await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const bridgeAddress = bridge.address();
  const bridgeUrl = `http://127.0.0.1:${typeof bridgeAddress === "object" && bridgeAddress ? bridgeAddress.port : 0}`;

  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-bridge-tokens-"));
  await fs.mkdir(path.join(workspaceDir, "prj_team"), { recursive: true });
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
    maxTurnIterations: 5,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4971, 4975],
      previewHost: "127.0.0.1",
    },
  };
  const provider = scripted([startPreview("c1"), say("A's turn"), startPreview("c2"), say("B's")]);
  const server = buildAgentServer(config, { providerFactory: () => provider });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const post = (url: string, body: unknown) =>
    fetch(`${base}${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const created = await post("/sessions", {
      sessionId: "s_team",
      projectId: "prj_team",
      previewBridge: { url: bridgeUrl, token: "token-a" },
    });
    assert.equal(created.status, 201);
    await (await post("/sessions/s_team/prompt", { message: "from A" })).text();
    await (
      await post("/sessions/s_team/prompt", {
        message: "from B",
        bridgeTokens: { preview: "token-b", image: "no-image-bridge-here" },
      })
    ).text();
    assert.deepEqual(seen, ["token-a", "token-b"]);
  } finally {
    await server.close();
    await new Promise<void>((resolve) => bridge.close(() => resolve()));
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});
