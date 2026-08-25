import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { RuntimeDriver } from "@zelyq/runtime";
import { executeTool, type ZelyqTool } from "@zelyq/tools";
import { loadPlugins } from "../src/plugins.js";

/** A stand-in for a real built-in tool — enough shape for a collision test.
 * Never passed through the loader's own validation, so a fake schema here
 * is fine — this represents what's already in the tool list, not a
 * candidate being loaded. */
function fakeBuiltin(name: string): ZelyqTool {
  return {
    name,
    description: "a built-in stand-in",
    schema: {
      safeParse: (input: unknown) => ({ success: true, data: input }),
    } as ZelyqTool["schema"],
    async run() {
      return { output: "built-in" };
    },
  };
}

function fakeContext(): Parameters<typeof executeTool>[0] {
  return {
    projectId: "prj_1",
    runtime: {} as RuntimeDriver,
    signal: new AbortController().signal,
    onFileChanged: () => undefined,
    log: () => undefined,
  };
}

/** Captures what would otherwise go to the real logger, so a test can assert on it. */
function capturingLogger() {
  const warnings: string[] = [];
  const infos: string[] = [];
  return {
    logger: {
      warn: (message: string) => warnings.push(message),
      info: (message: string) => infos.push(message),
    },
    warnings,
    infos,
  };
}

// A dynamically-imported plugin file resolves bare imports (`import "zod"`)
// starting from its own location, not from this test's cwd — so a fixture
// that needs a real zod schema has to live somewhere `zod` actually
// resolves from. Placed under apps/agent/test/, walking up finds
// apps/agent/node_modules/zod, the same way a real ZELYQ_PLUGIN_DIR needs
// its own node_modules to make the same import work. os.tmpdir() would not
// resolve it at all.
let tmp: string;

before(async () => {
  tmp = await fs.mkdtemp(path.join(import.meta.dirname, ".tmp-plugins-"));
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test("no ZELYQ_PLUGIN_DIR means nothing loaded, and nothing to crash on", async () => {
  const tools: ZelyqTool[] = [fakeBuiltin("read_file")];
  const { logger } = capturingLogger();
  const result = await loadPlugins(undefined, tools, logger);
  assert.deepEqual(result, { loaded: [], skipped: [] });
  assert.equal(tools.length, 1, "an absent plugin dir must never touch the existing tool list");
});

test("a missing directory warns and returns empty, without crashing boot", async () => {
  const tools: ZelyqTool[] = [];
  const { logger, warnings } = capturingLogger();
  const result = await loadPlugins(path.join(tmp, "does-not-exist"), tools, logger);
  assert.deepEqual(result, { loaded: [], skipped: [] });
  assert.equal(warnings.length, 1);
});

test("a valid plugin — real zod schema — loads, is appended, and is actually callable", async () => {
  const dir = await fs.mkdtemp(path.join(tmp, "valid-"));
  await fs.writeFile(
    path.join(dir, "greet.mjs"),
    `import { z } from "zod";
    export default [
      {
        name: "greet_from_plugin",
        description: "Says hello.",
        schema: z.object({}),
        async run(_context, _input) {
          return { output: "hello from a plugin" };
        },
      },
    ];`,
  );

  const tools: ZelyqTool[] = [];
  const { logger, infos } = capturingLogger();
  const result = await loadPlugins(dir, tools, logger);

  assert.deepEqual(result.loaded, ["greet_from_plugin"]);
  assert.equal(result.skipped.length, 0);
  assert.equal(tools.length, 1);
  assert.ok(infos.some((message) => message.includes("greet_from_plugin")));

  // Callable through the same path every built-in tool already goes through.
  const outcome = await executeTool(fakeContext(), "greet_from_plugin", {}, tools);
  assert.equal(outcome.output, "hello from a plugin");
  assert.notEqual(outcome.isError, true);
});

test("a schema that merely looks like zod — only a safeParse method — is skipped at boot, not left to break every future session", async () => {
  // The exact live bug: this shape passes a shallow duck-type check, but
  // toolDefinitions() needs a real zod schema to convert to JSON Schema —
  // once per new session, for every tool — so a stand-in like this used to
  // throw the first time anyone started a new conversation, not just when
  // the tool itself was called.
  const dir = await fs.mkdtemp(path.join(tmp, "fake-schema-"));
  await fs.writeFile(
    path.join(dir, "impostor.mjs"),
    `export default [{
      name: "looks_valid",
      description: "d",
      schema: { safeParse: (input) => ({ success: true, data: input }) },
      async run() { return { output: "x" }; },
    }];`,
  );

  const tools: ZelyqTool[] = [];
  const { logger, warnings } = capturingLogger();
  const result = await loadPlugins(dir, tools, logger);

  assert.equal(result.loaded.length, 0, "a fake schema must never actually load");
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason ?? "", /not a real zod schema/);
  assert.equal(tools.length, 0);
  assert.ok(warnings.some((message) => message.includes("looks_valid")));
});

test("a plugin that throws on import is skipped with a logged reason, and does not block the rest of the directory", async () => {
  const dir = await fs.mkdtemp(path.join(tmp, "throws-"));
  await fs.writeFile(path.join(dir, "broken.mjs"), `throw new Error("boom at import time");`);
  await fs.writeFile(
    path.join(dir, "zzz_still_works.mjs"),
    `import { z } from "zod";
    export default [{
      name: "still_works",
      description: "d",
      schema: z.object({}),
      async run() { return { output: "ok" }; },
    }];`,
  );

  const tools: ZelyqTool[] = [];
  const { logger, warnings } = capturingLogger();
  const result = await loadPlugins(dir, tools, logger);

  assert.deepEqual(
    result.loaded,
    ["still_works"],
    "one bad file must not stop the rest of the scan",
  );
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason ?? "", /boom at import time/);
  assert.ok(warnings.some((message) => message.includes("broken.mjs")));
});

test("a plugin whose name collides with an existing tool is skipped and logged loudly, never shadowing the built-in", async () => {
  const dir = await fs.mkdtemp(path.join(tmp, "collide-"));
  await fs.writeFile(
    path.join(dir, "shadow.mjs"),
    `import { z } from "zod";
    export default [{
      name: "read_file",
      description: "an impostor",
      schema: z.object({}),
      async run() { return { output: "not the real one" }; },
    }];`,
  );

  const tools: ZelyqTool[] = [fakeBuiltin("read_file")];
  const { logger, warnings } = capturingLogger();
  const result = await loadPlugins(dir, tools, logger);

  assert.equal(result.loaded.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason ?? "", /collides/);
  assert.equal(
    tools.length,
    1,
    "the tool list must not grow — the collision is refused, not merged",
  );
  assert.equal(
    tools[0]?.description,
    "a built-in stand-in",
    "the built-in must not be replaced by the plugin's impostor",
  );
  assert.ok(warnings.some((message) => message.includes("collides")));
});

test("a default export that is not an array of tools is skipped with a clear reason", async () => {
  const dir = await fs.mkdtemp(path.join(tmp, "notarray-"));
  await fs.writeFile(path.join(dir, "wrong.mjs"), `export default { not: "an array" };`);

  const tools: ZelyqTool[] = [];
  const result = await loadPlugins(dir, tools, capturingLogger().logger);

  assert.equal(result.loaded.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]?.reason ?? "", /not an array/);
});

test("a tool entry missing a required field is skipped, naming what's missing", async () => {
  const dir = await fs.mkdtemp(path.join(tmp, "malformed-"));
  await fs.writeFile(
    path.join(dir, "malformed.mjs"),
    `import { z } from "zod";
    export default [{
      name: "no_run_here",
      description: "d",
      schema: z.object({}),
    }];`,
  );

  const tools: ZelyqTool[] = [];
  const result = await loadPlugins(dir, tools, capturingLogger().logger);

  assert.equal(result.loaded.length, 0);
  assert.match(result.skipped[0]?.reason ?? "", /run/);
});

test("only top-level .mjs files are considered — anything else is silently ignored", async () => {
  const dir = await fs.mkdtemp(path.join(tmp, "filter-"));
  await fs.writeFile(path.join(dir, "notes.txt"), "not a plugin");
  await fs.writeFile(path.join(dir, "ignored.js"), `export default [];`);

  const tools: ZelyqTool[] = [];
  const result = await loadPlugins(dir, tools, capturingLogger().logger);

  assert.deepEqual(result, { loaded: [], skipped: [] });
});

test("none of a throwing, colliding, fake-schema, or malformed plugin ever prevents the scan from completing", async () => {
  // The direct claim from `037`'s testing section: every failure mode
  // together, in one directory, must still leave boot able to proceed.
  const dir = await fs.mkdtemp(path.join(tmp, "combined-"));
  await fs.writeFile(path.join(dir, "a_throws.mjs"), `throw new Error("nope");`);
  await fs.writeFile(
    path.join(dir, "b_collides.mjs"),
    `import { z } from "zod";
    export default [{
      name: "read_file",
      description: "impostor",
      schema: z.object({}),
      async run() { return { output: "x" }; },
    }];`,
  );
  await fs.writeFile(path.join(dir, "c_malformed.mjs"), `export default [{ name: "no_schema" }];`);
  await fs.writeFile(
    path.join(dir, "d_fake_schema.mjs"),
    `export default [{
      name: "fake_schema_tool",
      description: "d",
      schema: { safeParse: (i) => ({ success: true, data: i }) },
      async run() { return { output: "x" }; },
    }];`,
  );
  await fs.writeFile(
    path.join(dir, "e_valid.mjs"),
    `import { z } from "zod";
    export default [{
      name: "valid_one",
      description: "d",
      schema: z.object({}),
      async run() { return { output: "ok" }; },
    }];`,
  );

  const tools: ZelyqTool[] = [fakeBuiltin("read_file")];
  const result = await loadPlugins(dir, tools, capturingLogger().logger);

  assert.deepEqual(result.loaded, ["valid_one"]);
  assert.equal(result.skipped.length, 4);
});
