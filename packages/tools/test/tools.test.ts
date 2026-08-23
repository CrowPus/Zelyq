import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LocalRuntimeDriver } from "@zelyq/runtime";
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

test("list_files hides what the project's .gitignore hides", async () => {
  // A real repository carries build output, environment files and vendor
  // directories that git already knows to ignore. Showing them to the agent
  // wastes the context it needs for the work, and some of them are secrets.
  const workspace = path.join(os.tmpdir(), `zelyq-tools-ignore-${Date.now()}`);
  const runtime = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir: workspace,
    execTimeoutMs: 30_000,
    previewPortRange: [4901, 4904],
    previewHost: "127.0.0.1",
  });

  try {
    await runtime.ensureProject("prj_ignore");
    await runtime.scaffold("prj_ignore", [
      { path: ".gitignore", content: "secrets.env\nbuilt/\n" },
      { path: "README.md", content: "# real project\n" },
      { path: "src/index.js", content: "console.log(1);\n" },
      { path: "secrets.env", content: "TOKEN=should-never-be-listed\n" },
      { path: "built/output.js", content: "// generated\n" },
    ]);
    await runtime.exec("prj_ignore", {
      command:
        "git init --quiet && git add -A && git -c user.email=t@e.com -c user.name=T commit --quiet -m init",
    });

    const listing = await executeTool(
      {
        projectId: "prj_ignore",
        runtime,
        signal: new AbortController().signal,
        onFileChanged: () => undefined,
        log: () => undefined,
      },
      "list_files",
      {},
    );

    assert.ok(listing.output.includes("README.md"), "the project's own files must still be listed");
    assert.ok(
      !listing.output.includes("secrets.env"),
      `an ignored file was shown to the agent:\n${listing.output}`,
    );
    assert.ok(
      !listing.output.includes("built/output.js"),
      `an ignored directory was shown to the agent:\n${listing.output}`,
    );
  } finally {
    await runtime.dispose();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("commands that destroy work the snapshot cannot restore are refused", async () => {
  // A turn is undoable because a snapshot is taken before it, and snapshots do
  // not contain .git. Anything the agent does through git is therefore outside
  // the one safety net the user has been promised.
  const destructive = [
    "git reset --hard HEAD~3",
    "git clean -fdx",
    "git checkout --force main",
    "git push origin main",
    "git branch -D feature",
    "rm -rf .git",
  ];

  for (const command of destructive) {
    const result = await executeTool(stubContext(), "run_command", { command });
    assert.equal(result.isError, true, `${command} should have been refused`);
    assert.match(result.output, /destroy work/i, `${command}: ${result.output}`);
  }
});

test("ordinary git commands still work", async () => {
  // Refusing too much is its own failure: the agent needs to read the repository
  // it is working in.
  const harmless = ["git status", "git log --oneline -5", "git diff", "git branch --list"];

  // The stub reports a clean exit so the only thing under test is the guard,
  // not whether the command would have worked.
  const context = stubContext({
    exec: async () => ({
      exitCode: 0,
      stdout: "on branch main",
      stderr: "",
      durationMs: 1,
      timedOut: false,
      truncated: false,
    }),
  } as never);

  for (const command of harmless) {
    const result = await executeTool(context, "run_command", { command });
    assert.notEqual(result.isError, true, `${command} should not have been refused`);
    assert.ok(
      !/destroy work/i.test(result.output),
      `${command} was refused by a guard: ${result.output}`,
    );
  }
});
