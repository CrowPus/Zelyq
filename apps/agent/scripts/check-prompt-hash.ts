/**
 * A `promptHash` gate (F2 / 06-measurement.md §4).
 *
 * The system prompt is the thing the eval suite measures. When a PR changes
 * `prompt.ts` but no recorded eval run matches the new prompt, the review's own
 * rule — a prompt change gets a before/after run on `claude-opus-5` — has been
 * skipped. This fails CI in that case, so the intention becomes a rule.
 *
 * It is a no-op when `prompt.ts` did not change. Local use:
 *
 *   pnpm --filter @zelyq/agent check:prompt-hash            # vs origin/main
 *   PROMPT_HASH_BASE=HEAD~1 pnpm --filter @zelyq/agent check:prompt-hash
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildSystemPrompt } from "../src/prompt.js";

const AGENT_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(AGENT_DIR, "..", "..");
const PROMPT_FILE = "apps/agent/src/prompt.ts";
const RESULTS_DIR = path.join(AGENT_DIR, "evals", "results");
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

function recordedHashes(): Set<string> {
  const hashes = new Set<string>();
  let files: string[] = [];
  try {
    files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return hashes;
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(RESULTS_DIR, file), "utf8")) as {
        promptHash?: unknown;
      };
      if (typeof parsed.promptHash === "string") hashes.add(parsed.promptHash);
    } catch {
      // A malformed result file is not this check's problem.
    }
  }
  return hashes;
}

const changed = changedFiles();
if (changed && !changed.includes(PROMPT_FILE)) {
  console.log(`prompt-hash: ${PROMPT_FILE} unchanged vs ${BASE} — nothing to check.`);
  process.exit(0);
}

const hash = currentPromptHash();
const recorded = recordedHashes();

if (recorded.has(hash)) {
  console.log(`prompt-hash: ok — an eval result exists for the current prompt (${hash}).`);
  process.exit(0);
}

console.error(
  `prompt-hash: FAIL — the system prompt is at ${hash}, and no file in\n` +
    `  apps/agent/evals/results/ records that hash.\n\n` +
    `  A prompt change gets a before/after eval run (06-measurement.md §4).\n` +
    `  Run it and commit the result:\n\n` +
    `    ZELYQ_PROVIDER=anthropic ZELYQ_MODEL=claude-opus-5 pnpm eval --tag restraint --limit 6\n\n` +
    `  Recorded hashes: ${recorded.size ? [...recorded].join(", ") : "(none)"}`,
);
process.exit(1);
