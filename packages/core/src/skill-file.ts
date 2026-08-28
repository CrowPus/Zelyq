/**
 * Parsing a `SKILL.md`'s own frontmatter and body. Shared, not duplicated:
 * `apps/agent/src/skills.ts` uses
 * this to load a skill from disk, `apps/server`'s upload route uses the
 * same function to validate an uploaded one before it's ever written, and
 * the upload form in `apps/web` uses it to give instant feedback before a
 * file is even sent. One parser, three callers, never three chances for
 * the rules to quietly drift apart.
 *
 * Deliberately hand-rolled rather than a real YAML library: the
 * frontmatter this needs is two flat strings, a shape that never
 * justifies the dependency.
 */

export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface ParsedSkillFile {
  name: string;
  description: string;
  body: string;
}

/** Returns the parsed fields, or a human-readable reason it was rejected. Never throws. */
export function parseSkillFile(raw: string): ParsedSkillFile | string {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return "missing the --- frontmatter block SKILL.md starts with";

  const [, frontmatter, body] = match;
  const fields: Record<string, string> = {};
  for (const line of (frontmatter ?? "").split("\n")) {
    const field = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (field) fields[field[1]!] = field[2]!.trim();
  }

  const name = fields.name;
  if (!name) return "frontmatter is missing 'name'";
  if (!SKILL_NAME_PATTERN.test(name)) {
    return `name "${name}" must be lowercase letters, digits, and hyphens, starting with a letter`;
  }
  const description = fields.description;
  if (!description) return `skill "${name}" is missing a 'description'`;
  if (!(body ?? "").trim()) return `skill "${name}" has no instructions after the frontmatter`;

  return { name, description, body: (body ?? "").trim() };
}
