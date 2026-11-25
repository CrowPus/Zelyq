import { resolveFromRepoRoot } from "@zelyq/core/node";
import { ALL_TOOLS } from "@zelyq/tools";
import { aiProviderCatalogText, buildUseAiProviderTool, loadAiProviders } from "./ai-providers.js";
import { buildUseDesignRefTool, designRefCatalogText, loadDesignRefs } from "./design-refs.js";
import { loadPlugins } from "./plugins.js";
import { buildUseSkillTool, listResources, loadSkills } from "./skills.js";

/**
 * Everything the agent loads at boot besides its config: plugin tools, skills,
 * the design reference library and the AI provider library. One function so
 * the agent server and the eval harness load exactly the same things — a score
 * measured on a different agent from the one users get measures nothing.
 *
 * Appends to `ALL_TOOLS`, the array every session's tool list defaults to, so
 * call it once per process, before any session is created.
 */
export async function loadAgentAssets(env: NodeJS.ProcessEnv = process.env) {
  const plugins = await loadPlugins(env.ZELYQ_PLUGIN_DIR, ALL_TOOLS);

  const uploadedSkillsDir = resolveFromRepoRoot(env.ZELYQ_SKILLS_UPLOAD_DIR ?? "data/skills");
  const skillsResult = await loadSkills(
    resolveFromRepoRoot("skills"),
    uploadedSkillsDir,
    env.ZELYQ_SKILLS_DIR,
  );
  if (skillsResult.skills.length > 0) ALL_TOOLS.push(buildUseSkillTool(skillsResult.skills));

  // `dir` stays internal to skills.ts (never shown to the model); this is the
  // one place that lists a skill's deeper files for prompts that bake a skill
  // in rather than reaching it through `use_skill`.
  const skills = await Promise.all(
    skillsResult.skills.map(async (skill) => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      resources: await listResources(skill.dir),
    })),
  );

  const designRefs = await loadDesignRefs(
    resolveFromRepoRoot("design-md"),
    env.ZELYQ_DESIGN_REFS_DIR,
  );
  if (designRefs.refs.length > 0) ALL_TOOLS.push(buildUseDesignRefTool(designRefs.refs));

  const aiProviders = await loadAiProviders(
    resolveFromRepoRoot("ai-providers"),
    env.ZELYQ_AI_PROVIDERS_DIR,
  );
  if (aiProviders.providers.length > 0)
    ALL_TOOLS.push(buildUseAiProviderTool(aiProviders.providers));

  return {
    pluginNames: plugins.loaded,
    skills,
    designRefCatalog: designRefs.refs.map((r) => ({ slug: r.slug, description: r.description })),
    designRefCatalogText: designRefCatalogText(designRefs.refs),
    agentMd: designRefs.agentMd,
    aiProviderCatalog: aiProviders.providers.map((p) => ({
      slug: p.slug,
      description: p.description,
    })),
    aiProviderCatalogText: aiProviderCatalogText(aiProviders.providers),
    aiProvidersAgentMd: aiProviders.agentMd,
  };
}

export type AgentAssets = Awaited<ReturnType<typeof loadAgentAssets>>;

/**
 * The part of a session's options that comes from the loaded assets. Used by
 * the server's `POST /sessions` and by the eval harness, so both build the
 * same prompt from the same inputs.
 */
export function assetSessionOptions(assets: {
  skills?: Array<{ name: string; description: string; body: string; resources?: string[] }>;
  designRefCatalogText?: string;
  agentMd?: string | null;
  aiProviderCatalogText?: string;
  aiProvidersAgentMd?: string | null;
}) {
  const byName = new Map((assets.skills ?? []).map((skill) => [skill.name, skill]));
  return {
    skills: assets.skills,
    resolveSkillBody: (name: string): { body: string } | undefined => byName.get(name),
    ...(assets.designRefCatalogText ? { designRefCatalogText: assets.designRefCatalogText } : {}),
    ...(assets.agentMd ? { agentMd: assets.agentMd } : {}),
    ...(assets.aiProviderCatalogText
      ? { aiProviderCatalogText: assets.aiProviderCatalogText }
      : {}),
    ...(assets.aiProvidersAgentMd ? { aiProvidersAgentMd: assets.aiProvidersAgentMd } : {}),
  };
}
