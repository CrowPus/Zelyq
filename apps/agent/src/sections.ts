/**
 * Long guidance (a skill, a design reference) read in proportion to the task.
 *
 * A one-screen converter loaded 52,000 characters of skills and a design
 * reference before writing a line, and every later step paid to carry them.
 * Most of that was one long section per document ("Required workflow",
 * "Components"). These helpers return a document with its long sections
 * folded to their headings, and any one section on request.
 */

export interface Section {
  /** The heading's text, without the #s. Empty for the text before the first heading. */
  title: string;
  level: number;
  /** The whole section: its heading line, its text and its subsections. */
  text: string;
}

/** The YAML front matter (`---` … `---`) at the very top, and the rest. */
export function splitFrontMatter(body: string): { frontMatter: string; rest: string } {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(body);
  return match
    ? { frontMatter: match[0], rest: body.slice(match[0].length) }
    : { frontMatter: "", rest: body };
}

/** Headings of `level` (2 for "## "), ignoring lines inside code fences. */
export function splitSections(text: string, level = 2): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let current: { title: string; lines: string[] } = { title: "", lines: [] };
  let fenced = false;
  const prefix = `${"#".repeat(level)} `;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    if (!fenced && line.startsWith(prefix)) {
      if (current.title || current.lines.some((entry) => entry.trim())) {
        sections.push({ title: current.title, level, text: current.lines.join("\n") });
      }
      current = { title: line.slice(prefix.length).trim(), lines: [line] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.title || current.lines.some((entry) => entry.trim())) {
    sections.push({ title: current.title, level, text: current.lines.join("\n") });
  }
  return sections;
}

/** A section folded to its heading, its subheadings and how to read it. */
function folded(section: Section): string {
  const subheadings = splitSections(section.text, section.level + 1)
    .filter((sub) => sub.title)
    .map((sub) => `  - ${sub.title}`);
  return [
    `${"#".repeat(section.level)} ${section.title}`,
    `(${section.text.length} characters, folded. Read it with section: "${section.title}"${
      subheadings.length ? ", or one of its parts by name" : ""
    }.)`,
    ...subheadings,
  ].join("\n");
}

/**
 * The document with every top-level section longer than `maxSection` folded,
 * or as it is when it is short enough already.
 */
export function condense(
  body: string,
  options: { threshold?: number; maxSection?: number } = {},
): string {
  const threshold = options.threshold ?? 7_000;
  const maxSection = options.maxSection ?? 2_500;
  if (body.length <= threshold) return body;
  return splitSections(body)
    .map((section) =>
      section.title && section.text.length > maxSection ? folded(section) : section.text.trimEnd(),
    )
    .join("\n\n");
}

/**
 * One section by its heading (any level, case does not matter; an exact
 * match first, then the first heading that contains the words), or null.
 */
export function findSection(body: string, wanted: string): string | null {
  const needle = wanted
    .trim()
    .replace(/^#+\s*/, "")
    .toLowerCase();
  if (!needle) return null;
  const all: Section[] = [];
  const walk = (text: string, level: number) => {
    if (level > 4) return;
    for (const section of splitSections(text, level)) {
      if (section.title) all.push(section);
      walk(section.text, level + 1);
    }
  };
  walk(body, 2);
  const exact = all.find((section) => section.title.toLowerCase() === needle);
  const loose = all.find((section) => section.title.toLowerCase().includes(needle));
  return (exact ?? loose)?.text.trimEnd() ?? null;
}

/** Every heading, for an answer to a section that does not exist. */
export function headings(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    if (fenced) continue;
    const match = /^(#{2,4}) (.+)$/.exec(line);
    if (match?.[1] && match[2]) out.push(`${"  ".repeat(match[1].length - 2)}${match[2].trim()}`);
  }
  return out;
}
