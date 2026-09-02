/**
 * Measures the per-request STATIC floor: system prompt + tool JSON, by mode.
 *
 * Run `pnpm --filter @zelyq/tools build && pnpm --filter @zelyq/agent build`
 * FIRST — this reads `dist/`, and a stale dist silently reports old numbers
 * (see 07-review-and-amendments.md, R2).
 *
 *   node docs/token-usage/measure/static-floor.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { buildSystemPrompt } = await import(`${root}/apps/agent/dist/prompt.js`);
const { designRefCatalogText } = await import(`${root}/apps/agent/dist/design-refs.js`);
const { aiProviderCatalogText } = await import(`${root}/apps/agent/dist/ai-providers.js`);
const T = await import(`${root}/packages/tools/dist/index.js`);
const { ALL_TOOLS, toolDefinitions } = T;

/** chars/4 is a PROXY, not a tokenizer. Phase 0 replaces it with provider counts. */
const tok = (s) => Math.round(s.length / 4);
const P = (label, s) =>
  console.log(`${label.padEnd(38)} chars=${String(s.length).padStart(7)}  ~tok=${String(tok(s)).padStart(6)}`);

const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const dirs = (p) =>
  fs.readdirSync(path.join(root, p), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

const agentMd = read("design-md/Agent.md");
const aiAgentMd = read("ai-providers/Agent.md");
const dCat = designRefCatalogText(dirs("design-md").map((slug) => ({ slug, description: `The ${slug} design system reference.` })));
const aCat = aiProviderCatalogText(dirs("ai-providers").map((slug) => ({ slug, description: `${slug} provider.` })));

const SUPABASE = new Set(["supabase_apply_migration", "supabase_verify_backend", "supabase_deploy_function"]);
const json = (tools) => JSON.stringify(toolDefinitions(tools));
const specialists = [T.designPassTool, T.opsPassTool, T.qaPassTool, T.cinematicPassTool];

console.log(`ALL_TOOLS: ${ALL_TOOLS.length} — ${ALL_TOOLS.map((t) => t.name).join(", ")}\n`);
console.log("--- tool catalogs ---");
P("base, no Supabase link (12)", json(ALL_TOOLS.filter((t) => !SUPABASE.has(t.name))));
P("base, Supabase linked (15)", json(ALL_TOOLS));
P("Engineer pool (15 + 4 passes)", json([...ALL_TOOLS, ...specialists]));
P("Architect pool (15 + dispatch + 4)", json([...ALL_TOOLS, T.dispatchTaskTool, ...specialists]));

console.log("\n--- system prompt, bare (no catalogs, no skill body) ---");
const bare = { projectName: "demo", template: "vite-react" };
P("base", buildSystemPrompt(bare));
P("Engineer", buildSystemPrompt({ ...bare, engineerMode: {} }));
P("Architect", buildSystemPrompt({ ...bare, architectMode: {} }));

console.log("\n--- system prompt, production shape ---");
const prod = {
  ...bare,
  agentMd,
  designRefCatalogText: dCat,
  aiProviderCatalogText: aCat,
  aiProvidersAgentMd: aiAgentMd,
  skills: [{ name: "senior-software-engineering", description: "x" }],
};
const body = (p) => ({ body: read(p), resources: ["a", "b"] });
P("base + catalogs", buildSystemPrompt(prod));
P("Engineer + catalogs + skill", buildSystemPrompt({ ...prod, engineerMode: { skill: body("skills/senior-software-engineering/SKILL.md") } }));
P("Architect + catalogs + skill", buildSystemPrompt({ ...prod, architectMode: { skill: body("skills/report-page-skill/SKILL.md") } }));
