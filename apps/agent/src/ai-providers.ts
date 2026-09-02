import fs from "node:fs/promises";
import path from "node:path";
import { defineTool, type ToolResult, truncate, type ZelyqTool } from "@zelyq/tools";
import { z } from "zod";

/**
 * The AI provider knowledge library.
 *
 * `ai-providers/` is a directory of directories, one per LLM provider, each
 * with a `PROVIDER.md`: the npm package, the client init, the non-streaming
 * and streaming call shapes, the key name, the docs URL, and a "verify
 * against the installed SDK" note — because a provider SDK surface goes stale
 * and the agent's built-in knowledge with it. An `ai-providers/Agent.md` at
 * the root is a MUST/SHOULD/NEVER checklist for wiring a model into a browser
 * app safely (key in Supabase, never the bundle; a "connect your provider"
 * state; handle the provider error shape).
 *
 * Loaded like `design-refs.ts` / `skills.ts`: a slug+description catalog is
 * cheap and always present in the prompt; the full body loads on demand
 * through `use_ai_provider(slug)`. Two sources, later wins on a slug
 * collision: `repoRoot/ai-providers` (built-in) and `ZELYQ_AI_PROVIDERS_DIR`
 * (operator). Read once at boot, never re-scanned while running.
 */

const PROVIDER_FILE = "PROVIDER.md";
const AGENT_FILE = "Agent.md";
/** A resolved body is capped when folded into a child's prompt, the same way
 * `051` caps an injected skill body and `056` a design reference. */
const PROVIDER_BODY_MAX = 16_000;
/** No `/`, no `..`, no leading dot — a slug only ever names one loaded dir. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export interface AiProvider {
  /** The directory name — what `use_ai_provider` is called with. */
  slug: string;
  /** A one-line summary for the catalog in the prompt. */
  description: string;
  /** The whole `PROVIDER.md` (front-matter + prose). Internal until requested. */
  body: string;
  /** Absolute. Internal only — never shown to the model. */
  dir: string;
  source: "built-in" | "operator";
}

export interface AiProvidersResult {
  providers: AiProvider[];
  /** `ai-providers/Agent.md` contents, or null if none loaded. */
  agentMd: string | null;
  skipped: Array<{ file: string; reason: string }>;
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

/** Front-matter `key: value`, `key: "value"`, and `key: |` block scalars.
 * Parallel to the helper in `design-refs.ts` — deliberately duplicated so the
 * two loaders stay independent; this needs a name and a one-line description,
 * not a YAML engine. */
function frontMatterFields(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  const lines = (match[1] ?? "").split(/\r?\n/);
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    let value = (kv[2] ?? "").trim();
    if (value === "|" || value === ">") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? "")) {
        block.push((lines[++i] ?? "").trim());
      }
      value = block.join(" ").trim();
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in fields)) fields[key] = value;
  }
  return fields;
}

/** First non-empty, non-heading, non-fence prose line — the fallback
 * description when front-matter has none. */
function firstProseLine(raw: string): string {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (
      !t ||
      t.startsWith("#") ||
      t.startsWith("```") ||
      t.startsWith("---") ||
      t.startsWith(">")
    ) {
      continue;
    }
    return t;
  }
  return "";
}

export async function loadAiProviders(
  builtInDir: string | undefined,
  operatorDir: string | undefined,
  log: Logger = console,
): Promise<AiProvidersResult> {
  const bySlug = new Map<string, AiProvider>();
  const skipped: Array<{ file: string; reason: string }> = [];
  let agentMd: string | null = null;

  const load = async (dir: string | undefined, source: AiProvider["source"]) => {
    if (!dir) return;
    let entries: string[];
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      entries = dirents
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      const agent = await fs.readFile(path.join(dir, AGENT_FILE), "utf8").catch(() => null);
      if (agent?.trim()) agentMd = agent.trim();
    } catch (error) {
      log.warn(`ai-providers directory "${dir}" could not be read: ${(error as Error).message}`);
      return;
    }

    for (const slug of entries) {
      if (!SLUG_RE.test(slug)) {
        skipped.push({ file: slug, reason: "directory name is not a valid slug" });
        continue;
      }
      const providerDir = path.join(dir, slug);
      const raw = await fs
        .readFile(path.join(providerDir, PROVIDER_FILE), "utf8")
        .catch(() => null);
      if (raw === null || !raw.trim()) {
        skipped.push({ file: slug, reason: `has no ${PROVIDER_FILE}` });
        log.warn(`ai provider "${slug}" has no ${PROVIDER_FILE} — skipped`);
        continue;
      }
      const fm = frontMatterFields(raw);
      const description =
        fm.description?.trim() ||
        firstProseLine(raw).slice(0, 280) ||
        `LLM provider integration notes: ${slug}`;
      const replacing = bySlug.has(slug);
      bySlug.set(slug, { slug, description, body: raw.trim(), dir: providerDir, source });
      log.info(
        replacing
          ? `ai provider "${slug}" loaded (${source}), replacing the earlier one`
          : `ai provider "${slug}" loaded (${source})`,
      );
    }
  };

  await load(builtInDir, "built-in");
  await load(operatorDir, "operator");

  return {
    providers: [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    agentMd,
    skipped,
  };
}

/**
 * Rendered into the Architect / Engineer prompt for an AI build: one line per
 * provider, slug + description. Name + description only — the body loads
 * through `use_ai_provider`.
 */
export function aiProviderCatalogText(
  providers: Array<{ slug: string; description: string }>,
): string {
  if (providers.length === 0) return "";
  return providers
    .map((p) => `- ${p.slug}: ${p.description.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");
}

/**
 * Pushed onto `ALL_TOOLS` at boot when any provider loaded. Reads only a
 * loaded provider — a slug not in the catalog, or one with a path separator,
 * is refused.
 */
export function buildUseAiProviderTool(providers: AiProvider[]): ZelyqTool {
  const bySlug = new Map(providers.map((p) => [p.slug, p]));
  const slugList = providers.map((p) => p.slug).join(", ");
  return defineTool({
    name: "use_ai_provider",
    description:
      "Load one LLM provider's integration notes — the npm package, client init, the " +
      "non-streaming and streaming call shapes, the key name, and the official docs URL. Use it " +
      "before wiring a model into a build. The notes are a starting point pinned to a date: " +
      "always confirm the exact call against the installed package's own types / README, and " +
      "against the docs URL, before you rely on it. If the notes and the installed SDK disagree, " +
      `the installed SDK wins. Available: ${slugList}`,
    schema: z.object({
      slug: z.string().describe("A slug from the <ai_providers> list"),
    }),
    async run(_context, input): Promise<ToolResult> {
      const slug = input.slug.trim();
      if (!SLUG_RE.test(slug)) {
        return { output: `"${slug}" is not a valid provider slug.`, isError: true };
      }
      const provider = bySlug.get(slug);
      if (!provider) {
        return { output: `No AI provider "${slug}". Available: ${slugList}`, isError: true };
      }
      return { output: provider.body };
    },
  });
}

/** The cap applied when a provider body is folded into a child's prompt. */
export function capProviderBody(body: string): string {
  return truncate(body, PROVIDER_BODY_MAX);
}
