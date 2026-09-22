/**
 * Programmes — spec-driven builds that span many turns.
 *
 * Case study 001 (`docs/case-studies/001-spec-driven-production-build.md`):
 * handed a 3,450-line production specification, the agent wrote seventeen
 * files in one turn, filled the spec's own phase table with "Completed —
 * Turn 1" for every phase, cited the starter template's tests as proof, and
 * declared the product finished after seventeen minutes. Nothing in the
 * harness could tell a claim from evidence.
 *
 * A programme is recognised by one durable artefact: `PROJECT_EXECUTION.md`
 * at the project root, holding a phase table. The prompt tells the model to
 * create it for any specification-shaped request (see `<programme>` in
 * prompt.ts); this module is the deterministic half — it reads the table
 * back and refuses a `DONE` that has nothing behind it. The rule is the one
 * the founder's own spec stated (§68): DONE means the implementation exists,
 * tests exist and pass, and evidence is recorded. Never because code was
 * merely written.
 */

export const PROGRAMME_FILE = "PROJECT_EXECUTION.md";

/** The statuses a phase row may carry. Anything else is handed back. */
export const PHASE_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "BLOCKED",
  "VERIFYING",
  "DONE",
] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export interface PhaseRow {
  /** The row's first cell, e.g. "Phase 3" or "3". */
  phase: string;
  name: string;
  status: string;
  /** Raw cell text under a "Tests" column, if the table has one. */
  tests: string;
  /** Raw cell text under an "Evidence" column, if the table has one. */
  evidence: string;
  /** 1-based line in the file, for a precise hand-back. */
  line: number;
}

/**
 * Parses the first markdown table whose header names a `Status` column and
 * a `Phase` (or `#`) column. Other columns are matched by name, so a table
 * with the spec's eleven columns and a table with four both work; column
 * order does not matter.
 */
export function parseExecutionTable(markdown: string): PhaseRow[] {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    const header = lines[i]!;
    const divider = lines[i + 1]!;
    if (!header.includes("|") || !/^\s*\|?\s*:?-{2,}/.test(divider)) continue;
    const columns = splitRow(header).map((c) => c.toLowerCase());
    const statusIdx = columns.indexOf("status");
    const phaseIdx = columns.findIndex((c) => c === "phase" || c === "#" || c === "id");
    if (statusIdx === -1 || phaseIdx === -1) continue;
    const nameIdx = columns.findIndex((c) => c === "name" || c === "phase name" || c === "title");
    const testsIdx = columns.findIndex((c) => c === "tests" || c === "test");
    const evidenceIdx = columns.indexOf("evidence");
    const rows: PhaseRow[] = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j]!;
      if (!line.includes("|")) break;
      const cells = splitRow(line);
      if (cells.length <= statusIdx) continue;
      const phase = cells[phaseIdx]?.trim() ?? "";
      if (!phase) continue;
      rows.push({
        phase,
        name: nameIdx === -1 ? "" : (cells[nameIdx] ?? "").trim(),
        status: (cells[statusIdx] ?? "").trim(),
        tests: testsIdx === -1 ? "" : (cells[testsIdx] ?? "").trim(),
        evidence: evidenceIdx === -1 ? "" : (cells[evidenceIdx] ?? "").trim(),
        line: j + 1,
      });
    }
    return rows;
  }
  return [];
}

function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((c) => c.replace(/\*\*/g, "").replace(/`/g, "").trim());
}

/** "Completed", "done ✅", "DONE" all mean the row claims completion. */
export function claimsDone(status: string): boolean {
  return /\b(done|complete|completed|finished|shipped)\b/i.test(status);
}

const EMPTY_CELL = /^(?:|-|—|–|n\/a|none|tbd|todo|pending|\?+)$/i;
/** A path-looking token: has a slash or a test-file extension, no spaces. */
const PATH_TOKEN = /(?:[\w.-]+\/)+[\w.-]+|[\w-]+\.(?:test|spec)\.(?:tsx?|jsx?|py)|test_[\w-]+\.py/g;

export function testPathsIn(cell: string): string[] {
  const matches = cell.match(PATH_TOKEN) ?? [];
  return Array.from(
    new Set(
      matches
        .map((m) => m.replace(/^\.\//, "").replace(/[),.;:]+$/, ""))
        .filter((m) => !/^n\/a$/i.test(m)),
    ),
  );
}

/**
 * The evidence rule. Returns one problem per offending row, in the order the
 * rows appear, phrased so the model knows exactly what to change. An empty
 * array means the table is honest as far as this check can tell.
 *
 * `fileExists` resolves a project-relative path; it is asked only for the
 * path-looking tokens in a DONE row's Tests cell.
 */
export async function validateExecutionTable(
  rows: PhaseRow[],
  fileExists: (projectRelativePath: string) => Promise<boolean>,
): Promise<string[]> {
  const problems: string[] = [];
  for (const row of rows) {
    const label = row.name ? `${row.phase} (${row.name})` : row.phase;
    const normalized = row.status
      .toUpperCase()
      .replace(/[^A-Z_ ]/g, "")
      .trim()
      .replace(/\s+/g, "_");
    if (!(PHASE_STATUSES as readonly string[]).includes(normalized)) {
      if (claimsDone(row.status)) {
        problems.push(
          `line ${row.line}: ${label} has status "${row.status}". Use DONE (with tests and evidence) or one of ${PHASE_STATUSES.join(", ")}.`,
        );
      } else {
        problems.push(
          `line ${row.line}: ${label} has status "${row.status}", which is not one of ${PHASE_STATUSES.join(", ")}.`,
        );
      }
      if (!claimsDone(row.status)) continue;
    }
    if (!claimsDone(row.status)) continue;

    // A phase with nothing to test (documents, a threat model) may say so,
    // but must say why: "n/a: documentation only" is a statement, "—" is a
    // blank the model hopes nobody reads.
    const waived = /^n\/a\s*[:—–-]\s*\S.{6,}/i.test(row.tests);
    const paths = waived ? [] : testPathsIn(row.tests);
    if (waived) {
      // fall through to the evidence check
    } else if (paths.length === 0) {
      problems.push(
        `line ${row.line}: ${label} is DONE but its Tests cell names no test file${row.tests && !EMPTY_CELL.test(row.tests) ? ` ("${row.tests}")` : ""}. A phase is DONE only when a test that exercises it exists and passes — name the file, write "n/a: <why no test applies>", or set the status to VERIFYING.`,
      );
    } else {
      const missing: string[] = [];
      for (const p of paths) {
        if (!(await fileExists(p))) missing.push(p);
      }
      if (missing.length === paths.length) {
        problems.push(
          `line ${row.line}: ${label} is DONE but the test file${missing.length > 1 ? "s" : ""} it cites do${missing.length > 1 ? "" : "es"} not exist in the project: ${missing.join(", ")}. Write the test, or set the status to IN_PROGRESS.`,
        );
      }
    }
    if (EMPTY_CELL.test(row.evidence) || row.evidence.length < 12) {
      problems.push(
        `line ${row.line}: ${label} is DONE but records no evidence. Say what was run or seen — a command and its result, a route that was driven, a screenshot — not a status word.`,
      );
    }
  }
  return problems;
}

/**
 * Formats the hand-back the verification step adds to the conversation.
 * Returns null when there is nothing to say.
 */
export function programmeHandback(problems: string[]): string | null {
  if (problems.length === 0) return null;
  const shown = problems.slice(0, 8);
  return (
    `${PROGRAMME_FILE} claims more than the project backs up:\n\n` +
    shown.map((p) => `- ${p}`).join("\n") +
    (problems.length > shown.length ? `\n- …and ${problems.length - shown.length} more` : "") +
    "\n\nDONE means: the implementation exists, a test that exercises it exists and passes, the " +
    "acceptance criteria were verified on the running app, and the evidence is written in the row. " +
    "Correct the table to what is true — an honest IN_PROGRESS is fine; a DONE without evidence is not."
  );
}
