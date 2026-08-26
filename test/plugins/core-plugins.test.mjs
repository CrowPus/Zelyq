import assert from "node:assert/strict";
import { test } from "node:test";
import apiTools from "../../plugins/api-tester.mjs";
import browserTools from "../../plugins/browser-qa.mjs";
import gitTools from "../../plugins/git-inspector.mjs";
import { z } from "../../plugins/node_modules/zod/index.js";
import projectTools from "../../plugins/project-intelligence.mjs";
import staticTools from "../../plugins/static-analysis.mjs";
import testTools from "../../plugins/test-intelligence.mjs";

const bundles = [projectTools, testTools, staticTools, browserTools, apiTools, gitTools];
const tools = bundles.flat();

function context(overrides = {}) {
  const files = {
    "package.json": JSON.stringify({
      packageManager: "npm@10",
      scripts: {
        test: "node --test",
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        coverage: "node --test --experimental-test-coverage",
      },
      dependencies: { zod: "1.0.0" },
      devDependencies: { vitest: "1.0.0" },
    }),
    "src/main.ts": "import './used.js';",
    "src/used.ts": "export const used = true;",
    "src/orphan.ts": "export const orphan = true;",
    "test/main.test.ts": "test('x', () => {});",
    "openapi.json": JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Demo", version: "1" },
      paths: { "/users": { get: { operationId: "listUsers" } } },
    }),
  };
  const commands = [];
  return {
    commands,
    value: {
      projectId: "p1",
      signal: new AbortController().signal,
      log() {},
      onFileChanged() {},
      runtime: {
        async listFiles(_id, options = {}) {
          return Object.keys(files)
            .filter((path) => !options.path || path.startsWith(`${options.path}/`))
            .map((path) => ({ path, type: "file", size: files[path].length }));
        },
        async readFile(_id, path) {
          if (!(path in files)) throw new Error("not found");
          return { content: files[path], encoding: "utf8" };
        },
        async exec(_id, options) {
          commands.push(options.command);
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 1,
            timedOut: false,
            truncated: false,
          };
        },
        async previewStatus() {
          return { status: "stopped" };
        },
        ...overrides,
      },
    },
  };
}

test("all six bundles export unique, loader-compatible tools", () => {
  assert.equal(bundles.length, 6);
  assert.equal(tools.length, 25);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.ok(tool.name && tool.description && typeof tool.run === "function");
    assert.doesNotThrow(() => z.toJSONSchema(tool.schema, { io: "input" }));
  }
});

test("project intelligence reads through the runtime", async () => {
  const ctx = context();
  const result = await projectTools
    .find((tool) => tool.name === "analyze_project")
    .run(ctx.value, { depth: 8 });
  const report = JSON.parse(result.output);
  assert.equal(report.fileCount, 6);
  assert.ok(report.manifests["package.json"]);
});

test("test and analysis commands use declared scripts", async () => {
  const ctx = context();
  await testTools
    .find((tool) => tool.name === "run_targeted_tests")
    .run(ctx.value, { timeout_ms: 1000, path: "test/main.test.ts" });
  await staticTools
    .find((tool) => tool.name === "lint_project")
    .run(ctx.value, { timeout_ms: 1000 });
  assert.deepEqual(ctx.commands, ["npm run test -- 'test/main.test.ts'", "npm run lint"]);
});

test("OpenAPI inspection and Git inspection are bounded and non-mutating", async () => {
  const ctx = context();
  const openapi = await apiTools
    .find((tool) => tool.name === "inspect_openapi")
    .run(ctx.value, { path: "openapi.json" });
  assert.equal(JSON.parse(openapi.output).operations[0].operationId, "listUsers");
  await gitTools.find((tool) => tool.name === "git_history").run(ctx.value, { limit: 5 });
  assert.match(ctx.commands[0], /^git log -n 5 /);
  assert.doesNotMatch(ctx.commands[0], /push|reset|checkout|clean/);
});

test("browser tools fail cleanly when preview is stopped", async () => {
  const ctx = context();
  const result = await browserTools[0].run(ctx.value, {});
  assert.equal(result.isError, true);
  assert.match(result.output, /not running/);
});
