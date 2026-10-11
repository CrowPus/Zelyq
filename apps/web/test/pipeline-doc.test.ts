import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePipelineFile } from "@zelyq/core";
import {
  editable,
  insertIn,
  moveAcross,
  moveIn,
  readFile,
  removeIn,
  replaceStep,
  setIn,
} from "../src/lib/pipeline-doc.js";

const FILE = `# Shop's pipeline — keep this comment
name: Shop
runs-on: local
source: {app: Shop}
services:                  # not shown by the visual editor
  redis: {image: redis:7, port: 6379}
stages:
  - name: Build
    steps:
      - checkout: true
      - run: npm ci        # install
  - name: Test
    steps: [{run: npm test}]
`;

test("an edit keeps comments and keys the editor does not show", () => {
  const next = setIn(FILE, ["name"], "Shop CI");
  assert.match(next, /^# Shop's pipeline — keep this comment$/m);
  assert.match(next, /# not shown by the visual editor/);
  assert.match(next, /redis: \{image: redis:7, port: 6379\}/);
  assert.match(next, /# install/);
  assert.equal(readFile(next)?.name, "Shop CI");
  assert.ok(parsePipelineFile(next).ok);
});

test("an empty value removes the key", () => {
  const withTimeout = setIn(FILE, ["timeout"], "30m");
  assert.match(withTimeout, /^timeout: 30m$/m);
  assert.doesNotMatch(setIn(withTimeout, ["timeout"], ""), /timeout/);
  assert.equal(setIn(FILE, ["nothing"], undefined), FILE);
});

test("stages and steps are added, moved and removed", () => {
  let next = insertIn(FILE, ["stages"], 1, {
    name: "Lint",
    parallel: true,
    steps: [{ run: "npm run lint" }],
  });
  let stages = readFile(next)?.stages as { name: string }[];
  assert.deepEqual(
    stages.map((stage) => stage.name),
    ["Build", "Lint", "Test"],
  );
  next = moveIn(next, ["stages"], 1, 2);
  stages = readFile(next)?.stages as { name: string }[];
  assert.deepEqual(
    stages.map((stage) => stage.name),
    ["Build", "Test", "Lint"],
  );
  next = insertIn(next, ["stages", 1, "steps"], 0, { checkout: true });
  next = insertIn(next, ["stages", 1, "steps"], 99, { run: "echo done" });
  assert.deepEqual(readFile(next)?.stages, [
    { name: "Build", steps: [{ checkout: true }, { run: "npm ci" }] },
    { name: "Test", steps: [{ checkout: true }, { run: "npm test" }, { run: "echo done" }] },
    { name: "Lint", parallel: true, steps: [{ run: "npm run lint" }] },
  ]);
  next = removeIn(next, ["stages", 2]);
  assert.equal((readFile(next)?.stages as unknown[] | undefined)?.length, 2);
  assert.ok(parsePipelineFile(next).ok);
});

test("a multi-line command is written as a block", () => {
  const next = setIn(FILE, ["stages", 0, "steps", 1, "run"], "npm ci\nnpm run build");
  assert.match(next, /run: \|-?\n\s+npm ci\n\s+npm run build/);
  const parsed = parsePipelineFile(next);
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.file.stages[0]?.steps[1]?.run, "npm ci\nnpm run build");
});

test("a step changes kind and keeps its name and condition", () => {
  const named = setIn(
    setIn(FILE, ["stages", 0, "steps", 1, "name"], "Install"),
    ["stages", 0, "steps", 1, "if"],
    "always()",
  );
  const next = replaceStep(named, ["stages", 0, "steps", 1], ["run", "checkout", "setup"], {
    setup: "node@22",
  });
  const stages = readFile(next)?.stages as { steps: Record<string, unknown>[] }[] | undefined;
  const step = stages?.[0]?.steps[1];
  assert.deepEqual(step, { name: "Install", if: "always()", setup: "node@22" });
});

test("text that is not valid YAML is never changed", () => {
  const broken = "name: [unclosed\nstages:\n";
  assert.equal(editable(broken), false);
  assert.equal(setIn(broken, ["name"], "x"), broken);
  assert.equal(insertIn(broken, ["stages"], 0, {}), broken);
  assert.equal(editable(FILE), true);
});

test("a step moves to another stage, or within its own", () => {
  let next = moveAcross(FILE, ["stages", 0, "steps"], 1, ["stages", 1, "steps"], 0);
  assert.deepEqual(readFile(next)?.stages, [
    { name: "Build", steps: [{ checkout: true }] },
    { name: "Test", steps: [{ run: "npm ci" }, { run: "npm test" }] },
  ]);
  assert.match(next, /# install/, "its comment goes with it");
  next = moveAcross(next, ["stages", 1, "steps"], 0, ["stages", 1, "steps"], 2);
  assert.deepEqual((readFile(next)?.stages as { steps: unknown[] }[] | undefined)?.[1]?.steps, [
    { run: "npm test" },
    { run: "npm ci" },
  ]);
  assert.equal(moveAcross(next, ["stages", 1, "steps"], 0, ["stages", 1, "steps"], 0), next);
  assert.ok(parsePipelineFile(next).ok);
});
