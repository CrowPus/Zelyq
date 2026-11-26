import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createRuntimeDriver } from "@zelyq/runtime";
import { assetSessionOptions, loadAgentAssets } from "../src/assets.js";
import type { AgentConfig } from "../src/config.js";
import type { ProviderFactory } from "../src/providers/index.js";
import { buildAgentServer } from "../src/server.js";
import { AgentSession } from "../src/session.js";

/**
 * The eval harness must measure the agent users get. Before 2026-11 it built
 * its sessions with no skills, design references, UI guidelines or AI
 * provider library, so every recorded score was for a different prompt.
 *
 * Both paths below hand their system prompt and tool list to a stub provider;
 * the two must be identical.
 */

const workspaceDir = path.join(os.tmpdir(), `zelyq-eval-parity-${Date.now()}`);
const assets = await loadAgentAssets({ ...process.env, ZELYQ_PLUGIN_DIR: "" });

type Seen = { systemPrompt: string; tools: Array<{ name: string }> };
function capturing(seen: Seen[]): ProviderFactory {
  return () =>
    ({
      createConversation: (options: Seen) => {
        seen.push(options);
        return {};
      },
    }) as never;
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
  apiKey: "k",
  maxTurnIterations: 5,
  runtime: {
    kind: "local",
    workspaceDir,
    execTimeoutMs: 10_000,
    previewPortRange: [4960, 4969],
    previewHost: "127.0.0.1",
  },
};

const fromServer: Seen[] = [];
const server = buildAgentServer(config, { ...assets, providerFactory: capturing(fromServer) });
after(() => server.close());

test("the eval harness builds the same prompt and tools as the agent server", async () => {
  assert.ok(assets.skills.length > 0, "skills load from the repo");
  assert.ok(assets.designRefCatalogText, "design references load from the repo");

  const created = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: { sessionId: "s_parity", projectId: "prj_parity", template: "vite-react" },
  });
  assert.equal(created.statusCode, 201, created.body);

  // What the harness does (harness.ts), with the same project name the
  // server uses (it passes the project id).
  const fromHarness: Seen[] = [];
  const session = new AgentSession({
    sessionId: "s_harness",
    projectId: "prj_parity",
    projectName: "prj_parity",
    template: "vite-react",
    provider: "anthropic",
    model: "scripted",
    effort: "high",
    apiKey: "k",
    runtime: createRuntimeDriver(config.runtime),
    maxIterations: 5,
    providerFactory: capturing(fromHarness),
    ...assetSessionOptions(assets),
  });

  const [serverSide] = fromServer;
  const [harnessSide] = fromHarness;
  assert.ok(serverSide && harnessSide);
  assert.equal(harnessSide.systemPrompt, serverSide.systemPrompt);
  assert.deepEqual(
    harnessSide.tools.map((t) => t.name),
    serverSide.tools.map((t) => t.name),
  );
  assert.equal(session.systemPrompt, harnessSide.systemPrompt);
  assert.ok(session.toolNames.includes("use_skill"), "the shipped agent offers use_skill");
  assert.match(session.systemPrompt, /<skills>|use_skill/, "the skill catalogue is in the prompt");
});

test("the model sees the app's own name, not only its id", async () => {
  const before = fromServer.length;
  const created = await server.app.inject({
    method: "POST",
    url: "/sessions",
    payload: { sessionId: "s_named", projectId: "prj_named", projectName: "Corner Bakery" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const prompt = fromServer[before]?.systemPrompt ?? "";
  assert.match(prompt, /Corner Bakery/);
});
