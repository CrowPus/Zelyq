import assert from "node:assert/strict";
import { test } from "node:test";
import { executeTool, PLAN_FILE } from "../src/index.js";
import type { ToolContext } from "../src/types.js";

function ctx(): { context: ToolContext; written: Map<string, string>; changed: string[] } {
  const written = new Map<string, string>();
  const changed: string[] = [];
  const context = {
    projectId: "prj_test",
    signal: new AbortController().signal,
    onFileChanged: (path: string) => changed.push(path),
    log: () => undefined,
    runtime: {
      kind: "local",
      writeFile: async (_id: string, path: string, content: string) => {
        written.set(path, content);
      },
    } as unknown as ToolContext["runtime"],
  };
  return { context, written, changed };
}

test("update_plan writes PLAN.md as a checklist and reports progress", async () => {
  const { context, written, changed } = ctx();
  const result = await executeTool(context, "update_plan", {
    items: [
      { step: "Scaffold the route", status: "done" },
      { step: "Wire the form", status: "in_progress" },
      { step: "Add validation", status: "pending" },
    ],
  });

  assert.notEqual(result.isError, true);
  assert.deepEqual(changed, [PLAN_FILE]);

  const body = written.get(PLAN_FILE);
  assert.ok(body);
  assert.match(body, /# Plan/);
  assert.match(body, /- \[x\] Scaffold the route/);
  assert.match(body, /- \[~\] Wire the form/);
  assert.match(body, /- \[ \] Add validation/);
  assert.match(result.output, /1\/3 done/);
});

test("update_plan rejects an empty list", async () => {
  const { context } = ctx();
  const result = await executeTool(context, "update_plan", { items: [] });
  assert.equal(result.isError, true);
  assert.match(result.output, /Invalid input for update_plan/);
});
