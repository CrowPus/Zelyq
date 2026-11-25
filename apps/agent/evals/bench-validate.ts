/**
 * Proves each benchmark task measures the agent and not the task:
 *
 * - **start**: an agent that changes nothing must fail every hidden flow;
 * - **reference**: an agent that writes the reference solution must pass every
 *   check — typecheck, build, preview, renders and every flow.
 *
 * No model is called: a scripted stand-in plays the agent through the real
 * harness, so the grading path is exactly the one a run uses.
 *
 *   pnpm tsx evals/bench-validate.ts [--only b-todo-persist,...]
 */
import { parseArgs } from "node:util";
import { loadEnvFile } from "@zelyq/core/node";
import { createRuntimeDriver } from "@zelyq/runtime";
import { loadAgentConfig } from "../src/config.js";
import type { ModelProvider, ProviderEvent, TurnResult } from "../src/providers/index.js";
import { BENCH_CASES, type BenchCase } from "./bench.js";
import { runCase } from "./harness.js";
import { EVAL_WORKSPACE, prepareBaseProject } from "./workspace.js";

loadEnvFile();

const { values } = parseArgs({
  options: {
    only: { type: "string" },
    // On the host instead of the configured runtime: lighter, for a quick check.
    local: { type: "boolean", default: false },
  },
});
const wanted = values.only ? new Set(values.only.split(",").map((id) => id.trim())) : null;
const cases = BENCH_CASES.filter((c) => !wanted || wanted.has(c.id));

type Step = { events: ProviderEvent[]; result: TurnResult };
const usage = { inputTokens: 0, outputTokens: 0 };

/** Writes the given files, one call each, then stops. */
function scripted(files: BenchCase["reference"]) {
  const steps: Step[] = [
    ...files.map(
      (file, i): Step => ({
        events: [],
        result: {
          toolCalls: [
            {
              id: `ref${i}`,
              name: "write_file",
              input: { path: file.path, content: String(file.content) },
            },
          ],
          stopReason: "tool_use",
          usage,
        },
      }),
    ),
    {
      events: [{ type: "text", text: "Done." }],
      result: { toolCalls: [], stopReason: "end_turn", usage },
    },
  ];
  return () => {
    let i = 0;
    return {
      id: "anthropic",
      model: "scripted",
      createConversation: () => ({
        addUserMessage: () => undefined,
        addToolResults: () => undefined,
        async *stream() {
          const step = steps[Math.min(i++, steps.length - 1)] as Step;
          for (const event of step.events) yield event;
          return step.result;
        },
      }),
    } as unknown as ModelProvider;
  };
}

const config = await loadAgentConfig();
const runtime = createRuntimeDriver({
  ...config.runtime,
  ...(values.local ? { kind: "local" as const } : {}),
  workspaceDir: EVAL_WORKSPACE,
});
const log = (message: string): void => console.log(`  ${message}`);
const baseRoot = await prepareBaseProject(runtime, "vite-react", log);

const problems: string[] = [];
for (const benchCase of cases) {
  for (const mode of ["start", "reference"] as const) {
    const result = await runCase(benchCase, {
      runtime,
      baseRoot,
      template: "vite-react",
      provider: "anthropic",
      model: "scripted",
      effort: "high",
      apiKey: "scripted",
      maxIterations: 20,
      timeoutMs: 240_000,
      keep: false,
      log: () => undefined,
      providerFactory: scripted(mode === "start" ? [] : benchCase.reference),
    });
    const flows = result.checks.filter((c) => c.label.startsWith("a person can"));
    const failed = result.checks.filter((c) => !c.ok && c.label !== "changed something");
    let verdict: string;
    if (mode === "start") {
      const passing = flows.filter((c) => c.ok);
      verdict = passing.length
        ? `PROBLEM: the untouched start passes ${passing.map((c) => c.label).join(", ")}`
        : `ok — all ${flows.length} flow(s) fail`;
    } else {
      verdict = failed.length
        ? `PROBLEM: the reference fails ${failed.map((c) => `${c.label} (${c.detail})`).join("; ")}`
        : `ok — ${result.checks.length} checks pass`;
    }
    if (verdict.startsWith("PROBLEM")) problems.push(`${benchCase.id} ${mode}: ${verdict}`);
    console.log(` ${benchCase.id.padEnd(26)} ${mode.padEnd(9)} ${verdict}`);
  }
}

await runtime.dispose();
console.log(problems.length ? `\n${problems.length} problem(s).` : "\nEvery task is sound.");
process.exit(problems.length ? 1 : 0);
