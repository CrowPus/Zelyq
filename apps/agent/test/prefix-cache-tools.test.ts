import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ToolDefinition } from "@zelyq/tools";
import type { AgentConfig } from "../src/config.js";
import { cachePrefixKey, worthExplicitCache } from "../src/providers/google.js";
import type {
  Conversation,
  ConversationOptions,
  ModelProvider,
  ProviderId,
} from "../src/providers/index.js";
import { pinsToolPrefixCache } from "../src/providers/index.js";
import { promptCacheKey } from "../src/providers/openai-compatible.js";
import { buildAgentServer } from "../src/server.js";

/**
 * R5 — a provider that pins a prefix cache puts the TOOL BLOCK at the front of
 * it, so adding a tool mid-session invalidates the system prompt and the whole
 * transcript with it. Those providers get the specialist pass tools up front;
 * the rest, where a late grant is free, do not.
 */

test("only providers with a pinned prefix cache ask for a stable tool block", () => {
  assert.equal(pinsToolPrefixCache("anthropic", {}), true);
  for (const p of ["openai", "xai", "deepseek", "mistral", "groq", "openrouter", "custom"]) {
    assert.equal(pinsToolPrefixCache(p as ProviderId, {}), false, p);
  }
});

test("google is out of the set by default, and joins only if explicit caching is forced on", () => {
  assert.equal(pinsToolPrefixCache("google", {}), false);
  assert.equal(pinsToolPrefixCache("google", { ZELYQ_GEMINI_EXPLICIT_CACHE: "1" }), true);
});

/** Captures what the session hands the provider, without running a turn. */
async function toolsForSession(provider: ProviderId): Promise<string[]> {
  const workspaceDir = path.join(os.tmpdir(), `zelyq-prefix-${Date.now()}-${Math.random()}`);
  const projectId = "prj_prefix";
  await fs.mkdir(path.join(workspaceDir, projectId), { recursive: true });

  let captured: ToolDefinition[] = [];
  const scripted: ModelProvider = {
    id: provider,
    model: "scripted",
    createConversation(options: ConversationOptions): Conversation {
      captured = options.tools;
      return {
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
    },
  };

  const config: AgentConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    provider,
    model: "scripted",
    effort: "high",
    apiKey: "k",
    maxTurnIterations: 2,
    runtime: {
      kind: "local",
      workspaceDir,
      execTimeoutMs: 10_000,
      previewPortRange: [4981, 4989],
      previewHost: "127.0.0.1",
    },
  };
  const server = buildAgentServer(config, { providerFactory: () => scripted });
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const addr = server.app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: `s_${provider}`, projectId, provider }),
    });
    assert.equal(res.status, 201, await res.text());
    return captured.map((t) => t.name);
  } finally {
    await server.app.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

const PASS_TOOLS = ["design_pass", "ops_pass", "qa_pass", "cinematic_pass"];

test("an Anthropic default-mode session gets the pass tools up front, so /agent never churns the prefix", async () => {
  const names = await toolsForSession("anthropic");
  for (const t of PASS_TOOLS) assert.ok(names.includes(t), `${t} missing: ${names.join(",")}`);
});

test("a provider with no pinned prefix keeps them out, and grants on demand instead", async () => {
  const names = await toolsForSession("openai");
  for (const t of PASS_TOOLS) assert.ok(!names.includes(t), `${t} should not be seeded up front`);
});

/**
 * R4 — the Gemini explicit-cache gate. Gemini is 95% of measured traffic and
 * burns ~1.25M uncached input tokens per turn re-sending a block that never
 * changes.
 */

const tool = (name: string, size: number): ToolDefinition => ({
  name,
  description: "d".repeat(size),
  input_schema: { type: "object", properties: {} },
});

test("explicit caching is OFF by default — it suppresses implicit caching, which is better", () => {
  // Measured steady state on gemini-3.7-flash over one ~70k-token conversation:
  // inline/implicit 4,768 uncached; explicit prefix cache 57,740. An explicit
  // cache reports exactly its pinned size as cached and nothing more, so the
  // remainder of every request is billed in full.
  const big = "s".repeat(40_000);
  assert.equal(worthExplicitCache(big, [tool("read_file", 500)], {}), false);
});

test("it can be forced on, for a model with no implicit caching", () => {
  const big = "s".repeat(40_000);
  assert.equal(
    worthExplicitCache(big, [tool("read_file", 500)], { ZELYQ_GEMINI_EXPLICIT_CACHE: "1" }),
    true,
  );
});

test("a prefix too small to repay cache storage is left on implicit caching", () => {
  const env = { ZELYQ_GEMINI_EXPLICIT_CACHE: "1" };
  // A short prompt with one small tool is under every documented model minimum.
  assert.equal(worthExplicitCache("hello", [tool("read_file", 50)], env), false);
  // An Engineer-sized prefix clears it comfortably.
  assert.equal(worthExplicitCache("p".repeat(43_000), [tool("read_file", 500)], env), true);
});

test("the pinned block is keyed on the tool set, so a mid-session grant cannot serve a stale prefix", () => {
  const prompt = "system";
  const before = cachePrefixKey(prompt, [tool("read_file", 10)]);
  const after = cachePrefixKey(prompt, [tool("read_file", 10), tool("design_pass", 10)]);
  assert.notEqual(before, after);
  assert.equal(before, cachePrefixKey(prompt, [tool("read_file", 10)]));
});

/**
 * The OpenAI-dialect adapter sent no cache-routing key, so a session could
 * lose its warm prefix (and on OpenRouter, wander to a different backing
 * provider) between requests.
 */

test("the routing key is stable for a session and moves when the prefix does", () => {
  const a = promptCacheKey("system prompt", ["read_file", "write_file"]);
  assert.equal(a, promptCacheKey("system prompt", ["read_file", "write_file"]));
  assert.notEqual(a, promptCacheKey("system prompt", ["read_file"]));
  assert.notEqual(a, promptCacheKey("a different prompt", ["read_file", "write_file"]));
});

test("the routing key carries no prompt text — it travels in the body and is retained", () => {
  const key = promptCacheKey("SECRET project path /home/someone/work", ["read_file"]);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.ok(!key.includes("SECRET"));
});
