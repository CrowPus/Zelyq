/**
 * An OPTIONAL local reminder. NOT a CI gate — the
 * eval it points at costs real money, so nothing forces you to run it.
 *
 * If you changed `prompt.ts` and want to know whether the eval suite has seen
 * the new prompt, run this. It's a no-op when `prompt.ts` is unchanged, and it
 * exits non-zero (for your own scripting) when there's no recorded run for the
 * current prompt in `evals/baselines.json` — which `run.ts` updates after every
 * successful eval. Running the eval is always your call.
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
