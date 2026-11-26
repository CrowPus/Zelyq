import assert from "node:assert/strict";
import { test } from "node:test";
import containers from "../../plugins/container-inspector.mjs";
import database from "../../plugins/database-inspector.mjs";
import deployment from "../../plugins/deployment-readiness.mjs";
import design from "../../plugins/design-system-auditor.mjs";
import docs from "../../plugins/documentation-generator.mjs";
import images from "../../plugins/image-assets.mjs";
import { z } from "../../plugins/node_modules/zod/index.js";

const bundles = [database, design, images, docs, containers, deployment];
const tools = bundles.flat();

function mockContext() {
  const changed = [];
  const commands = [];
  const content = {
    "package.json": JSON.stringify({
      name: "demo",
      scripts: {
        build: "vite build",
        start: "node server.js",
        "db:migrate": "drizzle-kit migrate",
      },
      engines: { node: ">=20" },
    }),
    ".env.example": "API_KEY=\n",
    "src/app.ts": "const key = process.env.API_KEY;",
    "src/theme.css": ":root { --brand: #112233; } .card { color: #112233; margin: 8px; }",
    Dockerfile: "FROM node:20\nWORKDIR /app\nUSER node\n",
    "openapi.json": JSON.stringify({
      info: { title: "Demo", version: "1" },
      paths: { "/ping": { get: { summary: "Ping" } } },
    }),
  };
  const entries = Object.entries(content).map(([path, value]) => ({
    path,
    type: "file",
    size: value.length,
  }));
  const runtime = {
    async readFile(_id, path) {
      if (!(path in content)) throw new Error("missing");
      return { encoding: "utf8", content: content[path] };
    },
    async writeFile(_id, path, value) {
      content[path] = value;
    },
    async listFiles(_id, options = {}) {
      return entries.filter((e) => !options.path || e.path.startsWith(`${options.path}/`));
    },
    async exec(_id, options) {
      commands.push(options.command);
      return {
        exitCode: 0,
        stdout: "[]",
        stderr: "",
        timedOut: false,
        truncated: false,
        durationMs: 1,
      };
    },
  };
  return {
    changed,
    commands,
    content,
    value: {
      projectId: "p1",
      runtime,
      signal: new AbortController().signal,
      log() {},
      onFileChanged(path) {
        changed.push(path);
      },
    },
  };
}

test("all Phase 2 tools are unique and have convertible Zod schemas", () => {
  assert.equal(tools.length, 24);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 24);
  for (const tool of tools) assert.doesNotThrow(() => z.toJSONSchema(tool.schema, { io: "input" }));
});

test("database mutations are refused before runtime execution", async () => {
  const ctx = mockContext();
  const tool = database.find((item) => item.name === "run_readonly_query");
  const result = await tool.run(ctx.value, {
    database: "data.db",
    query: "DELETE FROM users",
    limit: 10,
  });
  assert.equal(result.isError, true);
  assert.equal(ctx.commands.length, 0);
});

test("design and deployment reports use project evidence", async () => {
  const ctx = mockContext();
  const tokens = JSON.parse((await design[0].run(ctx.value, {})).output);
  const readiness = JSON.parse((await deployment[0].run(ctx.value, {})).output);
  assert.ok(tokens.cssVariables.includes("--brand"));
  assert.equal(readiness.checks.hasBuildScript, true);
});

test("documentation generation avoids existing files and reports new writes", async () => {
  const ctx = mockContext();
  const tool = docs.find((item) => item.name === "generate_project_readme");
  await tool.run(ctx.value, { output_path: "README.generated.md", overwrite: false });
  assert.deepEqual(ctx.changed, ["README.generated.md"]);
  assert.match(ctx.content["README.generated.md"], /# demo/);
  const second = await tool.run(ctx.value, {
    output_path: "README.generated.md",
    overwrite: false,
  });
  assert.equal(second.isError, true);
});

test("Dockerfile inspection reports evidence without executing Docker", async () => {
  const ctx = mockContext();
  const result = JSON.parse((await containers[0].run(ctx.value, { path: "Dockerfile" })).output);
  assert.equal(result.stages.length, 1);
  assert.equal(result.users.length, 1);
  assert.equal(ctx.commands.length, 0);
});

test("image bundle exposes the expected transformation tools", () => {
  assert.deepEqual(
    images.map((tool) => tool.name),
    [
      "inspect_image_asset",
      "resize_image_asset",
      "optimize_image_asset",
      "generate_placeholder_asset",
    ],
  );
});
