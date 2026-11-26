import { createHash } from "node:crypto";
import { loadEnvFile } from "@zelyq/core/node";
import { runMigrations } from "@zelyq/db";
import { ALL_TOOLS, configureBrowserSandbox } from "@zelyq/tools";
import { loadAgentAssets } from "./assets.js";
import { loadAgentConfig } from "./config.js";
import { loadMcpServers } from "./mcp.js";
import { PROVIDERS } from "./providers/index.js";
import { buildAgentServer } from "./server.js";

// Before anything reads process.env.
const envFile = loadEnvFile();

// The agent reads DB-backed settings while loading its config, and under
// `pnpm dev` it starts alongside the server rather than after it — so it
// migrates too. Drizzle records what it applied; running this from both
// processes is safe and idempotent.
await runMigrations(process.env.DATABASE_URL ?? "file:./data/zelyq.db");

const config = await loadAgentConfig();
// On a strict server every browser the agent opens runs in a gVisor container
// that reaches nothing; see packages/tools/src/browser-sandbox.ts.
if (config.runtime.container?.sandbox) {
  configureBrowserSandbox(
    config.runtime.container.sandbox,
    config.runtime.container.engine,
    // Two Zelyqs on one machine must not remove each other's browsers.
    createHash("sha256").update(config.runtime.workspaceDir).digest("hex").slice(0, 12),
  );
}
// Plugins, skills, design references and the AI provider library, appended to
// `ALL_TOOLS` before `buildAgentServer` so `/health` can report them. The eval
// harness calls the same function, so it measures this exact agent.
const assets = await loadAgentAssets();

// MCP tools join the same array. A server that is down or misconfigured costs
// its tools, never the agent's boot.
const mcp = await loadMcpServers(process.env.ZELYQ_MCP_CONFIG, ALL_TOOLS);

const server = buildAgentServer(config, { ...assets, mcpToolNames: mcp.loaded });
if (assets.pluginNames.length > 0) {
  server.app.log.info(
    `${assets.pluginNames.length} plugin tool(s) loaded: ${assets.pluginNames.join(", ")}`,
  );
}
if (mcp.loaded.length > 0) {
  server.app.log.info(`${mcp.loaded.length} MCP tool(s) loaded: ${mcp.loaded.join(", ")}`);
}
for (const skipped of mcp.skipped) {
  server.app.log.warn(`MCP server "${skipped.server}" unavailable: ${skipped.reason}`);
}
if (assets.skills.length > 0) {
  server.app.log.info(
    `${assets.skills.length} skill(s) loaded: ${assets.skills.map((s) => s.name).join(", ")}`,
  );
}
if (assets.designRefCatalog.length > 0 || assets.agentMd) {
  server.app.log.info(
    `${assets.designRefCatalog.length} design reference(s) loaded${assets.agentMd ? " + Agent.md UI guidelines" : ""}`,
  );
}
if (assets.aiProviderCatalog.length > 0 || assets.aiProvidersAgentMd) {
  server.app.log.info(
    `${assets.aiProviderCatalog.length} AI provider(s) loaded${assets.aiProvidersAgentMd ? " + Agent.md integration rules" : ""}`,
  );
}

async function shutdown(signal: string): Promise<void> {
  server.app.log.info(`${signal} received, shutting down`);
  await server.close();
  // stdio servers are child processes; without this a restart accumulates them.
  await Promise.all(mcp.clients.map((client) => client.close().catch(() => undefined)));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await server.app.listen({ host: config.host, port: config.port });
  if (envFile) server.app.log.info(`loaded ${envFile}`);
  server.app.log.info(
    `zelyq agent ready — runtime=${config.runtime.kind} provider=${config.provider} model=${config.model} effort=${config.effort}`,
  );
  if (!config.apiKey) {
    const info = PROVIDERS[config.provider];
    server.app.log.warn(
      `${info.apiKeyEnv.join(" / ")} is not set, so ${info.label} prompts will fail. ` +
        `Put a key in .env (${info.docsUrl}) and restart.`,
    );
  }
} catch (error) {
  server.app.log.error(error);
  process.exit(1);
}
