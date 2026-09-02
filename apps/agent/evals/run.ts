import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadEnvFile } from "@zelyq/core/node";
import { createRuntimeDriver } from "@zelyq/runtime";
import { loadAgentConfig } from "../src/config.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { PROVIDERS, speaksOpenAIDialect } from "../src/providers/index.js";
import { listResources, loadSkills } from "../src/skills.js";
import { upsertBaseline } from "./baselines.js";
import { selectCases } from "./cases.js";
import { neverRan, runCase } from "./harness.js";
import {
  cachedFraction,
  estimateCostUsd,
  formatUsd,
  type TokenCounts,
  totalPromptTokens,
} from "./rates.js";
import type { CaseResult, EvalCase, SuiteResult } from "./types.js";
import { EVAL_WORKSPACE, prepareBaseProject } from "./workspace.js";

loadEnvFile();

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    tag: { type: "string", multiple: true },
    limit: { type: "string" },
    concurrency: { type: "string", default: "3" },
    timeout: { type: "string", default: "600" },
    template: { type: "string", default: "vite-react" },
    keep: { type: "boolean", default: false },
    compare: { type: "string" },
    help: { type: "boolean", default: false },
    // Runs the scope-discipline criterion: Engineer Mode on, same cases,
    // same checks.
    "engineer-mode": { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`
zelyq evals — measure whether the agent actually builds working software

  pnpm eval                          run everything
  pnpm eval --tag bugfix --tag restraint
  pnpm eval --only tiny-edit,fix-import
  pnpm eval --limit 5 --concurrency 2
  pnpm eval --compare evals/results/<file>.json
  pnpm eval --keep                   leave projects on disk to inspect

This spends real money on real model calls. Start with --limit.
`);
  process.exit(0);
}

const config = await loadAgentConfig();

const info = PROVIDERS[config.provider];

// A model on your own network usually has no key, and refusing to start
// without one would make the local score — the number this suite most needs to
// publish honestly — impossible to measure.
if (!config.apiKey && !info.apiKeyOptional) {
  console.error(
    `No API key. Set ${info.apiKeyEnv.join(" or ")} in .env — see ${info.docsUrl}.\n` +
      "Evals call the real model; there is nothing to measure without one.",
  );
  process.exit(1);
}

if (speaksOpenAIDialect(config.provider) && !config.baseUrl) {
  console.error(
    `${info.label} needs an endpoint. Set ZELYQ_MODEL_BASE_URL in .env — ` +
      "for example http://localhost:11434/v1 for Ollama.",
  );
  process.exit(1);
}

if (config.provider === "custom" && !config.model) {
  console.error(
    "A custom endpoint has no default model. Set ZELYQ_MODEL to the name your server reports.",
  );
  process.exit(1);
}

if (
  values["engineer-mode"] &&
  config.effort !== "high" &&
  config.effort !== "xhigh" &&
  config.effort !== "max"
) {
  console.error(
    `--engineer-mode needs effort at "high" or above — this run is ` +
      `configured for "${config.effort}". Set ZELYQ_EFFORT.`,
  );
  process.exit(1);
}

let engineerModeSkill: { body: string; resources: string[] } | undefined;
if (values["engineer-mode"]) {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const { skills } = await loadSkills(path.join(repoRoot, "skills"), undefined, undefined);
  const skill = skills.find((entry) => entry.name === "senior-software-engineering");
  if (!skill) {
    console.error(
      "--engineer-mode needs the senior-software-engineering skill, and it wasn't found at boot.",
    );
    process.exit(1);
  }
  engineerModeSkill = { body: skill.body, resources: await listResources(skill.dir) };
}

const cases = selectCases({
  only: values.only?.split(",").map((id) => id.trim()),
  tag: values.tag,
  limit: values.limit ? Number.parseInt(values.limit, 10) : undefined,
});

if (cases.length === 0) {
  console.error("No cases matched that selection.");
  process.exit(1);
}

const runtime = createRuntimeDriver({ ...config.runtime, workspaceDir: EVAL_WORKSPACE });
const log = (message: string): void => console.log(`  ${message}`);

console.log(
  `\n${cases.length} case${cases.length === 1 ? "" : "s"} · ${config.provider}/${config.model} · effort ${config.effort}` +
    `${config.baseUrl ? ` · ${config.baseUrl}` : ""}${values["engineer-mode"] ? " · engineer mode" : ""}\n`,
);

const baseRoot = await prepareBaseProject(runtime, values.template, log);

const started = Date.now();

// Five identical `model not found` errors is one configuration problem, not
// five measurements. Count never-ran failures by their message; once the same
// one has happened twice, stop starting cases and report the cause.
const configErrors = new Map<string, number>();
let abortReason: string | null = null;

const results = await pool(cases, Number.parseInt(values.concurrency, 10), async (evalCase) => {
  if (abortReason) return skipped(evalCase);

  const result = await runCase(evalCase, {
    runtime,
    baseRoot,
    template: values.template,
    provider: config.provider,
    model: config.model,
    effort: config.effort,
    apiKey: config.apiKey ?? "",
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    maxIterations: config.maxTurnIterations,
    timeoutMs: Number.parseInt(values.timeout, 10) * 1000,
    keep: values.keep,
    log,
    ...(values["engineer-mode"] ? { engineerMode: true } : {}),
    ...(engineerModeSkill ? { engineerModeSkill } : {}),
  });

  if (neverRan(result) && result.error) {
    const seen = (configErrors.get(result.error) ?? 0) + 1;
    configErrors.set(result.error, seen);
    if (seen >= 2 && !abortReason) abortReason = result.error;
  }

  console.log(line(result, config.model));
  return result;
});

await runtime.dispose();

const suite: SuiteResult = {
  startedAt: new Date(started).toISOString(),
  provider: config.provider,
  model: config.model,
  effort: config.effort,
  // "custom scored 41%" means nothing without saying which server answered.
  ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  promptHash: createHash("sha256")
    .update(
      buildSystemPrompt({
        projectName: "x",
        template: values.template,
        ...(values["engineer-mode"] ? { engineerMode: { skill: engineerModeSkill } } : {}),
      }),
    )
    .digest("hex")
    .slice(0, 12),
  ...(values["engineer-mode"] ? { engineerMode: true } : {}),
  cases: results,
};

// A run where nothing reached the model measures the configuration, not the
// agent. Don't print a `done 0%` / `intact 100%` table that invites the wrong
// reading, don't save it where `--compare` would read it as a collapse.
const ran = results.filter((result) => !neverRan(result));
if (ran.length === 0) {
  const cause = abortReason ?? results.find((r) => r.error)?.error ?? "unknown";
  console.error(`
─────────────────────────────────────────────
 Nothing reached the model. This run measures nothing and was not saved.

   ${cause}
${
  config.provider === "google" || config.provider === "openai" || config.provider === "anthropic"
    ? `   Check ZELYQ_PROVIDER=${config.provider} and ZELYQ_MODEL=${config.model} name the\n   same vendor, and that the key is valid.`
    : `   Check ZELYQ_PROVIDER / ZELYQ_MODEL / ZELYQ_BASE_URL / the key.`
}
─────────────────────────────────────────────`);
  process.exit(1);
}
if (abortReason) {
  console.error(
    `\n Aborted after 2 cases failed identically before reaching the model:\n\n   ${abortReason}\n\n` +
      ` ${ran.length}/${results.length} cases ran; the rest were skipped. Not saved.`,
  );
  process.exit(1);
}

report(suite, Date.now() - started);

const outPath = path.join(
  EVAL_WORKSPACE,
  "..",
  "results",
  `${suite.startedAt.replace(/[:.]/g, "-")}.json`,
);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(suite, null, 2)}\n`);
console.log(`\nsaved ${path.relative(process.cwd(), outPath)}`);

// The per-run JSON is gitignored; record the prompt hash in the committed
// baselines file so the check:prompt-hash gate has something to check.
await upsertBaseline(suite, path.basename(outPath));

if (values.compare) await compare(suite, values.compare);

// A red suite must fail CI once this is wired in. Keyed on `done`, not
// `intact`: an agent that changed nothing leaves the project intact.
process.exit(results.every((result) => result.done) ? 0 : 1);

// ---------------------------------------------------------------------------

/** A case that never started because the suite aborted first. Scored as errored. */
function skipped(evalCase: EvalCase): CaseResult {
  return {
    id: evalCase.id,
    title: evalCase.title,
    tags: evalCase.tags,
    intact: false,
    done: false,
    clean: false,
    checks: [],
    rounds: 0,
    toolCalls: 0,
    toolErrors: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    filesChanged: [],
    reply: "",
    durationMs: 0,
    error: "skipped — suite aborted on a repeated config error",
  };
}

function line(result: CaseResult, model: string): string {
  const failed = result.checks.filter((check) => !check.ok);
  const mark = neverRan(result)
    ? "⚠"
    : result.clean
      ? "✓"
      : result.done
        ? "◑"
        : result.intact
          ? "~"
          : "✗";
  const detail = result.error
    ? result.error
    : failed.length
      ? failed.map((check) => check.label).join(", ")
      : "";
  const cost = estimateCostUsd(model, tokenCountsOf(result));
  return [
    ` ${mark} ${result.id.padEnd(22)}`,
    `${String(result.rounds).padStart(2)} rounds`,
    `${String(result.toolCalls).padStart(3)} tools`,
    `${String(Math.round(result.durationMs / 1000)).padStart(4)}s`,
    cost !== null && `${formatUsd(cost).padStart(6)}`,
    detail && ` — ${detail}`,
  ]
    .filter(Boolean)
    .join("  ");
}

function report(suite: SuiteResult, elapsedMs: number): void {
  const total = suite.cases.length;
  const intact = suite.cases.filter((result) => result.intact).length;
  const done = suite.cases.filter((result) => result.done).length;
  const clean = suite.cases.filter((result) => result.clean).length;
  const errored = suite.cases.filter((result) => neverRan(result)).length;
  const checks = suite.cases.flatMap((result) => result.checks);
  const passed = checks.filter((check) => check.ok).length;

  console.log(`
─────────────────────────────────────────────
 done     ${done}/${total}  (${pct(done, total)})   the work was actually done
 intact   ${intact}/${total}  (${pct(intact, total)})   still typechecks, builds and previews
 clean    ${clean}/${total}  (${pct(clean, total)})   every check passed, cosmetic included${
   errored > 0
     ? `\n errored  ${errored}/${total}  (${pct(errored, total)})   the model was never reached — measures nothing`
     : ""
}
 checks   ${passed}/${checks.length}  (${pct(passed, checks.length)})

 rounds   median ${median(suite.cases.map((r) => r.rounds))}
 tools    median ${median(suite.cases.map((r) => r.toolCalls))}   ${suite.cases.reduce((sum, r) => sum + r.toolErrors, 0)} tool errors total
 tokens   ${fmt(totalPromptTokens(suiteTokens(suite.cases)))} in · ${fmt(suiteTokens(suite.cases).tokensOut)} out${cachedNote(suiteTokens(suite.cases))}
 cost     ${formatUsd(suiteCostUsd(suite))}${costCaveat(suite.model)}
 wall     ${Math.round(elapsedMs / 1000)}s
 prompt   ${suite.promptHash}
─────────────────────────────────────────────`);

  const broken = suite.cases.filter((result) => !result.clean);
  if (broken.length) {
    console.log("\n failures\n");
    for (const result of broken) {
      console.log(`  ${result.id}${result.error ? `  (${result.error})` : ""}`);
      for (const check of result.checks.filter((item) => !item.ok)) {
        console.log(
          `    ${check.critical ? "!" : "-"} ${check.label}${check.detail ? `: ${check.detail}` : ""}`,
        );
      }
    }
  }
}

/**
 * `--compare` is run from muscle memory with whatever path the shell tab-completed
 * — repo-root-relative, package-relative, or a bare filename. `tsx` runs with
 * cwd at `apps/agent`, so only one of those resolves directly. Try the obvious
 * places rather than crashing after the run already cost money.
 */
async function readComparePath(given: string): Promise<string> {
  const resultsDir = path.join(EVAL_WORKSPACE, "..", "results");
  const candidates = [
    given,
    path.resolve(import.meta.dirname, "..", "..", "..", given), // repo root
    path.join(resultsDir, path.basename(given)),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch {
      // try the next
    }
  }
  throw new Error(
    `--compare: could not find "${given}". Looked in the working directory, the repo root, and ${path.relative(process.cwd(), resultsDir)}/.`,
  );
}

/**
 * The reason the harness exists: two runs, one number, and an answer to
 * "did that prompt change help or not".
 */
async function compare(suite: SuiteResult, previousPath: string): Promise<void> {
  const previous = JSON.parse(await readComparePath(previousPath)) as SuiteResult;
  const before = new Map(previous.cases.map((result) => [result.id, result]));
  const paired = suite.cases.filter((result) => before.has(result.id));

  // Results recorded before `done` existed cannot be compared against results
  // recorded after it. The old headline was `works`, which every run scored
  // 100% on, so reading it as `done` would report a fabricated collapse — and
  // reading a missing `done` as false would report the same thing. Refuse.
  const staleFormat = previous.cases.some((result) => result.done === undefined);
  if (staleFormat) {
    console.log(`
 vs ${path.basename(previousPath)} — not comparable

   That run predates the scoring fix. Its headline was \`works\`, which scored
   100% in every run ever recorded because the untouched template already
   typechecks, builds and previews. It measured the template, not the agent.

   \`done\` replaces it. There is no honest conversion between the two, so this
   run is the new baseline; compare the next one against it.`);
    return;
  }

  const fixed: string[] = [];
  const regressed: string[] = [];
  for (const result of paired) {
    const was = before.get(result.id) as CaseResult;
    if (result.done && !was.done) fixed.push(result.id);
    if (!result.done && was.done) regressed.push(result.id);
  }

  const doneNow = suite.cases.filter((r) => r.done).length;
  const doneBefore = previous.cases.filter((r) => r.done).length;

  // Cost and effort are measured during the turn, before any check runs, so
  // these stay comparable even across a change to the checks themselves —
  // which is exactly when you most want a number you can still trust.
  const sum = (rows: CaseResult[], pick: (r: CaseResult) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  const wasPaired = paired.map((r) => before.get(r.id) as CaseResult);

  const roundsBefore = sum(wasPaired, (r) => r.rounds);
  const roundsAfter = sum(paired, (r) => r.rounds);
  // Total prompt size, not the uncached remainder — `tokensIn` alone falls ~90%
  // the day conversation caching ships while the real request is unchanged, and
  // `--compare` would report that as the biggest win in the project's history.
  // Results recorded before the cache fields existed coalesce to `tokensIn`.
  const tokensBefore = sum(wasPaired, promptTokensOf);
  const tokensAfter = sum(paired, promptTokensOf);
  const costBefore = sum(wasPaired, (r) => estimateCostUsd(previous.model, tokenCountsOf(r)) ?? 0);
  const costAfter = sum(paired, (r) => estimateCostUsd(suite.model, tokenCountsOf(r)) ?? 0);
  const timeBefore = sum(wasPaired, (r) => r.durationMs);
  const timeAfter = sum(paired, (r) => r.durationMs);

  const movers = paired
    .map((result) => ({
      id: result.id,
      from: (before.get(result.id) as CaseResult).rounds,
      to: result.rounds,
    }))
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))
    .slice(0, 5);

  console.log(`
 vs ${path.basename(previousPath)} (prompt ${previous.promptHash} → ${suite.promptHash})
   ${paired.length} case${paired.length === 1 ? "" : "s"} in both runs

   done     ${doneBefore}/${previous.cases.length} → ${doneNow}/${suite.cases.length}
   fixed    ${fixed.length ? fixed.join(", ") : "none"}
   broke    ${regressed.length ? regressed.join(", ") : "none"}

   rounds   ${roundsBefore} → ${roundsAfter}  (${delta(roundsBefore, roundsAfter)})
   tokens   ${fmt(tokensBefore)} → ${fmt(tokensAfter)} in  (${delta(tokensBefore, tokensAfter)})
   cost     ${formatUsd(costBefore || null)} → ${formatUsd(costAfter || null)}  (${delta(costBefore, costAfter)})
   wall     ${Math.round(timeBefore / 1000)}s → ${Math.round(timeAfter / 1000)}s  (${delta(timeBefore, timeAfter)})

   biggest movers (rounds)
${movers.map((m) => `     ${m.id.padEnd(22)} ${String(m.from).padStart(3)} → ${String(m.to).padStart(3)}`).join("\n")}`);
}

/** Signed percentage change, phrased so a fall reads as an improvement. */
function delta(before: number, after: number): string {
  if (before === 0) return "n/a";
  const change = Math.round(((after - before) / before) * 100);
  return change === 0 ? "no change" : `${change > 0 ? "+" : ""}${change}%`;
}

async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index] as T);
      }
    }),
  );
  return results;
}

function pct(value: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((value / total) * 100)}%`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function fmt(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

/** The four token counts summed across a run. */
function suiteTokens(cases: CaseResult[]): TokenCounts {
  return cases.reduce<TokenCounts>(
    (sum, r) => ({
      tokensIn: sum.tokensIn + r.tokensIn,
      tokensOut: sum.tokensOut + r.tokensOut,
      cacheReadTokens: sum.cacheReadTokens + r.cacheReadTokens,
      cacheCreationTokens: sum.cacheCreationTokens + r.cacheCreationTokens,
    }),
    { tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}

/** `  · 94% cached`, or nothing when the provider served nothing from cache. */
function cachedNote(counts: TokenCounts): string {
  const fraction = cachedFraction(counts);
  return fraction && fraction > 0 ? `   · ${Math.round(fraction * 100)}% cached` : "";
}

/** A CaseResult's token counts, tolerant of results saved before the cache
 * fields existed. */
function tokenCountsOf(r: CaseResult): TokenCounts {
  return {
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    cacheReadTokens: r.cacheReadTokens ?? 0,
    cacheCreationTokens: r.cacheCreationTokens ?? 0,
  };
}

function promptTokensOf(r: CaseResult): number {
  return totalPromptTokens(tokenCountsOf(r));
}

function suiteCostUsd(suite: SuiteResult): number | null {
  let total = 0;
  for (const result of suite.cases) {
    const cost = estimateCostUsd(suite.model, tokenCountsOf(result));
    if (cost === null) return null; // no rate for this model → no honest figure
    total += cost;
  }
  return total;
}

function costCaveat(model: string): string {
  return estimateCostUsd(model, {
    tokensIn: 1,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }) === null
    ? `   (no rate for ${model} — see evals/rates.ts)`
    : "   (est., evals/rates.ts)";
}
