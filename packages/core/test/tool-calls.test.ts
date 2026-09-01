import assert from "node:assert/strict";
import { test } from "node:test";
import { OMITTED_TOOL_INPUT_MARKER, stripHeavyToolInputs, type ToolCall } from "../src/models.js";

const call = (name: string, input: Record<string, unknown>): ToolCall => ({
  id: `t_${name}`,
  name,
  input,
  result: "ok",
});

test("write_file content over the keep length is replaced with the marker", () => {
  const [stripped] = stripHeavyToolInputs([
    call("write_file", { path: "src/App.tsx", content: "x".repeat(5000) }),
  ]);
  assert.equal(stripped.input.path, "src/App.tsx");
  assert.equal(stripped.input.content, OMITTED_TOOL_INPUT_MARKER);
});

test("a short edit is kept inline — the saving is only in the big ones", () => {
  const original = call("edit_file", {
    path: "src/App.tsx",
    old_text: "const a = 1;",
    new_text: "const a = 2;",
  });
  const [stripped] = stripHeavyToolInputs([original]);
  assert.equal(stripped, original, "unchanged calls are returned as-is");
});

test("edit_file drops both old_text and new_text when large", () => {
  const [stripped] = stripHeavyToolInputs([
    call("edit_file", {
      path: "x",
      old_text: "a".repeat(300),
      new_text: "b".repeat(300),
    }),
  ]);
  assert.equal(stripped.input.old_text, OMITTED_TOOL_INPUT_MARKER);
  assert.equal(stripped.input.new_text, OMITTED_TOOL_INPUT_MARKER);
});

test("other tools are untouched, even with long string inputs", () => {
  const calls = [
    call("run_command", { command: `echo ${"y".repeat(5000)}` }),
    call("read_file", { path: "src/App.tsx" }),
    call("search_files", { pattern: "z".repeat(5000) }),
  ];
  assert.deepEqual(stripHeavyToolInputs(calls), calls);
});

test("result, id, name and other input keys survive", () => {
  const [stripped] = stripHeavyToolInputs([
    call("write_file", { path: "a.ts", content: "c".repeat(1000), encoding: "utf8" }),
  ]);
  assert.equal(stripped.id, "t_write_file");
  assert.equal(stripped.name, "write_file");
  assert.equal(stripped.result, "ok");
  assert.equal(stripped.input.encoding, "utf8");
});

test("is a pure copy — the input array and objects are not mutated", () => {
  const calls = [call("write_file", { path: "a", content: "d".repeat(1000) })];
  const before = JSON.stringify(calls);
  stripHeavyToolInputs(calls);
  assert.equal(JSON.stringify(calls), before);
});
