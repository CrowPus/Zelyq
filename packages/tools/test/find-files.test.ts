import assert from "node:assert/strict";
import { test } from "node:test";
import { globToRegExp } from "../src/files.js";
import { executeTool } from "../src/index.js";
import type { ToolContext } from "../src/types.js";

test("globToRegExp — ** crosses directories, * stays in a segment", () => {
  const tsx = globToRegExp("**/*.test.tsx");
  assert.ok(tsx.test("src/components/Button.test.tsx"));
  assert.ok(tsx.test("a.test.tsx"));
  assert.ok(!tsx.test("src/Button.tsx"));

  const button = globToRegExp("**/Button*");
  assert.ok(button.test("src/ui/Button.tsx"));
  assert.ok(button.test("Button.stories.tsx"));
  assert.ok(!button.test("src/ui/IconButton.tsx"));

  // A bare name with no slash matches anywhere.
  assert.ok(globToRegExp("vite.config.ts").test("packages/web/vite.config.ts"));

  // Brace alternation.
  const cfg = globToRegExp("vite.config.{ts,js}");
  assert.ok(cfg.test("vite.config.ts"));
  assert.ok(cfg.test("vite.config.js"));
  assert.ok(!cfg.test("vite.config.mjs"));

  // A dot is a literal, not "any char".
  assert.ok(!globToRegExp("**/a.tsx").test("src/axtsx"));
});

function ctx(files: { path: string; modifiedAt?: string }[]): ToolContext {
  return {
    projectId: "prj_test",
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
    runtime: {
      kind: "local",
      listFiles: async () =>
        files.map((f) => ({
          path: f.path,
          name: f.path.split("/").pop() ?? f.path,
          type: "file",
          size: 10,
          modifiedAt: f.modifiedAt,
        })),
      // gitIgnored swallows a failed exec and treats nothing as ignored.
      exec: async () => ({ exitCode: 1, stdout: "", stderr: "", durationMs: 1, timedOut: false }),
    } as unknown as ToolContext["runtime"],
  };
}

test("find_files returns matches newest first", async () => {
  const result = await executeTool(
    ctx([
      { path: "src/Old.tsx", modifiedAt: "2026-01-01T00:00:00.000Z" },
      { path: "src/New.tsx", modifiedAt: "2026-09-01T00:00:00.000Z" },
      { path: "src/notes.md", modifiedAt: "2026-09-02T00:00:00.000Z" },
    ]),
    "find_files",
    { pattern: "**/*.tsx" },
  );
  assert.equal(result.isError, undefined);
  const lines = result.output.split("\n").map((l) => l.split("  ")[0]);
  assert.deepEqual(lines, ["src/New.tsx", "src/Old.tsx"]);
});

test("find_files reports nothing rather than erroring on no match", async () => {
  const result = await executeTool(ctx([{ path: "src/App.tsx" }]), "find_files", {
    pattern: "**/*.py",
  });
  assert.match(result.output, /No files match/);
});

test("find_files caps and says so", async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    path: `src/c${i}.tsx`,
    modifiedAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const result = await executeTool(ctx(many), "find_files", {
    pattern: "**/*.tsx",
    max_results: 5,
  });
  assert.match(result.output, /showing the 5 newest of 30/);
});
