import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillFile } from "@zelyq/core";
import { defineTool, type ToolResult, truncate, type ZelyqTool } from "@zelyq/tools";
import { z } from "zod";

export interface Skill {
  name: string;
  description: string;
  /** SKILL.md's own body — kept short by convention, pointing deeper by relative path. */
  body: string;
  /** Absolute. Internal only — never shown to the model, only used to resolve a requested path safely. */
  dir: string;
  /** Where this came from, for the boot log and /health — never shown to the model. */
  source: "built-in" | "operator" | "uploaded";
}

export interface SkillLoadResult {
  skills: Skill[];
  skipped: Array<{ file: string; reason: string }>;
}

interface SkillLogger {
  info(message: string): void;
  warn(message: string): void;
}

const SKILL_FILE = "SKILL.md";

/**
 * Skills — see `042` in the council notes, corrected after a first version
 * shipped as a single flat file per skill and was rightly rejected: a real
 * skill is a directory. `SKILL.md` is the short entry point — the one thing
 * always loaded when the skill is used — and everything else underneath it
 * (a `references/` doc, a `recipes/` example, a `templates/` starting file,
 * a `scripts/` source file) loads only when the agent actually asks for
 * that one path. This is the whole point: a skill can carry real depth
 * without paying for any of it until a task genuinely needs it.
 *
 * The loader itself does not know or care what any of those subdirectory
 * names mean — `references/`, `recipes/`, `templates/`, `scripts/` are an
 * authoring convention for organizing a skill, not something enforced
 * here. Every file under a skill's directory besides `SKILL.md` is reached
 * the same one way, through `use_skill`'s `path`.
 *
 * A skill is still text, not code — reading `templates/foo/App.tsx` gets
 * the agent the file's content, which it then places with its own
 * `write_file`, the same as anything else it writes. Reading
 * `scripts/optimize-glb` gets the agent that script's source, which it can
 * adapt into a real command run through `run_command` inside the project's
 * own sandbox. Nothing here executes a file from outside the project on
 * the agent's behalf — that would be a real, new, separate trust boundary
 * (a project's container cannot even see this directory, for one), not an
 * extension of what a skill already safely is.
 *
 * Three sources, in the order later wins: `builtInDir` (the repo's own
 * `skills/`), `uploadedDir` (written by an instance admin through the
 * Settings page — see `043`), and `operatorDir` (`ZELYQ_SKILLS_DIR`, the
 * most manual, most explicit override). All three are still read once at
 * boot, never re-scanned while running — an upload takes effect on the
 * next restart, the same as a plugin already does, and the same reasoning
 * `037` already gave still holds: a skill being text rather than code is
 * why *loading* one can reach the UI at all, not a reason to also let it
 * take effect without a restart an admin can see coming.
 */
export async function loadSkills(
  builtInDir: string | undefined,
  uploadedDir: string | undefined,
  operatorDir: string | undefined,
  log: SkillLogger = console,
): Promise<SkillLoadResult> {
  const byName = new Map<string, Skill>();
  const skipped: Array<{ file: string; reason: string }> = [];

  const load = async (dir: string | undefined, source: Skill["source"]) => {
    if (!dir) return;
    let entries: string[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      log.warn(`skills directory "${dir}" could not be read: ${(error as Error).message}`);
      return;
    }

    for (const entry of entries) {
      const skillDir = path.join(dir, entry);
      const skillFile = path.join(skillDir, SKILL_FILE);
      let raw: string;
      try {
        raw = await fs.readFile(skillFile, "utf8");
      } catch {
        const reason = `has no ${SKILL_FILE} — every skill is a directory containing one`;
        skipped.push({ file: entry, reason });
        log.warn(`skill directory "${entry}" ${reason} — skipped`);
        continue;
      }

      const parsed = parseSkillFile(raw);
      if (typeof parsed === "string") {
        skipped.push({ file: `${entry}/${SKILL_FILE}`, reason: parsed });
        log.warn(`skill "${entry}": ${parsed} — skipped`);
        continue;
      }

      const replacing = byName.has(parsed.name);
      byName.set(parsed.name, { ...parsed, dir: skillDir, source });
      log.info(
        replacing
          ? `skill "${parsed.name}" loaded from ${entry}/ (${source}), replacing the earlier one`
          : `skill "${parsed.name}" loaded from ${entry}/ (${source})`,
      );
    }
  };

  // Later wins on a name collision — see the doc comment above. Built-in
  // first (the box's own defaults), then uploaded (chosen through the
  // Settings page — see `043`), then the operator's own directory last,
  // still the most explicit, most manual override available.
  await load(builtInDir, "built-in");
  await load(uploadedDir, "uploaded");
  await load(operatorDir, "operator");

  return { skills: [...byName.values()], skipped };
}

/** Every file under a skill's directory besides `SKILL.md` itself, as
 * relative paths — what `use_skill` tells the model exists without it
 * having to guess a filename. Exported for Engineer Mode's system-prompt
 * addendum (see ZED-0001, `prompt.ts`): baking a skill's body directly into
 * the system prompt bypasses the live `use_skill` call that would normally
 * produce this listing, so the addendum has to compute and include it the
 * same way, or the model has no way to know a skill's deeper files exist. */
export async function listResources(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string, prefix: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), relative);
      } else if (relative !== SKILL_FILE) {
        results.push(relative);
      }
    }
  }
  await walk(dir, "");
  return results;
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
      "Load a skill named in the <skills> list in your system prompt. Called with just a name, " +
      "this returns the skill's own short instructions plus a list of every deeper file it has — " +
      "a reference doc, a worked recipe, a starting template, a script's source. Call it again " +
      "with one of those paths to actually read that file. Skip this tool entirely when no task " +
      "matches a skill's description.",
    schema: z.object({
      name: z.string().describe("A skill name from the <skills> list"),
      path: z
        .string()
        .optional()
        .describe("A path from a previous call's file list, to read that specific file"),
    }),
    async run(_context, input): Promise<ToolResult> {
      const skill = byName.get(input.name);
      if (!skill) {
        const known = [...byName.keys()].join(", ") || "none loaded";
        return { output: `No skill named "${input.name}". Available: ${known}`, isError: true };
      }

      if (!input.path) {
        const resources = await listResources(skill.dir);
        const list = resources.length
          ? `\n\nOther files this skill has, readable with path:\n${resources.map((r) => `- ${r}`).join("\n")}`
          : "";
        return { output: `${truncate(skill.body, 20_000)}${list}` };
      }

      // Resolved and checked before ever touching the filesystem — a
      // "../../etc/passwd" must never escape the skill's own directory,
      // the same discipline every other file-reading tool already holds.
      const resolved = path.resolve(skill.dir, input.path);
      const withinSkill = resolved === skill.dir || resolved.startsWith(skill.dir + path.sep);
      if (!withinSkill) {
        return { output: `"${input.path}" is outside this skill's own directory.`, isError: true };
      }

      let raw: string;
      try {
        raw = await fs.readFile(resolved, "utf8");
      } catch (error) {
        return {
          output: `Could not read "${input.path}": ${(error as Error).message}`,
          isError: true,
        };
      }
      // A binary file (an image, a real .glb) decodes as garbage rather than
      // throwing — the replacement character is the tell, and handing that
      // to the model as "content" would be worse than saying so plainly.
      if (raw.includes("�")) {
        return {
          output: `"${input.path}" doesn't look like a text file — skills only serve text content today.`,
          isError: true,
        };
      }

      return { output: truncate(raw, 20_000) };
    },
  });
}
