import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadEnvFile } from "@zelyq/core/node";
import { createRuntimeDriver } from "@zelyq/runtime";
import { loadAgentConfig } from "../src/config.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { PROVIDERS } from "../src/providers/index.js";
import { selectCases } from "./cases.js";
import { runCase } from "./harness.js";
import type { CaseResult, SuiteResult } from "./types.js";
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

const config = loadAgentConfig();

if (!config.apiKey) {
  const info = PROVIDERS[config.provider];
  console.error(
    `No API key. Set ${info.apiKeyEnv.join(" or ")} in .env — see ${info.docsUrl}.\n` +
      "Evals call the real model; there is nothing to measure without one.",
  );
  process.exit(1);
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
  `\n${cases.length} case${cases.length === 1 ? "" : "s"} · ${config.provider}/${config.model} · effort ${config.effort}\n`,
);

const baseRoot = await prepareBaseProject(runtime, values.template, log);

const started = Date.now();
const results = await pool(cases, Number.parseInt(values.concurrency, 10), async (evalCase) => {
  const result = await runCase(evalCase, {
    runtime,
    baseRoot,
    template: values.template,
    provider: config.provider,
    model: config.model,
    effort: config.effort,
    apiKey: config.apiKey as string,
    maxIterations: config.maxTurnIterations,
    timeoutMs: Number.parseInt(values.timeout, 10) * 1000,
    keep: values.keep,
    log,
  });
  console.log(line(result));
  return result;
});

await runtime.dispose();

const suite: SuiteResult = {
  startedAt: new Date(started).toISOString(),
  provider: config.provider,
  model: config.model,
  effort: config.effort,
  promptHash: createHash("sha256")
    .update(buildSystemPrompt({ projectName: "x", template: values.template }))
    .digest("hex")
    .slice(0, 12),
  cases: results,
};

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

if (values.compare) await compare(suite, values.compare);

// A red suite must fail CI once this is wired in.
process.exit(results.every((result) => result.works) ? 0 : 1);

// ---------------------------------------------------------------------------

function line(result: CaseResult): string {
  const failed = result.checks.filter((check) => !check.ok);
  const mark = result.clean ? "✓" : result.works ? "~" : "✗";
  const detail = result.error
    ? result.error
    : failed.length
      ? failed.map((check) => check.label).join(", ")
      : "";
  return [
    ` ${mark} ${result.id.padEnd(22)}`,
    `${String(result.rounds).padStart(2)} rounds`,
    `${String(result.toolCalls).padStart(3)} tools`,
    `${String(Math.round(result.durationMs / 1000)).padStart(4)}s`,
    detail && ` — ${detail}`,
  ]
    .filter(Boolean)
    .join("  ");
}

function report(suite: SuiteResult, elapsedMs: number): void {
  const total = suite.cases.length;
  const works = suite.cases.filter((result) => result.works).length;
  const clean = suite.cases.filter((result) => result.clean).length;
  const checks = suite.cases.flatMap((result) => result.checks);
  const passed = checks.filter((check) => check.ok).length;

  console.log(`
─────────────────────────────────────────────
 works    ${works}/${total}  (${pct(works, total)})   every critical check passed
 clean    ${clean}/${total}  (${pct(clean, total)})   every check passed
 checks   ${passed}/${checks.length}  (${pct(passed, checks.length)})

 rounds   median ${median(suite.cases.map((r) => r.rounds))}
 tools    median ${median(suite.cases.map((r) => r.toolCalls))}   ${suite.cases.reduce((sum, r) => sum + r.toolErrors, 0)} tool errors total
 tokens   ${fmt(suite.cases.reduce((sum, r) => sum + r.tokensIn, 0))} in · ${fmt(suite.cases.reduce((sum, r) => sum + r.tokensOut, 0))} out
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
 * The reason the harness exists: two runs, one number, and an answer to
 * "did that prompt change help or not".
 */
async function compare(suite: SuiteResult, previousPath: string): Promise<void> {
  const previous = JSON.parse(await fs.readFile(previousPath, "utf8")) as SuiteResult;
  const before = new Map(previous.cases.map((result) => [result.id, result]));

  const fixed: string[] = [];
  const regressed: string[] = [];
  for (const result of suite.cases) {
    const was = before.get(result.id);
    if (!was) continue;
    if (result.works && !was.works) fixed.push(result.id);
    if (!result.works && was.works) regressed.push(result.id);
  }

  const worksNow = suite.cases.filter((r) => r.works).length;
  const worksBefore = previous.cases.filter((r) => r.works).length;

  console.log(`
 vs ${path.basename(previousPath)} (prompt ${previous.promptHash} → ${suite.promptHash})
   works    ${worksBefore}/${previous.cases.length} → ${worksNow}/${suite.cases.length}
   fixed    ${fixed.length ? fixed.join(", ") : "none"}
   broke    ${regressed.length ? regressed.join(", ") : "none"}`);
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
