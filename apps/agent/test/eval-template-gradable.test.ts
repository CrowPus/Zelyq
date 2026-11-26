import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CASES } from "../evals/cases.js";
import { runCheck, stripComments } from "../evals/checks.js";
import type { Check, EvalCase } from "../evals/types.js";
import { loadTemplateFiles, type ProjectFingerprint, packageNames } from "../evals/workspace.js";

/**
 * A case is only a measurement if the untouched starting project can be
 * graded fairly: nothing may fail before the agent has done anything, and
 * nothing may pass on words alone.
 *
 * Both went wrong before. The dependency check kept its own list of allowed
 * packages; when the template gained clsx, lucide-react and tailwind-merge,
 * six cases failed whatever the agent did. And one appended comment naming the
 * features passed the content checks of nine cases that were not done.
 */

const BROWSER_KINDS = new Set(["typecheck", "build", "preview", "renders", "flow"]);

async function startingProject(evalCase: EvalCase): Promise<Map<string, string>> {
  const files = await loadTemplateFiles("vite-react", {
    projectName: evalCase.title,
    projectSlug: evalCase.id,
    projectId: "prj_eval",
  });
  const project = new Map<string, string>();
  for (const file of [...files, ...(evalCase.setup ?? [])]) {
    project.set(file.path, String(file.content));
  }
  return project;
}

function fingerprintOf(project: Map<string, string>): ProjectFingerprint {
  const packageJson = project.get("package.json");
  return {
    files: new Map(project),
    ...(packageJson ? { packages: packageNames(packageJson) } : {}),
  };
}

async function grade(
  evalCase: EvalCase,
  before: Map<string, string>,
  after: Map<string, string>,
): Promise<Array<{ check: Check; ok: boolean }>> {
  const runtime = {
    readFile: async (_projectId: string, path: string) => {
      const content = after.get(path);
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return { path, content, encoding: "utf8", truncated: false };
    },
  };
  const changed = [...after.keys()].filter((path) => after.get(path) !== before.get(path));
  const context = {
    runtime: runtime as never,
    projectId: "prj_eval",
    before: fingerprintOf(before),
    after: fingerprintOf(after),
    changed,
    toolCalls: changed.length ? 1 : 0,
    reply: "",
  };
  const results: Array<{ check: Check; ok: boolean }> = [];
  for (const check of evalCase.checks) {
    // The build and browser checks need a real project on disk; they are
    // covered by the harness's own render-check tests.
    if (BROWSER_KINDS.has(check.kind)) continue;
    results.push({ check, ok: (await runCheck(check, context)).ok });
  }
  return results;
}

describe("every eval case can be graded fairly from its starting project", () => {
  it("no case fails its dependency check before the agent has done anything", async () => {
    const impossible: string[] = [];
    for (const evalCase of CASES) {
      const start = await startingProject(evalCase);
      for (const { check, ok } of await grade(evalCase, start, start)) {
        if (check.kind === "no_new_dependency" && !ok) impossible.push(evalCase.id);
      }
    }
    assert.deepEqual(impossible, []);
  });

  it("a new package is still caught", async () => {
    const evalCase = CASES.find((c) =>
      c.checks.some((check) => check.kind === "no_new_dependency"),
    );
    assert.ok(evalCase);
    const start = await startingProject(evalCase);
    const after = new Map(start);
    const manifest = JSON.parse(start.get("package.json") ?? "{}");
    manifest.dependencies = { ...manifest.dependencies, "left-pad": "^1.3.0" };
    after.set("package.json", JSON.stringify(manifest));
    const dependency = (await grade(evalCase, start, after)).find(
      (r) => r.check.kind === "no_new_dependency",
    );
    assert.equal(dependency?.ok, false);
  });

  it("a comment naming the features does not pass a case's content checks", async () => {
    // Every word the content checks of the original nine fooled cases look for.
    const stub =
      "\n/* Marginal <footer sm: md: localStorage useState annual Annual /mo $ <button <nav <aside " +
      'grid flex <label error aria-label aria-modal role="dialog" Escape "dark" dark: react-router ' +
      "Router length === 0 empty No orders VITE_ import.meta.env Copied navigator.clipboard " +
      "TestimonialCard map( process.env focus() */\n";
    const fooled: string[] = [];
    for (const evalCase of CASES) {
      const contentChecks = evalCase.checks.filter(
        (check) =>
          (check.kind === "project_matches" || check.kind === "file_matches") &&
          (check.expect ?? "present") === "present" &&
          !check.cosmetic,
      );
      if (contentChecks.length === 0) continue;
      const start = await startingProject(evalCase);
      // A case whose content checks already pass on the untouched project is
      // measured by its other checks; it is not what this test is about.
      const untouched = await grade(evalCase, start, start);
      if (contentChecks.every((check) => untouched.find((r) => r.check === check)?.ok)) continue;
      const after = new Map(start);
      after.set("src/App.tsx", `${start.get("src/App.tsx") ?? ""}${stub}`);
      const graded = await grade(evalCase, start, after);
      if (contentChecks.every((check) => graded.find((r) => r.check === check)?.ok)) {
        fooled.push(evalCase.id);
      }
    }
    assert.deepEqual(fooled, []);
  });
});

describe("stripComments", () => {
  it("removes block, line, JSX and HTML comments", () => {
    const tsx = "const a = 1; // footer\n/* <footer> */\nreturn <div>{/* <nav> */}</div>;";
    const out = stripComments(tsx, "src/App.tsx");
    assert.doesNotMatch(out, /footer|<nav>/);
    assert.match(out, /const a = 1;/);
    assert.doesNotMatch(stripComments("<!-- <footer> --><p>x</p>", "index.html"), /footer/);
  });

  it("keeps URLs inside strings", () => {
    const out = stripComments('const u = "https://example.com/a";', "src/api.ts");
    assert.match(out, /https:\/\/example\.com\/a/);
  });
});
