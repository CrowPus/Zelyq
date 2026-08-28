import fs from "node:fs/promises";
import path from "node:path";
import { defineTool, type ToolResult, truncate, type ZelyqTool } from "@zelyq/tools";
import { z } from "zod";

/**
 * 056 — the design reference library.
 *
 * `design-md/` is a directory of directories, one per reference, each with a
 * `DESIGN.md`: an analysis of a real product's design language — token
 * front-matter (colours, type scale, spacing, components) plus prose, and an
 * open-source font substitute for any proprietary face. A `design-md/Agent.md`
 * at the root is a brand-neutral MUST/SHOULD/NEVER UI-craft checklist.
 *
 * The Architect picks the closest reference to the project's product category
 * and personality and bases the project's `architecture/DESIGN.md` on it —
 * ADAPTED and ATTRIBUTED, never skinned. The Designer agent gets the same
 * tool. `Agent.md` is inlined into the Architect and Engineer prompts and its
 * observable rules become verifier / Designer gate items.
 *
 * Loaded like skills (`skills.ts`): a name+description catalog is cheap and
 * always present in the prompt; the full body loads on demand through
 * `use_design_ref(slug)`. Two sources, later wins on a slug collision:
 * `repoRoot/design-md` (built-in) and `ZELYQ_DESIGN_REFS_DIR` (operator).
 * Read once at boot, never re-scanned while running.
 */

const DESIGN_FILE = "DESIGN.md";
const AGENT_FILE = "Agent.md";
/** A resolved reference body is capped when injected into a child, the same
 * way `051` caps an injected skill body. */
const REF_BODY_MAX = 16_000;
/** No `/`, no `..`, no leading dot — a slug only ever names one loaded dir. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export interface DesignRef {
  /** The directory name — what `use_design_ref` is called with. */
  slug: string;
  /** A one-line summary for the catalog in the prompt. */
  description: string;
  /** The whole `DESIGN.md` (front-matter + prose). Internal until requested. */
  body: string;
  /** Absolute. Internal only — never shown to the model. */
  dir: string;
  source: "built-in" | "operator";
}

export interface DesignRefsResult {
  refs: DesignRef[];
  /** `design-md/Agent.md` contents, or null if none loaded. */
  agentMd: string | null;
  skipped: Array<{ file: string; reason: string }>;
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

/** Front-matter `key: value`, `key: "value"`, and `key: |` block scalars.
 * Deliberately small — this needs a name and a one-line description, not a
 * YAML engine. Returns whatever it found; missing keys are the caller's
 * problem to fall back on. */
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
      // Block scalar: subsequent indented lines, joined.
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

/** First non-empty, non-heading, non-fence prose line of a body — the
 * fallback description for a reference whose front-matter has none (or has
 * no front-matter at all). */
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

export async function loadDesignRefs(
  builtInDir: string | undefined,
  operatorDir: string | undefined,
  log: Logger = console,
): Promise<DesignRefsResult> {
  const bySlug = new Map<string, DesignRef>();
  const skipped: Array<{ file: string; reason: string }> = [];
  let agentMd: string | null = null;

  const load = async (dir: string | undefined, source: DesignRef["source"]) => {
    if (!dir) return;
    let entries: string[];
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      entries = dirents
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      // A root Agent.md — operator's wins because operator loads last.
      const agentPath = path.join(dir, AGENT_FILE);
      const agent = await fs.readFile(agentPath, "utf8").catch(() => null);
      if (agent?.trim()) agentMd = agent.trim();
    } catch (error) {
      log.warn(`design refs directory "${dir}" could not be read: ${(error as Error).message}`);
      return;
    }

    for (const slug of entries) {
      if (!SLUG_RE.test(slug)) {
        skipped.push({ file: slug, reason: "directory name is not a valid slug" });
        continue;
      }
      const refDir = path.join(dir, slug);
      const raw = await fs.readFile(path.join(refDir, DESIGN_FILE), "utf8").catch(() => null);
      if (raw === null || !raw.trim()) {
        skipped.push({ file: slug, reason: `has no ${DESIGN_FILE}` });
        log.warn(`design ref "${slug}" has no ${DESIGN_FILE} — skipped`);
        continue;
      }
      const fm = frontMatterFields(raw);
      const description =
        fm.description?.trim() ||
        firstProseLine(raw).slice(0, 280) ||
        `Design language reference: ${slug}`;
      const replacing = bySlug.has(slug);
      bySlug.set(slug, { slug, description, body: raw.trim(), dir: refDir, source });
      log.info(
        replacing
          ? `design ref "${slug}" loaded (${source}), replacing the earlier one`
          : `design ref "${slug}" loaded (${source})`,
      );
    }
  };

  await load(builtInDir, "built-in");
  await load(operatorDir, "operator");

  return {
    refs: [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    agentMd,
    skipped,
  };
}

/**
 * Rendered into the Architect prompt (and given to the Designer child): one
 * line per reference, slug + description. Name + description only, never a
 * body — the body loads through `use_design_ref`.
 */
export function designRefCatalogText(refs: Array<{ slug: string; description: string }>): string {
  if (refs.length === 0) return "";
  return refs
    .map((r) => `- ${r.slug}: ${r.description.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");
}

/**
 * Pushed onto `ALL_TOOLS` at boot when any reference loaded. Available in
 * Architect Mode and to the Designer child (see `session.ts`). Reads only a
 * loaded reference — a slug that is not in the catalog, or contains a path
 * separator, is refused.
 */
export function buildUseDesignRefTool(refs: DesignRef[]): ZelyqTool {
  const bySlug = new Map(refs.map((r) => [r.slug, r]));
  const slugList = refs.map((r) => r.slug).join(", ");
  return defineTool({
    name: "use_design_ref",
    description:
      "Load one design reference from the <design_references> list in your prompt. Returns that " +
      "product's full design-language analysis — colour roles, a type scale with an open-source " +
      "font substitute, spacing, radius, elevation, and component conventions. Use it when drafting " +
      "or deepening a project's DESIGN.md: pick the reference closest to the project's product " +
      "category and personality, then ADAPT it — rename to the project's domain, drop what does not " +
      "apply, recolour if the personality differs. Never skin the project as the brand; never use " +
      "its logo or wordmark.",
    schema: z.object({
      slug: z.string().describe("A slug from the <design_references> list"),
    }),
    async run(_context, input): Promise<ToolResult> {
      const slug = input.slug.trim();
      if (!SLUG_RE.test(slug)) {
        return { output: `"${slug}" is not a valid reference slug.`, isError: true };
      }
      const ref = bySlug.get(slug);
      if (!ref) {
        return {
          output: `No design reference "${slug}". Available: ${slugList}`,
          isError: true,
        };
      }
      return { output: ref.body };
    },
  });
}

/** The cap applied when a reference body is folded into a child's prompt. */
export function capRefBody(body: string): string {
  return truncate(body, REF_BODY_MAX);
}
