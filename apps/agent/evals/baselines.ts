import fs from "node:fs/promises";
import path from "node:path";
import type { SuiteResult } from "./types.js";

/**
 * `evals/results/` is gitignored — the per-run JSON stays local. `baselines.json`
 * is the committed distillate: one line per system-prompt hash that has actually
 * been run, so the `check:prompt-hash` CI gate has something in the repo to
 * check against. `run.ts` upserts into it after every successful run.
 */
export interface PromptBaseline {
  promptHash: string;
  provider: string;
  model: string;
  effort: string;
  /** `done`/`total` at the time — orientation, not a contract. */
  done: string;
  /** Basename of the run's result file in the (gitignored) results dir. */
  resultFile: string;
  ranAt: string;
}

export const BASELINES_FILE = path.join(import.meta.dirname, "baselines.json");

export async function readBaselines(): Promise<PromptBaseline[]> {
  try {
    return JSON.parse(await fs.readFile(BASELINES_FILE, "utf8")) as PromptBaseline[];
  } catch {
    return [];
  }
}

/**
 * Record this run's prompt hash. One entry per `promptHash` — a re-run of the
 * same prompt overwrites (latest wins), so the file tracks "has this prompt been
 * evaluated", not a history. Sorted newest-first.
 */
export async function upsertBaseline(suite: SuiteResult, resultFile: string): Promise<void> {
  const entry: PromptBaseline = {
    promptHash: suite.promptHash,
    provider: suite.provider,
    model: suite.model,
    effort: suite.effort,
    done: `${suite.cases.filter((c) => c.done).length}/${suite.cases.length}`,
    resultFile,
    ranAt: suite.startedAt,
  };
  const rest = (await readBaselines()).filter((e) => e.promptHash !== entry.promptHash);
  const next = [entry, ...rest].sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  await fs.writeFile(BASELINES_FILE, `${JSON.stringify(next, null, 2)}\n`);
}
