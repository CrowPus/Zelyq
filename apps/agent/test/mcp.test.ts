import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { ALL_TOOLS, executeTool, toolDefinitions } from "@zelyq/tools";
import { loadMcpServers, mcpToolName, readMcpConfig, toZelyqTool } from "../src/mcp.js";

/**
 * Run against a real MCP server over a real stdio transport
 * (`fixtures/mcp-demo-server.mjs`): a mocked transport would only prove the
 * mock matches the mock.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const silent = { info: () => undefined, warn: () => undefined };

/**
 * Configs are written per-run rather than committed: a server entry holds an
 * absolute command path, and a checked-in one would only work on the machine
 * that wrote it.
 */
function writeConfig(name: string, serverPath: string): string {
  const file = path.join(os.tmpdir(), `zelyq-mcp-${name}-${process.pid}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ mcpServers: { demo: { command: "node", args: [serverPath] } } }),
  );
  return file;
}

const CONFIG = writeConfig("demo", path.join(FIXTURES, "mcp-demo-server.mjs"));
const BROKEN = writeConfig("broken", path.join(FIXTURES, "no-such-server.mjs"));
after(() => {
  for (const file of [CONFIG, BROKEN]) fs.rmSync(file, { force: true });
});

test("no config means no MCP, and no complaint", async () => {
  const tools: typeof ALL_TOOLS = [];
  const result = await loadMcpServers(undefined, tools, silent);
  assert.deepEqual(result.loaded, []);
  assert.equal(tools.length, 0);
});

test("an unreadable or invalid config warns and never throws", async () => {
  const warnings: string[] = [];
  const log = { info: () => undefined, warn: (m: string) => warnings.push(m) };
  assert.equal(await readMcpConfig(path.join(os.tmpdir(), "zelyq-no-such-mcp.json"), log), null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /could not be read/);
});

test("tool names are namespaced by server", () => {
  assert.equal(mcpToolName("github", "list_issues"), "github__list_issues");
});

test("connects to a real MCP server and calls a tool over stdio", async () => {
  const tools: typeof ALL_TOOLS = [];
  const result = await loadMcpServers(CONFIG, tools, silent);
  try {
    assert.deepEqual(result.skipped, [], "the fixture server must connect cleanly");
    assert.ok(result.loaded.includes("demo__add"));

    const out = await executeTool({} as never, "demo__add", { a: 2, b: 40 }, tools);
    assert.equal(out.output, "42");
    assert.equal(out.isError, false);
  } finally {
    await Promise.all(result.clients.map((c) => c.close()));
  }
});

test("a server's own JSON Schema reaches the model unaltered", async () => {
  const tools: typeof ALL_TOOLS = [];
  const result = await loadMcpServers(CONFIG, tools, silent);
  try {
    const def = toolDefinitions(tools).find((d) => d.name === "demo__add");
    assert.ok(def);
    // `additionalProperties: false` is what a zod round trip would drop.
    assert.deepEqual(def.input_schema, {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
      additionalProperties: false,
    });
  } finally {
    await Promise.all(result.clients.map((c) => c.close()));
  }
});

test("everything a server returns is marked untrusted", async () => {
  const tools: typeof ALL_TOOLS = [];
  const result = await loadMcpServers(CONFIG, tools, silent);
  try {
    const out = await executeTool({} as never, "demo__add", { a: 1, b: 1 }, tools);
    assert.deepEqual(out.untrusted, { source: "demo (MCP)" });
  } finally {
    await Promise.all(result.clients.map((c) => c.close()));
  }
});

test("a failing tool call is that call's error, never the turn's", async () => {
  const tools: typeof ALL_TOOLS = [];
  const result = await loadMcpServers(CONFIG, tools, silent);
  try {
    const out = await executeTool({} as never, "demo__add", { a: "not a number" }, tools);
    assert.equal(out.isError, true);
    assert.match(out.output, /demo MCP server could not run "add"/);
    // and the tool still works afterwards — one bad call must not poison it
    const ok = await executeTool({} as never, "demo__add", { a: 3, b: 4 }, tools);
    assert.equal(ok.output, "7");
  } finally {
    await Promise.all(result.clients.map((c) => c.close()));
  }
});

test("namespacing makes shadowing a built-in structurally impossible", async () => {
  // The fixture exposes a tool called `read_file`; namespacing means it can
  // only ever arrive as `demo__read_file`.
  const tools = [...ALL_TOOLS];
  const builtinCount = tools.length;
  const result = await loadMcpServers(CONFIG, tools, silent);
  try {
    assert.ok(result.loaded.includes("demo__read_file"));
    assert.ok(!result.loaded.includes("read_file"));
    const readFileTools = tools.filter((t) => t.name === "read_file");
    assert.equal(readFileTools.length, 1, "the built-in read_file must still be the only one");
    assert.equal(readFileTools[0]!.source, undefined, "and it must still be the BUILT-IN");
    assert.equal(tools.length, builtinCount + 2);
  } finally {
    await Promise.all(result.clients.map((c) => c.close()));
  }
});

test("a server that cannot start is skipped, leaving the agent usable", async () => {
  const tools: typeof ALL_TOOLS = [];
  const warnings: string[] = [];
  const result = await loadMcpServers(
    BROKEN,
    tools,
    { info: () => undefined, warn: (m: string) => warnings.push(m) },
    4_000,
  );
  assert.deepEqual(result.loaded, []);
  assert.equal(result.skipped.length, 1);
  assert.ok(warnings.some((w) => /could not be used/.test(w)));
});

test("a tool with no description still gets an honest one", () => {
  const tool = toZelyqTool({} as never, "demo", { name: "thing" });
  assert.match(tool.description, /"thing" tool from the demo MCP server/);
  assert.equal(tool.source, "mcp:demo");
});
