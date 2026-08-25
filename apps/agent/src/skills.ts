import fs from "node:fs/promises";
import path from "node:path";
import { defineTool, type ToolResult, truncate, type ZelyqTool } from "@zelyq/tools";
import { z } from "zod";

export interface Skill {
  name: string;
  description: string;
  body: string;
  /** Where this came from, for the boot log and /health — never shown to the model. */
  source: "built-in" | "operator";
}

export interface SkillLoadResult {
  skills: Skill[];
  skipped: Array<{ file: string; reason: string }>;
}

interface SkillLogger {
  info(message: string): void;
  warn(message: string): void;
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Skills — see `042` in the council notes. A skill is text, not code: it
 * cannot execute anything on its own, only try to talk the model into using
 * a tool it already has. That is a real, lower-stakes trust question than
 * `037`'s plugins (arbitrary functions with a full `ToolContext`), which is
 * why this exists as its own loader rather than folded into that one — the
 * two are not the same shape of risk and reasoning about them together
 * would weaken both.
 *
 * Two sources, both boot-time, both filesystem-only, same discipline `037`
 * already established: `builtInDir` (the repo's own `skills/`, always read,
 * no configuration needed) and `operatorDir` (`ZELYQ_SKILLS_DIR`, optional).
 * An operator's skill with the same name as a built-in **replaces** it —
 * unlike a plugin tool colliding with a built-in tool (`037` refuses that
 * outright), a skill overriding a skill is ordinary customization, not a
 * shadowing risk: nothing downstream trusts a skill's name as a safety
 * boundary the way a tool's name can be.
 */
export async function loadSkills(
  builtInDir: string | undefined,
  operatorDir: string | undefined,
  log: SkillLogger = console,
): Promise<SkillLoadResult> {
  const byName = new Map<string, Skill>();
  const skipped: Array<{ file: string; reason: string }> = [];

  const load = async (dir: string | undefined, source: Skill["source"]) => {
    if (!dir) return;
    let entries: string[];
    try {
      entries = (await fs.readdir(dir)).filter((name) => name.endsWith(".md")).sort();
    } catch (error) {
      log.warn(`skills directory "${dir}" could not be read: ${(error as Error).message}`);
      return;
    }

    for (const entry of entries) {
      const file = path.join(dir, entry);
      let raw: string;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch (error) {
        const reason = `could not be read: ${(error as Error).message}`;
        skipped.push({ file: entry, reason });
        log.warn(`skill "${entry}" ${reason} — skipped`);
        continue;
      }

      const parsed = parseSkill(raw);
      if (typeof parsed === "string") {
        skipped.push({ file: entry, reason: parsed });
        log.warn(`skill "${entry}": ${parsed} — skipped`);
        continue;
      }

      const replacing = byName.has(parsed.name);
      byName.set(parsed.name, { ...parsed, source });
      log.info(
        replacing
          ? `skill "${parsed.name}" loaded from ${entry} (${source}), replacing the earlier one`
          : `skill "${parsed.name}" loaded from ${entry} (${source})`,
      );
    }
  };

  // Operator second, deliberately — see the doc comment above.
  await load(builtInDir, "built-in");
  await load(operatorDir, "operator");

  return { skills: [...byName.values()], skipped };
}

/** A skill's own frontmatter is deliberately tiny — two flat strings — so a
 * hand-rolled parser is simpler and one less dependency than a real YAML
 * library for a shape that never needs one. */
function parseSkill(raw: string): Omit<Skill, "source"> | string {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return "missing the --- frontmatter block SKILL.md files start with";

  const [, frontmatter, body] = match;
  const fields: Record<string, string> = {};
  for (const line of (frontmatter ?? "").split("\n")) {
    const field = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (field) fields[field[1]!] = field[2]!.trim();
  }

  const name = fields.name;
  if (!name) return "frontmatter is missing 'name'";
  if (!NAME_PATTERN.test(name)) {
    return `name "${name}" must be lowercase letters, digits, and hyphens, starting with a letter`;
  }
  const description = fields.description;
  if (!description) return `skill "${name}" is missing a 'description'`;
  if (!(body ?? "").trim()) return `skill "${name}" has no instructions after the frontmatter`;

  return { name, description, body: (body ?? "").trim() };
}

/**
 * Built once at boot from whatever loaded, and pushed onto `ALL_TOOLS` the
 * same way a plugin tool is — see `apps/agent/src/index.ts`. Absent
 * entirely when no skills loaded, so a Zelyq checkout with an empty
 * `skills/` directory never advertises a tool with nothing behind it.
 */
export function buildUseSkillTool(skills: Skill[]): ZelyqTool {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  return defineTool({
    name: "use_skill",
    description:
      "Load the full instructions for a skill named in the <skills> list in your system prompt. " +
      "Call this before starting a task one of those descriptions actually matches — skip it " +
      "entirely when none do.",
    schema: z.object({ name: z.string().describe("A skill name from the <skills> list") }),
    async run(_context, input): Promise<ToolResult> {
      const skill = byName.get(input.name);
      if (!skill) {
        const known = [...byName.keys()].join(", ") || "none loaded";
        return { output: `No skill named "${input.name}". Available: ${known}`, isError: true };
      }
      return { output: truncate(skill.body, 20_000) };
    },
  });
}
