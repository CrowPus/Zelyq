/**
 * Runs the benchmark tasks with another coding agent's command-line tool
 * (Claude Code, Codex, Cursor's agent…) and grades the result exactly as a
 * Zelyq run is graded: same starting project, same checks, same hidden flows.
 *
 *   pnpm tsx evals/bench-external.ts --name claude-code \
 *     --command 'claude -p "$BENCH_PROMPT" --dangerously-skip-permissions --model <id>'
 *
 * The command runs in the project's folder with the task in $BENCH_PROMPT,
 * so no quoting of the prompt is needed. Whatever it prints is kept as its
 * reply. Results are written next to Zelyq's, with `provider: "external"`.
 *
 * The agent's own key and model are its own business: set them in the
 * environment the way that tool expects. Internal use only.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadEnvFile } from "@zelyq/core/node";
import { createRuntimeDriver } from "@zelyq/runtime";
import { loadAgentConfig } from "../src/config.js";
import { selectCases } from "./cases.js";
import { runCase } from "./harness.js";
import type { CaseResult, SuiteResult } from "./types.js";
import { EVAL_WORKSPACE, prepareBaseProject } from "./workspace.js";

loadEnvFile();

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    command: { type: "string" },
    only: { type: "string" },
    repeat: { type: "string", default: "1" },
    timeout: { type: "string", default: "900" },
  },
});

if (!values.name || !values.command) {
  console.error("Usage: bench-external.ts --name <agent> --command '<cli using $BENCH_PROMPT>'");
  process.exit(1);
}
const command = values.command;

/** Runs the command in the project folder; never rejects. */
function runAgent(input: { root: string; prompt: string; timeoutMs: number }) {
  return new Promise<{ reply: string; error?: string }>((resolve) => {
    const child = spawn("/bin/bash", ["-c", command], {
      cwd: input.root,
      env: { ...process.env, BENCH_PROMPT: input.prompt },
      detached: true,
    });
    let out = "";
    const keep = (chunk: Buffer) => {
      out = (out + chunk.toString("utf8")).slice(-20_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, input.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ reply: out, error: `could not start: ${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) resolve({ reply: out, error: `stopped by ${signal} (timeout?)` });
      else if (code !== 0) resolve({ reply: out, error: `exited ${code}: ${out.slice(-300)}` });
      else resolve({ reply: out });
    });
  });
}

const config = await loadAgentConfig();
const runtime = createRuntimeDriver({ ...config.runtime, workspaceDir: EVAL_WORKSPACE });
const baseRoot = await prepareBaseProject(runtime, "vite-react", (m) => console.log(`  ${m}`));

const selected = selectCases({
  suite: "bench",
  only: values.only?.split(",").map((id) => id.trim()),
});
const repeat = Math.max(1, Number.parseInt(values.repeat, 10) || 1);
const cases = Array.from({ length: repeat }, (_, n) =>
  selected.map((c) => (repeat === 1 ? c : { ...c, id: `${c.id}--r${n + 1}` })),
).flat();

console.log(`\n${cases.length} task(s) · ${values.name}\n`);
const startedAt = new Date().toISOString();
const results: CaseResult[] = [];
for (const benchCase of cases) {
  const result = await runCase(benchCase, {
    runtime,
    baseRoot,
    template: "vite-react",
    provider: "anthropic",
    model: values.name,
    effort: "high",
    apiKey: "external",
    maxIterations: 50,
    timeoutMs: Number.parseInt(values.timeout, 10) * 1000,
    keep: false,
    log: () => undefined,
    externalAgent: runAgent,
  });
  results.push(result);
  const failed = result.checks.filter((c) => !c.ok).map((c) => c.label);
  console.log(
    ` ${result.done ? "✓" : "✗"} ${result.id.padEnd(28)} ${String(Math.round(result.durationMs / 1000)).padStart(4)}s` +
      `${result.error ? `  — ${result.error.slice(0, 120)}` : failed.length ? `  — ${failed.join(", ")}` : ""}`,
  );
}

const done = results.filter((r) => r.done).length;
console.log(`\n done ${done}/${results.length}`);

const suite = {
  startedAt,
  provider: "external",
  model: values.name,
  effort: "n/a",
  promptHash: "external",
  cases: results,
} as unknown as SuiteResult;
const out = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "results",
  `${startedAt.replace(/[:.]/g, "-")}-${values.name}.json`,
);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, `${JSON.stringify(suite, null, 2)}\n`);
console.log(` saved ${path.relative(process.cwd(), out)}`);
await runtime.dispose();
