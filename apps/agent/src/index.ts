import { loadEnvFile, resolveFromRepoRoot } from "@zelyq/core/node";
import { runMigrations } from "@zelyq/db";
import { ALL_TOOLS } from "@zelyq/tools";
import { aiProviderCatalogText, buildUseAiProviderTool, loadAiProviders } from "./ai-providers.js";
import { loadAgentConfig } from "./config.js";
import { buildUseDesignRefTool, designRefCatalogText, loadDesignRefs } from "./design-refs.js";
import { loadMcpServers } from "./mcp.js";
import { loadPlugins } from "./plugins.js";
import { PROVIDERS } from "./providers/index.js";
import { buildAgentServer } from "./server.js";
import { buildUseSkillTool, listResources, loadSkills } from "./skills.js";

// Before anything reads process.env.
const envFile = loadEnvFile();

// The agent reads DB-backed settings while loading its config, and under
// `pnpm dev` it starts alongside the server rather than after it — so it
// migrates too. Drizzle records what it applied; running this from both
// processes is safe and idempotent.
await runMigrations(process.env.DATABASE_URL ?? "file:./data/zelyq.db");

const config = await loadAgentConfig();
// Boot-time only, before the server exists to accept a prompt. `ALL_TOOLS`
// is the same array every session's tool list already defaults to, so
// appending to it here is enough; nothing downstream needs to know a tool
// came from a plugin rather than a built-in. Loaded before `buildAgentServer`
// so `/health` can report the names back without the agent's own boot log
// being the only place to see them.
const plugins = await loadPlugins(process.env.ZELYQ_PLUGIN_DIR, ALL_TOOLS);

// Same idea, same array. A server that is down or misconfigured costs its
// tools, never the agent's boot.
const mcp = await loadMcpServers(process.env.ZELYQ_MCP_CONFIG, ALL_TOOLS);

// The same directory the server's upload route writes into. Both are
// repo-root-anchored (`resolveFromRepoRoot`) so the two processes agree even
// under `pnpm --filter <app> dev`, where each runs from its own package dir.
const uploadedSkillsDir = resolveFromRepoRoot(process.env.ZELYQ_SKILLS_UPLOAD_DIR ?? "data/skills");
const skillsResult = await loadSkills(
  resolveFromRepoRoot("skills"),
  uploadedSkillsDir,
  process.env.ZELYQ_SKILLS_DIR,
);
if (skillsResult.skills.length > 0) ALL_TOOLS.push(buildUseSkillTool(skillsResult.skills));

// Resolved once at boot, here, rather than inside `server.ts` on every
// Engineer Mode session creation — `dir` is deliberately internal to
// `skills.ts` (never shown to the model), so this is the one place with
// legitimate access to it, same as `buildUseSkillTool` above. Baking a
// skill straight into the system prompt bypasses the live `use_skill` call
// that would normally list its deeper files, so the addendum needs this
// listing supplied another way.
const skillsWithResources = await Promise.all(
  skillsResult.skills.map(async (skill) => ({
    name: skill.name,
    description: skill.description,
    body: skill.body,
    resources: await listResources(skill.dir),
  })),
);

// The design reference library. `design-md/` sits beside `skills/` in
// the repo; an operator can point ZELYQ_DESIGN_REFS_DIR at their own set.
const designRefs = await loadDesignRefs(
  resolveFromRepoRoot("design-md"),
  process.env.ZELYQ_DESIGN_REFS_DIR,
);
if (designRefs.refs.length > 0) ALL_TOOLS.push(buildUseDesignRefTool(designRefs.refs));

// The AI provider knowledge library. `ai-providers/` sits beside
// `skills/` and `design-md/`; an operator can point ZELYQ_AI_PROVIDERS_DIR at
// their own set.
const aiProviders = await loadAiProviders(
  resolveFromRepoRoot("ai-providers"),
  process.env.ZELYQ_AI_PROVIDERS_DIR,
);
if (aiProviders.providers.length > 0) {
  ALL_TOOLS.push(buildUseAiProviderTool(aiProviders.providers));
}

const server = buildAgentServer(config, {
  pluginNames: plugins.loaded,
  mcpToolNames: mcp.loaded,
  skills: skillsWithResources,
  designRefCatalog: designRefs.refs.map((r) => ({ slug: r.slug, description: r.description })),
  designRefCatalogText: designRefCatalogText(designRefs.refs),
  agentMd: designRefs.agentMd,
  aiProviderCatalog: aiProviders.providers.map((p) => ({
    slug: p.slug,
    description: p.description,
  })),
  aiProviderCatalogText: aiProviderCatalogText(aiProviders.providers),
  aiProvidersAgentMd: aiProviders.agentMd,
});
if (plugins.loaded.length > 0) {
  server.app.log.info(
    `${plugins.loaded.length} plugin tool(s) loaded: ${plugins.loaded.join(", ")}`,
  );
}
if (mcp.loaded.length > 0) {
  server.app.log.info(`${mcp.loaded.length} MCP tool(s) loaded: ${mcp.loaded.join(", ")}`);
}
for (const skipped of mcp.skipped) {
  server.app.log.warn(`MCP server "${skipped.server}" unavailable: ${skipped.reason}`);
}
if (skillsResult.skills.length > 0) {
  server.app.log.info(
    `${skillsResult.skills.length} skill(s) loaded: ${skillsResult.skills.map((s) => s.name).join(", ")}`,
  );
}
if (designRefs.refs.length > 0 || designRefs.agentMd) {
  server.app.log.info(
    `${designRefs.refs.length} design reference(s) loaded${designRefs.agentMd ? " + Agent.md UI guidelines" : ""}`,
  );
}
if (aiProviders.providers.length > 0 || aiProviders.agentMd) {
  server.app.log.info(
    `${aiProviders.providers.length} AI provider(s) loaded${aiProviders.agentMd ? " + Agent.md integration rules" : ""}`,
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
