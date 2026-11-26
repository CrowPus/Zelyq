import assert from "node:assert/strict";
import { test } from "node:test";
import { BENCH_CASES } from "../evals/bench.js";
import { selectCases } from "../evals/cases.js";

/**
 * The benchmark tasks are well formed. Whether each one actually separates a
 * working app from a broken one is proven by `evals/bench-validate.ts`, which
 * needs a real preview and so runs outside the unit tests.
 */

test("every task has a unique id, a hidden flow and the working-project checks", () => {
  const ids = BENCH_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const benchCase of BENCH_CASES) {
    const kinds = benchCase.checks.map((c) => c.kind);
    assert.ok(kinds.includes("flow"), `${benchCase.id} has no flow`);
    for (const kind of ["typecheck", "build", "preview"] as const) {
      assert.ok(kinds.includes(kind), `${benchCase.id} lacks ${kind}`);
    }
    assert.ok(benchCase.tags.includes("bench"));
  }
});

test("every reference changes something the start does not have", () => {
  for (const benchCase of BENCH_CASES) {
    assert.ok(benchCase.reference.length > 0, benchCase.id);
    for (const file of benchCase.reference) {
      const start = benchCase.setup?.find((s) => s.path === file.path);
      assert.notEqual(String(file.content), String(start?.content ?? ""), benchCase.id);
    }
  }
});

test("--suite bench selects the tasks, and the default selects the eval cases", () => {
  assert.deepEqual(
    selectCases({ suite: "bench" }).map((c) => c.id),
    BENCH_CASES.map((c) => c.id),
  );
  assert.ok(selectCases({}).every((c) => !c.id.startsWith("b-")));
});
