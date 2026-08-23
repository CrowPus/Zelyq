import type { ScaffoldFile } from "@zelyq/runtime";

/**
 * A check is an assertion about the project *after* the agent has finished.
 *
 * Every check must be decidable by a machine. "Looks good" is not a check —
 * if a human has to judge it, it does not belong in the suite, because the
 * whole point is to compare two prompt versions without a human in the loop.
 */
export type Check =
  /** `npm run typecheck` exits 0. */
  | { kind: "typecheck" }
  /** `npm run build` exits 0 — catches what the typecheck alone does not. */
  | { kind: "build" }
  /** The dev server starts, serves the page, and transforms the entry module. */
  | { kind: "preview" }
  | { kind: "file_exists"; path: string }
  | { kind: "file_absent"; path: string }
  /** A regex over one file's contents. `expect: "absent"` inverts it. */
  | {
      kind: "file_matches";
      path: string;
      pattern: string;
      expect?: "present" | "absent";
      why: string;
    }
  /** A regex over every text file in the project. */
  | { kind: "project_matches"; pattern: string; expect?: "present" | "absent"; why: string }
  /** The file is byte-identical to how the case started. */
  | { kind: "unchanged"; path: string }
  /** `dependencies` and `devDependencies` in package.json are untouched. */
  | { kind: "no_new_dependency" }
  /** The agent wrote nothing at all — for questions that should not cause edits. */
  | { kind: "no_writes" }
  /** Restraint: at most this many files changed. */
  | { kind: "max_files_changed"; count: number }
  /** No single source file longer than this. Catches restraint's opposite failure. */
  | { kind: "max_file_lines"; count: number }
  /** At most this many tool calls. For input that is not a task at all. */
  | { kind: "max_tool_calls"; count: number };

/**
 * The three checks that decide whether the app *works*. They are reported
 * separately from the rest because a case that fails one of them has failed
 * outright — the remaining assertions are describing a broken app.
 */
export const CRITICAL_KINDS: ReadonlySet<Check["kind"]> = new Set([
  "typecheck",
  "build",
  "preview",
]);

export interface EvalCase {
  id: string;
  title: string;
  /** Free-form labels for `--tag`: greenfield, modify, bugfix, restraint, quality. */
  tags: string[];
  prompt: string;
  /** Files laid down after the template and before the prompt — used to plant bugs. */
  setup?: ScaffoldFile[];
  /** Overrides the default iteration cap for cases that legitimately need more. */
  maxIterations?: number;
  checks: Check[];
}

export interface CheckResult {
  label: string;
  critical: boolean;
  ok: boolean;
  detail: string;
}

export interface CaseResult {
  id: string;
  title: string;
  tags: string[];
  /** Every critical check passed. This is the number the roadmap tracks. */
  works: boolean;
  /** Every check passed, critical or not. */
  clean: boolean;
  checks: CheckResult[];
  /** Model round-trips inside the turn. A proxy for how much flailing happened. */
  rounds: number;
  toolCalls: number;
  toolErrors: number;
  tokensIn: number;
  tokensOut: number;
  filesChanged: string[];
  durationMs: number;
  /** Set when the turn itself failed — a provider error, a crash, a timeout. */
  error: string | null;
}

export interface SuiteResult {
  startedAt: string;
  provider: string;
  model: string;
  effort: string;
  /** Hash of the system prompt, so two runs can be compared meaningfully. */
  promptHash: string;
  cases: CaseResult[];
}
