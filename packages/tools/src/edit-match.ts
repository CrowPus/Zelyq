/**
 * Where `edit_file`'s `old_text` sits in a file, and the file with it
 * replaced.
 *
 * Measured on stored history: 18% of edit_file calls failed, 12% of all of
 * them as "no match", mostly over whitespace the model reproduced slightly
 * wrong. Each miss cost a re-read and another step. This keeps the exact match
 * first and adds two narrow fallbacks that apply only when they find exactly
 * one place, and says when one was used.
 *
 * The replacement is spliced in by index. `String.prototype.replace` with a
 * string argument interprets `$&`, `$'`, `` $` `` and `$$` in the
 * replacement, so `` `$${price}` `` used to land on disk as `` `${price}` ``
 * while the tool reported success.
 */

export type EditMatch =
  | {
      ok: true;
      updated: string;
      /** 1-indexed line where the (first) replacement starts. */
      startLine: number;
      /** 1-indexed last line of the (first) replacement, in the updated file. */
      endLine: number;
      replacements: number;
      /** How the text was found, when it was not an exact match. */
      note?: string;
    }
  | { ok: false; reason: "no_match" | "ambiguous"; message: string };

export function applyEdit(
  original: string,
  oldText: string,
  newText: string,
  options: { replaceAll?: boolean } = {},
): EditMatch {
  // Work in "\n" and put the file's own line endings back afterwards, so a
  // CRLF file is matched by text a model wrote with plain newlines.
  const crlf = original.includes("\r\n");
  const content = crlf ? original.replace(/\r\n/g, "\n") : original;
  const find = crlf ? oldText.replace(/\r\n/g, "\n") : oldText;
  const replacement = crlf ? newText.replace(/\r\n/g, "\n") : newText;
  const restore = (text: string) => (crlf ? text.replace(/\n/g, "\r\n") : text);

  if (find.length === 0) {
    return { ok: false, reason: "no_match", message: "old_text is empty." };
  }

  const positions = allIndexes(content, find);
  if (positions.length > 1 && !options.replaceAll) {
    const lines = positions.map((at) => lineOf(content, at));
    return {
      ok: false,
      reason: "ambiguous",
      message:
        `Found ${positions.length} matches (at lines ${lines.join(", ")}). Include more surrounding ` +
        "context so the text appears exactly once, or pass replace_all: true to change every one.",
    };
  }
  if (positions.length >= 1) {
    let updated = "";
    let last = 0;
    for (const at of positions) {
      updated += content.slice(last, at) + replacement;
      last = at + find.length;
    }
    updated += content.slice(last);
    const first = positions[0] as number;
    const startLine = lineOf(content, first);
    return {
      ok: true,
      updated: restore(updated),
      startLine,
      endLine: startLine + replacement.split("\n").length - 1,
      replacements: positions.length,
    };
  }

  // Not found exactly. Try the same lines ignoring trailing whitespace, then
  // ignoring indentation; each only when it finds a single place.
  const fileLines = content.split("\n");
  const findLines = trimBlankEnds(find.split("\n"));
  if (findLines.length > 0) {
    for (const tier of TIERS) {
      const hits = lineWindows(fileLines, findLines, tier.same);
      if (hits.length > 1) {
        return {
          ok: false,
          reason: "ambiguous",
          message:
            `old_text was not found exactly, and ${tier.label} it matches ${hits.length} places ` +
            `(lines ${hits.map((h) => h + 1).join(", ")}). Include more surrounding context.`,
        };
      }
      if (hits.length === 1) {
        const at = hits[0] as number;
        const found = fileLines.slice(at, at + findLines.length);
        const newLines = tier.reindent
          ? reindent(trimBlankEnds(replacement.split("\n")), findLines, found)
          : trimBlankEnds(replacement.split("\n"));
        const updatedLines = [
          ...fileLines.slice(0, at),
          ...newLines,
          ...fileLines.slice(at + findLines.length),
        ];
        return {
          ok: true,
          updated: restore(updatedLines.join("\n")),
          startLine: at + 1,
          endLine: at + Math.max(newLines.length, 1),
          replacements: 1,
          note: `old_text matched ${tier.label} (lines ${at + 1}–${at + findLines.length}); check the result below.`,
        };
      }
    }
  }

  return { ok: false, reason: "no_match", message: nearestRegion(fileLines, findLines) };
}

const TIERS = [
  {
    label: "ignoring trailing whitespace",
    same: (a: string, b: string) => a.trimEnd() === b.trimEnd(),
    reindent: false,
  },
  {
    label: "ignoring indentation",
    same: (a: string, b: string) => a.trim() === b.trim(),
    reindent: true,
  },
] as const;

function allIndexes(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    out.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return out;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function trimBlankEnds(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] as string).trim() === "") start++;
  while (end > start && (lines[end - 1] as string).trim() === "") end--;
  return lines.slice(start, end);
}

function lineWindows(
  fileLines: string[],
  findLines: string[],
  same: (a: string, b: string) => boolean,
): number[] {
  const hits: number[] = [];
  for (let i = 0; i + findLines.length <= fileLines.length; i++) {
    let all = true;
    for (let j = 0; j < findLines.length; j++) {
      if (!same(fileLines[i + j] as string, findLines[j] as string)) {
        all = false;
        break;
      }
    }
    if (all) hits.push(i);
  }
  return hits;
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)?.[0] ?? "";

/** Shift the replacement by however far the model's indentation was off. */
function reindent(newLines: string[], findLines: string[], found: string[]): string[] {
  const firstModel = findLines.find((l) => l.trim() !== "");
  const firstFile = found.find((l) => l.trim() !== "");
  if (firstModel === undefined || firstFile === undefined) return newLines;
  const from = indentOf(firstModel);
  const to = indentOf(firstFile);
  if (from === to) return newLines;
  return newLines.map((line) => {
    if (line.trim() === "") return line;
    if (line.startsWith(from)) return to + line.slice(from.length);
    return line;
  });
}

/** The lines most like the start of `old_text`, so the next try can copy them. */
function nearestRegion(fileLines: string[], findLines: string[]): string {
  const base =
    "The text to replace was not found, even ignoring whitespace. Copy the exact lines from the " +
    "file — read_file shows them with line numbers.";
  const probe = findLines.find((l) => l.trim() !== "")?.trim();
  if (!probe) return base;
  const probeWords = words(probe);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < fileLines.length; i++) {
    const score = similarity(probeWords, words(fileLines[i] as string));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best === -1 || bestScore < 0.3) return base;
  const from = Math.max(0, best - 3);
  const to = Math.min(fileLines.length, best + Math.max(findLines.length, 1) + 3);
  const shown = fileLines
    .slice(from, to)
    .map((line, i) => `${String(from + i + 1).padStart(5)}\t${line}`)
    .join("\n");
  return `${base} The closest lines in the file are:\n\n${shown}`;
}

function words(line: string): Set<string> {
  return new Set(line.toLowerCase().match(/[a-z0-9_$]+/g) ?? []);
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(a.size, b.size);
}
