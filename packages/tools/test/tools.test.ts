import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_TOOLS, executeTool, toolDefinitions } from "../src/index.js";
import type { ToolContext } from "../src/types.js";
import { truncate } from "../src/types.js";

function stubContext(overrides: Partial<ToolContext["runtime"]> = {}): ToolContext {
  return {
    projectId: "prj_test",
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    runtime: {
      kind: "local",
      readFile: async () => ({
        path: "a.txt",
        content: "one\ntwo\n",
        encoding: "utf8",
        truncated: false,
      }),
      writeFile: async () => undefined,
      ...overrides,
    } as unknown as ToolContext["runtime"],
  };
}

test("every tool produces a valid Messages API definition", () => {
  const definitions = toolDefinitions();
  assert.equal(definitions.length, ALL_TOOLS.length);
  for (const definition of definitions) {
    assert.match(definition.name, /^[a-z_]+$/);
    assert.ok(definition.description.length > 20, `${definition.name} needs a real description`);
    assert.equal((definition.input_schema as { type?: string }).type, "object");
  }
});

test("tool names are unique", () => {
  const names = ALL_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
});

test("invalid input comes back as a tool error, not an exception", async () => {
  const result = await executeTool(stubContext(), "read_file", { wrong: true });
  assert.equal(result.isError, true);
  assert.match(result.output, /Invalid input for read_file/);
});

test("an unknown tool is reported to the model", async () => {
  const result = await executeTool(stubContext(), "launch_missiles", {});
  assert.equal(result.isError, true);
  assert.match(result.output, /Unknown tool/);
});

test("edit_file refuses an ambiguous match instead of guessing", async () => {
  const context = stubContext({
    readFile: async () => ({
      path: "a.ts",
      content: "x = 1\nx = 1\n",
      encoding: "utf8",
      truncated: false,
    }),
  });
  const result = await executeTool(context, "edit_file", {
    path: "a.ts",
    old_text: "x = 1",
    new_text: "x = 2",
  });
  assert.equal(result.isError, true);
  assert.match(result.output, /2 matches/);
});

test("run_command refuses commands that never return", async () => {
  const result = await executeTool(stubContext(), "run_command", { command: "npm run dev" });
  assert.equal(result.isError, true);
  assert.match(result.output, /start_preview/);
});

test("a thrown runtime error becomes a tool error", async () => {
  const context = stubContext({
    readFile: async () => {
      throw new Error("disk on fire");
    },
  });
  const result = await executeTool(context, "read_file", { path: "a.txt" });
  assert.equal(result.isError, true);
  assert.match(result.output, /disk on fire/);
});

test("truncate keeps both ends and says how much it dropped", () => {
  const output = truncate("a".repeat(5000), 1000);
  assert.ok(output.length < 1200);
  assert.match(output, /characters omitted/);
});
