import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import { expandBraces } from "../src/files.js";
import { executeTool } from "../src/index.js";

/**
 * search_files used to say "nothing" when it was wrong: the brace glob in its
 * own description matched no file, and a broken regex or a real miss both came
 * back as an empty success. 46 of 240 stored searches returned empty.
 */

const workspace = path.join(os.tmpdir(), `zelyq-search-${Date.now()}`);
const runtime = new LocalRuntimeDriver({
  kind: "local",
  workspaceDir: workspace,
  execTimeoutMs: 30_000,
  previewPortRange: [4905, 4908],
  previewHost: "127.0.0.1",
});
const context = {
  projectId: "prj_search",
  runtime,
  signal: new AbortController().signal,
  onFileChanged: () => undefined,
  log: () => undefined,
};
const search = (input: Record<string, unknown>) => executeTool(context, "search_files", input);

before(async () => {
  await runtime.ensureProject("prj_search");
  await runtime.scaffold("prj_search", [
    { path: "src/App.tsx", content: "export function App() { return <Price />; }\n" },
    { path: "src/price.ts", content: "export const formatPrice = (n: number) => `$${n}`;\n" },
    { path: "src/style.css", content: ".price { color: red; }\n" },
    { path: "README.md", content: "--flag documented here\n" },
  ]);
});
after(async () => {
  await runtime.dispose();
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("search_files", () => {
  it("a brace glob searches every alternative", async () => {
    const result = await search({ pattern: "rice", glob: "*.{ts,tsx}" });
    assert.equal(result.isError, undefined);
    assert.match(result.output, /src\/App\.tsx/);
    assert.match(result.output, /src\/price\.ts/);
    assert.doesNotMatch(result.output, /style\.css/);
  });

  it("a real miss says so", async () => {
    const result = await search({ pattern: "nothingLikeThis" });
    assert.equal(result.isError, undefined);
    assert.match(result.output, /^No matches/);
  });

  it("an invalid pattern is an error, not an empty success", async () => {
    const result = await search({ pattern: "price(" });
    assert.equal(result.isError, true);
    assert.match(result.output, /search_files failed/);
  });

  it("a pattern starting with a dash is searched, not read as an option", async () => {
    const result = await search({ pattern: "--flag" });
    assert.match(result.output, /README\.md:1:/);
  });
});

describe("expandBraces", () => {
  it("expands one or more brace groups", () => {
    assert.deepEqual(expandBraces("*.tsx"), ["*.tsx"]);
    assert.deepEqual(expandBraces("*.{ts,tsx}"), ["*.ts", "*.tsx"]);
    assert.deepEqual(expandBraces("{a,b}.{x,y}"), ["a.x", "a.y", "b.x", "b.y"]);
  });
});
