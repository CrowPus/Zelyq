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
  assert.equal(tools.length, 25);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 25);
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
      "fetch_reference_image",
      "inspect_image_asset",
      "resize_image_asset",
      "optimize_image_asset",
      "generate_placeholder_asset",
    ],
  );
});

// fetch_reference_image — searched, downloaded, shown-back photo; a labelled
// placeholder (never a silent guess) when no provider is reachable.

const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

/** A context whose exec() is scripted: `search` handles the JSON search
 *  call, `download` handles the `curl --output` call. Files written by
 *  download or by the placeholder fallback are readable back as base64. */
function imageContext({ search, downloadWrites = JPEG_BYTES, env = {} } = {}) {
  const files = {};
  const changed = [];
  const commands = [];
  return {
    changed,
    commands,
    files,
    prevEnv: null,
    applyEnv() {
      this.prevEnv = { ...process.env };
      for (const k of ["ZELYQ_IMAGE_PROVIDER", "ZELYQ_IMAGE_PROVIDER_KEY"]) delete process.env[k];
      Object.assign(process.env, env);
    },
    restoreEnv() {
      if (this.prevEnv) process.env = this.prevEnv;
    },
    value: {
      projectId: "p1",
      signal: new AbortController().signal,
      log() {},
      onFileChanged(p) {
        changed.push(p);
      },
      runtime: {
        async exec(_id, options) {
          commands.push(options.command);
          if (options.command.includes("--output ")) {
            const match = options.command.match(/--output '([^']+)'/);
            if (match && downloadWrites) files[match[1]] = Buffer.from(downloadWrites);
            return { exitCode: downloadWrites ? 0 : 7, stdout: "", stderr: "", timedOut: false };
          }
          return {
            exitCode: search?.exitCode ?? 0,
            stdout: search?.stdout ?? "{}",
            stderr: "",
            timedOut: Boolean(search?.timedOut),
          };
        },
        async readFile(_id, path) {
          if (!(path in files)) throw new Error("missing");
          const value = files[path];
          return Buffer.isBuffer(value)
            ? { encoding: "base64", content: value.toString("base64") }
            : { encoding: "utf8", content: value };
        },
        async writeFile(_id, path, content, encoding) {
          files[path] = encoding === "base64" ? Buffer.from(content, "base64") : content;
        },
      },
    },
  };
}

async function runFetch(ctx, input) {
  ctx.applyEnv();
  try {
    return await images.find((t) => t.name === "fetch_reference_image").run(ctx.value, input);
  } finally {
    ctx.restoreEnv();
  }
}

test("fetch_reference_image: an Openverse hit is downloaded and returned as an image", async () => {
  const ctx = imageContext({
    search: {
      stdout: JSON.stringify({
        results: [
          {
            url: "https://cdn.example/kyoto.jpg",
            creator: "A. Photographer",
            license: "by",
            foreign_landing_url: "https://openverse.org/i/1",
          },
        ],
      }),
    },
  });
  const result = await runFetch(ctx, {
    query: "kyoto temple",
    output_path: "src/assets/kyoto.jpg",
  });

  assert.notEqual(result.isError, true, result.output);
  assert.equal(result.images?.[0]?.mimeType, "image/jpeg");
  assert.match(result.output, /from openverse/);
  assert.match(result.output, /A\. Photographer/);
  assert.deepEqual(ctx.changed, ["src/assets/kyoto.jpg"]);
  // The search call ran before the download call.
  assert.match(ctx.commands[0], /api\.openverse\.org/);
  assert.match(ctx.commands[1], /--output 'src\/assets\/kyoto\.jpg'/);
});

test("fetch_reference_image: no search results ⇒ a labelled SVG placeholder, not a guess", async () => {
  const ctx = imageContext({ search: { stdout: JSON.stringify({ results: [] }) } });
  const result = await runFetch(ctx, {
    query: "nowhere-in-particular",
    output_path: "public/hero.jpg",
  });

  assert.match(result.output, /PLACEHOLDER/);
  assert.match(result.output, /do NOT write copy that asserts/);
  assert.equal(result.images?.[0]?.mimeType, "image/svg+xml");
  // Extension swapped to .svg (an SVG served as .jpg would not render).
  assert.ok(ctx.files["public/hero.svg"], "the placeholder SVG is written");
  assert.ok(!ctx.files["public/hero.jpg"]);
  assert.deepEqual(ctx.changed, ["public/hero.svg"]);
});

test("fetch_reference_image: ZELYQ_IMAGE_PROVIDER=unsplash with no key ⇒ placeholder naming the missing key", async () => {
  const ctx = imageContext({ env: { ZELYQ_IMAGE_PROVIDER: "unsplash" } });
  const result = await runFetch(ctx, { query: "santorini", output_path: "a.png" });

  assert.match(result.output, /PLACEHOLDER/);
  assert.match(result.output, /ZELYQ_IMAGE_PROVIDER_KEY is not set/);
  assert.ok(ctx.files["a.svg"]);
  // It must not have attempted a network search with a bogus/empty key.
  assert.equal(ctx.commands.length, 0);
});

test("fetch_reference_image: a failed search (no egress) ⇒ placeholder that points at the allowlist", async () => {
  const ctx = imageContext({ search: { exitCode: 6 } });
  const result = await runFetch(ctx, { query: "amalfi coast", output_path: "b.webp" });

  assert.match(result.output, /PLACEHOLDER/);
  assert.match(result.output, /egress allowlist/i);
  assert.ok(ctx.files["b.svg"]);
});

test("fetch_reference_image: an unsplash key is passed via env, never interpolated into the command", async () => {
  const ctx = imageContext({
    env: { ZELYQ_IMAGE_PROVIDER: "unsplash", ZELYQ_IMAGE_PROVIDER_KEY: "secret-key-123" },
    search: {
      stdout: JSON.stringify({
        results: [
          {
            urls: { regular: "https://images.unsplash.com/x" },
            user: { name: "U" },
            links: { html: "https://unsplash.com/p/x" },
          },
        ],
      }),
    },
  });
  const result = await runFetch(ctx, { query: "fjord", output_path: "c.jpg" });

  assert.notEqual(result.isError, true, result.output);
  assert.doesNotMatch(
    ctx.commands[0],
    /secret-key-123/,
    "the key is never written into the shell command",
  );
  assert.match(ctx.commands[0], /Client-ID \$ZELYQ_IMAGE_PROVIDER_KEY/);
});
