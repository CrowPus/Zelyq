import type { ScaffoldFile } from "@zelyq/runtime";

/**
 * A check is an assertion about the project *after* the agent has finished.
 *
 * Every check must be decidable by a machine. "Looks good" is not a check —
 * if a human has to judge it, it does not belong in the suite, because the
 * whole point is to compare two prompt versions without a human in the loop.
 */
export type Check = CheckKind & CheckFlags;

export interface CheckFlags {
  /**
   * A stylistic assertion that must not decide whether the work was done.
   *
   * Off by default, and deliberately so: an opt-*in* list of what counts is how
   * a metric ends up permissive, because a case whose author wrote no list
   * scores generously. Marking a check cosmetic costs somebody writing the
   * word, and shows up in review.
   */
  cosmetic?: boolean;
}

type CheckKind =
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
  /**
   * Restraint, measured directly: no *new* component file whose name the
   * request never mentioned. `max_files_changed` is a proxy — it cannot tell a
   * clean decomposition of the asked-for feature (good) from components nobody
   * asked for (bad), and on a model that decomposes well it fails the first to
   * catch the second. This names the second kind.
   *
   * `allow` is the component names the prompt actually asked for. A new
   * `src/**\/<Name>.{tsx,jsx}` (uppercase initial) is fine if its name shares a
   * case-insensitive stem with any allow entry — so `["Feature"]` admits
   * `FeatureCard`, and `App` / `main` / `index` are always fine. Anything else
   * is the invented scope `<scope>` describes.
   */
  | { kind: "no_unrequested_components"; allow: string[]; why: string }
  /** No single source file longer than this. Catches restraint's opposite failure. */
  | { kind: "max_file_lines"; count: number }
  /** At most this many tool calls. For input that is not a task at all. */
  | { kind: "max_tool_calls"; count: number }
  /** A regex over the agent's final message — the only check on what it said. */
  | { kind: "reply_matches"; pattern: string; expect?: "present" | "absent"; why: string }
  /**
   * The app actually renders in a browser: no uncaught exception, and the root
   * element is not empty.
   *
   * `preview` proves every module compiles and is served. It cannot see a
   * component that throws on mount — the app builds, the page is served, and
   * the user gets a white screen. Appended wherever `preview` is asserted.
   */
  | { kind: "renders" }
  /**
   * The agent changed at least one file.
   *
   * Appended automatically to every case that does not assert `no_writes`. A
   * case that asked for work and produced no diff has not done the work, and
   * without this a case whose remaining assertions the template already
   * satisfies would score as done.
   */
  | { kind: "changed_something" };

/**
 * The checks that decide whether the project is still *intact* — that the agent
 * did not leave a broken build behind. They are reported separately
 * because failing one of them means the remaining assertions are describing a
 * broken app.
 *
 * **These do not measure whether the work was done.** Every case starts from a
 * template that already typechecks, builds and previews, so an agent that
 * changes nothing passes all three. That is why `intact` is not the headline:
 * see `done`.
 */
export const CRITICAL_KINDS: ReadonlySet<Check["kind"]> = new Set([
  "typecheck",
  "build",
  "preview",
  "renders",
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
  /**
   * Doing nothing to the files is a correct answer here.
   *
   * Some cases are passed by *not* editing: asking what an underspecified
   * request means, or doing the work through a tool rather than the filesystem.
   * Without this they fail the `changed_something` check that is otherwise
   * appended, which marks down the exact behaviour they exist to reward.
   *
   * Deliberately an opt-out. Requiring a change is the default, so a case that
   * forgets this fails loudly and gets fixed — where a forgotten opt-*in* would
   * quietly inflate the score, which is the mistake this whole metric was built
   * to stop making.
   */
  noChangeIsValid?: boolean;
  checks: Check[];
}

export interface CheckResult {
  label: string;
  critical: boolean;
  /** Stylistic: reported, but does not decide whether the work was done. */
  cosmetic: boolean;
  ok: boolean;
  detail: string;
}

export interface CaseResult {
  id: string;
  title: string;
  tags: string[];
  /**
   * The project still typechecks, builds and previews.
   *
   * Was called `works` and tracked as the quality number, which it never was:
   * it scored 100% in every run ever recorded, because the untouched template
   * satisfies all three. Renamed to what it measures.
   */
  intact: boolean;
  /**
   * The work was actually done: `intact`, and every check that is not marked
   * cosmetic passed. **This is the number to track.**
   */
  done: boolean;
  /** Every check passed, cosmetic ones included. */
  clean: boolean;
  checks: CheckResult[];
  /** Model round-trips inside the turn. A proxy for how much flailing happened. */
  rounds: number;
  toolCalls: number;
  toolErrors: number;
  tokensIn: number;
  tokensOut: number;
  filesChanged: string[];
  /** The agent's final message. Some requests are answered, not built. */
  reply: string;
  durationMs: number;
  /** Set when the turn itself failed — a provider error, a crash, a timeout. */
  error: string | null;
}

export interface SuiteResult {
  startedAt: string;
  provider: string;
  model: string;
  effort: string;
  /** Which endpoint answered, when it was not the vendor's own. */
  baseUrl?: string;
  /** Hash of the system prompt, so two runs can be compared meaningfully. */
  promptHash: string;
  /** See `--engineer-mode` in `run.ts`, and the scope-discipline criterion
   * this exists to measure. Absent means off, same as before this field
   * existed. */
  engineerMode?: boolean;
  cases: CaseResult[];
}
