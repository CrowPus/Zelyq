/**
 * A line diff, written here rather than pulled in.
 *
 * The whole need is "show a person which lines the agent added and removed",
 * over files of a few hundred lines. A longest-common-subsequence table is
 * exact, is about thirty lines, and has no dependency to keep current. The
 * table is O(n·m), so very large files fall back to a plain replacement rather
 * than locking up the tab.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  /** Line number in the old file, if the line existed there. */
  before: number | null;
  /** Line number in the new file, if it exists there. */
  after: number | null;
  text: string;
}

/** Beyond this the table costs more memory than the answer is worth. */
const MAX_LINES = 3000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text, i) => ({ kind: "removed" as const, before: i + 1, after: null, text })),
      ...b.map((text, i) => ({ kind: "added" as const, before: null, after: i + 1, text })),
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i…] and b[j…].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      const next = lcs[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", before: i + 1, after: j + 1, text: a[i] as string });
      i++;
      j++;
    } else if ((lcs[i + 1] as number[])[j]! >= (lcs[i] as number[])[j + 1]!) {
      out.push({ kind: "removed", before: i + 1, after: null, text: a[i] as string });
      i++;
    } else {
      out.push({ kind: "added", before: null, after: j + 1, text: b[j] as string });
      j++;
    }
  }
  while (i < a.length)
    out.push({ kind: "removed", before: i + 1, after: null, text: a[i++] as string });
  while (j < b.length)
    out.push({ kind: "added", before: null, after: j + 1, text: b[j++] as string });

  return out;
}

/**
 * Drops long stretches of unchanged lines, keeping a few either side of every
 * change. A four-hundred-line file with a two-line edit is otherwise a
 * four-hundred-line answer to a two-line question.
 */
export function collapseUnchanged(lines: DiffLine[], context = 3): Array<DiffLine | "gap"> {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = index - context; k <= index + context; k++) {
      if (k >= 0 && k < lines.length) keep.add(k);
    }
  });

  const out: Array<DiffLine | "gap"> = [];
  let skipping = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line);
      skipping = false;
    } else if (!skipping) {
      out.push("gap");
      skipping = true;
    }
  });
  return out;
}

export function countChanges(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added++;
    if (line.kind === "removed") removed++;
  }
  return { added, removed };
}
