/**
 * Grades work another tool did by hand (Lovable, Bolt, v0, Cursor…) with the
 * same checks a Zelyq run faces: typecheck, build, preview, renders, and the
 * task's hidden flows.
 *
 *   pnpm tsx evals/bench-grade.ts --task b-shop-cart --tool lovable \
 *     --source https://github.com/owner/repo          (or a .zip, or a folder)
 *
 * The returned project replaces the starting one wholesale; its own
 * dependencies are installed inside the project runtime with install scripts
 * off, since it is someone else's code. A project with no `typecheck` script
 * gets one from its own tsconfig, so it is judged by its own type rules.
 * Results are saved beside Zelyq's, named after the tool. Internal use only.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { loadEnvFile } from "@zelyq/core/node";
import { createRuntimeDriver } from "@zelyq/runtime";
import { loadAgentConfig } from "../src/config.js";
import { BENCH_CASES } from "./bench.js";
import { runCase } from "./harness.js";
import type { CaseResult, SuiteResult } from "./types.js";
import { EVAL_WORKSPACE, prepareBaseProject } from "./workspace.js";

const run = promisify(execFile);
loadEnvFile();

const { values } = parseArgs({
  options: {
    task: { type: "string" },
    tool: { type: "string" },
    source: { type: "string" },
  },
});
if (!values.task || !values.tool || !values.source) {
  console.error(
    "Usage: bench-grade.ts --task <id> --tool <name> --source <git url | .zip | folder>",
  );
  process.exit(1);
}
const task = BENCH_CASES.find((c) => c.id === values.task);
if (!task) {
  console.error(`No task ${values.task}. Tasks: ${BENCH_CASES.map((c) => c.id).join(", ")}`);
  process.exit(1);
}
const source = values.source;
const tool = values.tool.replace(/[^a-z0-9._-]/gi, "-").toLowerCase();

/** The folder holding the returned project's package.json. */
async function fetchSource(): Promise<string> {
  const into = await fs.mkdtemp(path.join(os.tmpdir(), "bench-source-"));
  if (/^https?:\/\/|^git@/.test(source)) {
    try {
      await run("gh", ["repo", "clone", source, into, "--", "--depth", "1"], { timeout: 120_000 });
    } catch {
      await run("git", ["clone", "--depth", "1", source, into], { timeout: 120_000 });
    }
  } else if (source.toLowerCase().endsWith(".zip")) {
    // Python's zipfile drops absolute and ".." parts of names; no unzip needed.
    await run(
      "python3",
      [
        "-I",
        "-c",
        "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
        path.resolve(source),
        into,
      ],
      { timeout: 120_000 },
    );
  } else {
    await fs.cp(path.resolve(source), into, { recursive: true });
  }
  return await findProject(into, 3);
}

async function findProject(dir: string, depth: number): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === "package.json")) return dir;
  if (depth > 0) {
    for (const e of entries) {
      if (e.isDirectory() && !["node_modules", ".git"].includes(e.name)) {
        const found = await findProject(path.join(dir, e.name), depth - 1).catch(() => "");
        if (found) return found;
      }
    }
  }
  throw new Error(`no package.json in ${source}`);
}

const config = await loadAgentConfig();
const runtime = createRuntimeDriver({ ...config.runtime, workspaceDir: EVAL_WORKSPACE });
const baseRoot = await prepareBaseProject(runtime, "vite-react", (m) => console.log(`  ${m}`));
const projectRoot = await fetchSource();
console.log(`\n${task.id} · ${tool} · from ${projectRoot}\n`);

const startedAt = new Date().toISOString();
const result: CaseResult = await runCase(task, {
  runtime,
  baseRoot,
  template: "vite-react",
  provider: "anthropic",
  model: tool,
  effort: "high",
  apiKey: "external",
  maxIterations: 50,
  timeoutMs: 15 * 60_000,
  keep: false,
  log: () => undefined,
  externalAgent: async ({ root, projectId }) => {
    try {
      for (const entry of await fs.readdir(root)) {
        await fs.rm(path.join(root, entry), { recursive: true, force: true });
      }
      await fs.cp(projectRoot, root, {
        recursive: true,
        filter: (from) =>
          !/(^|\/)(node_modules|\.git|dist)(\/|$)/.test(path.relative(projectRoot, from)),
      });
      const pkgPath = path.join(root, "package.json");
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      if (!pkg.scripts?.typecheck) {
        const appConfig = await fs
          .access(path.join(root, "tsconfig.app.json"))
          .then(() => " -p tsconfig.app.json")
          .catch(() => "");
        pkg.scripts = { ...pkg.scripts, typecheck: `tsc --noEmit${appConfig}` };
        await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      }
      const install = await runtime.exec(projectId, {
        command: "npm install --ignore-scripts --no-audit --no-fund --loglevel=error",
        timeoutMs: 10 * 60_000,
      });
      if (install.exitCode !== 0) {
        return { reply: "", error: `npm install failed: ${install.stderr.slice(-300)}` };
      }
      return { reply: `graded ${tool}'s project` };
    } catch (error) {
      return { reply: "", error: (error as Error).message };
    }
  },
});

for (const check of result.checks) {
  console.log(
    ` ${check.ok ? "✓" : "✗"} ${check.label}${check.ok ? "" : ` — ${String(check.detail ?? "").slice(0, 200)}`}`,
  );
}
console.log(
  `\n ${result.done ? "DONE" : "NOT DONE"} · ${task.id} · ${tool}${result.error ? ` · ${result.error}` : ""}`,
);

const out = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "results",
  `${startedAt.replace(/[:.]/g, "-")}-${tool}-${task.id}.json`,
);
await fs.mkdir(path.dirname(out), { recursive: true });
const suite = {
  startedAt,
  provider: "external",
  model: tool,
  effort: "n/a",
  promptHash: "manual",
  cases: [result],
} as unknown as SuiteResult;
await fs.writeFile(out, `${JSON.stringify(suite, null, 2)}\n`);
console.log(` saved ${path.relative(process.cwd(), out)}`);
await runtime.dispose();
