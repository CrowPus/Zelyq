import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "@zelyq/core/node";
import { ALL_TOOLS } from "@zelyq/tools";
import { aiProviderCatalogText, buildUseAiProviderTool, loadAiProviders } from "./ai-providers.js";
import { loadAgentConfig } from "./config.js";
import { buildUseDesignRefTool, designRefCatalogText, loadDesignRefs } from "./design-refs.js";
import { loadPlugins } from "./plugins.js";
import { PROVIDERS } from "./providers/index.js";
import { buildAgentServer } from "./server.js";
import { buildUseSkillTool, listResources, loadSkills } from "./skills.js";

// Before anything reads process.env.
const envFile = loadEnvFile();

const config = await loadAgentConfig();
// Boot-time only, before the server exists to accept a prompt. `ALL_TOOLS`
// is the same array every session's tool list already defaults to, so
// appending to it here is enough; nothing downstream needs to know a tool
// came from a plugin rather than a built-in. Loaded before `buildAgentServer`
// so `/health` can report the names back without the agent's own boot log
// being the only place to see them.
const plugins = await loadPlugins(process.env.ZELYQ_PLUGIN_DIR, ALL_TOOLS);

// The repo's own `skills/` sits three levels above this file whether it is
// running from source or from `dist` — same depth `apps/server/src/
// config.ts` already resolves `templatesDir` at.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The same directory the server's upload route writes into. Resolved
// independently here the exact way ZELYQ_WORKSPACE_DIR already is on both
// sides: a shared default that only has to be a real agreement in a
// deployment where the two processes' relative paths could differ, which
// `docker-compose.yml`'s shared /data volume already accounts for.
const uploadedSkillsDir = path.resolve(process.env.ZELYQ_SKILLS_UPLOAD_DIR ?? "./data/skills");
const skillsResult = await loadSkills(
  path.join(repoRoot, "skills"),
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

// 056 — the design reference library. `design-md/` sits beside `skills/` in
// the repo; an operator can point ZELYQ_DESIGN_REFS_DIR at their own set.
const designRefs = await loadDesignRefs(
  path.join(repoRoot, "design-md"),
  process.env.ZELYQ_DESIGN_REFS_DIR,
);
if (designRefs.refs.length > 0) ALL_TOOLS.push(buildUseDesignRefTool(designRefs.refs));

// 060 — the AI provider knowledge library. `ai-providers/` sits beside
// `skills/` and `design-md/`; an operator can point ZELYQ_AI_PROVIDERS_DIR at
// their own set.
const aiProviders = await loadAiProviders(
  path.join(repoRoot, "ai-providers"),
  process.env.ZELYQ_AI_PROVIDERS_DIR,
);
if (aiProviders.providers.length > 0) {
  ALL_TOOLS.push(buildUseAiProviderTool(aiProviders.providers));
}

const server = buildAgentServer(config, {
  pluginNames: plugins.loaded,
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
