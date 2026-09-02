/**
 * A `promptHash` gate (F2 / 06-measurement.md §4).
 *
 * The system prompt is the thing the eval suite measures. When a PR changes
 * `prompt.ts` but no eval run has been recorded for the new prompt, the
 * review's own rule — a prompt change gets a before/after run on
 * `claude-opus-5` — has been skipped. This fails CI in that case, so the
 * intention becomes a rule.
 *
 * `evals/results/` is gitignored, so it never reaches CI. `evals/baselines.json`
 * is committed: `run.ts` upserts the current prompt hash into it after every
 * successful run, so "did you run the eval after changing the prompt" reduces
 * to "is the current hash in baselines.json".
 *
 * A no-op when `prompt.ts` did not change. Local use:
 *
 *   pnpm --filter @zelyq/agent check:prompt-hash            # vs origin/main
 *   PROMPT_HASH_BASE=HEAD~1 pnpm --filter @zelyq/agent check:prompt-hash
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASELINES_FILE, type PromptBaseline } from "../evals/baselines.js";
import { buildSystemPrompt } from "../src/prompt.js";

const AGENT_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(AGENT_DIR, "..", "..");
const PROMPT_FILE = "apps/agent/src/prompt.ts";
const BASE = process.env.PROMPT_HASH_BASE ?? "origin/main";

function changedFiles(): string[] | null {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${BASE}...HEAD`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return null; // no git, or base ref missing (shallow clone) — enforce anyway
  }
}

/** The hash `run.ts` records: default mode, the default template. */
function currentPromptHash(): string {
  const prompt = buildSystemPrompt({ projectName: "x", template: "vite-react" });
  return createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

function baselines(): PromptBaseline[] {
  try {
    return JSON.parse(readFileSync(BASELINES_FILE, "utf8")) as PromptBaseline[];
  } catch {
    return [];
  }
}

const changed = changedFiles();
if (changed && !changed.includes(PROMPT_FILE)) {
  console.log(`prompt-hash: ${PROMPT_FILE} unchanged vs ${BASE} — nothing to check.`);
  process.exit(0);
}

const hash = currentPromptHash();
const recorded = baselines();
const match = recorded.find((entry) => entry.promptHash === hash);

if (match) {
  console.log(
    `prompt-hash: ok — ${hash} was evaluated on ${match.model} (${match.effort}) at ${match.ranAt}.`,
  );
  process.exit(0);
}

console.error(
  `prompt-hash: FAIL — the system prompt is at ${hash}, and evals/baselines.json\n` +
    `  has no run recorded for it.\n\n` +
    `  A prompt change gets a before/after eval run (06-measurement.md §4).\n` +
    `  Run it and commit the updated evals/baselines.json:\n\n` +
    `    ZELYQ_PROVIDER=anthropic ZELYQ_MODEL=claude-opus-5 pnpm eval --limit 5\n\n` +
    `  Recorded: ${recorded.length ? recorded.map((e) => e.promptHash).join(", ") : "(none)"}`,
);
process.exit(1);
