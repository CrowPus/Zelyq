import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import type { ZelyqTool } from "@zelyq/tools";
import { z } from "zod";
import { gateToolsForDefaultMode, isTaskOnlyPluginTool } from "../src/tool-relevance.js";

const tool = (name: string, source?: string): ZelyqTool => ({
  name,
  description: "x".repeat(30),
  schema: z.object({}),
  run: async () => ({ output: "" }),
  ...(source ? { source } : {}),
});

suite("tool relevance gating", () => {
  it("keeps every built-in tool", () => {
    const builtins = [tool("read_file"), tool("write_file"), tool("run_command")];
    assert.deepEqual(gateToolsForDefaultMode(builtins), builtins);
  });

  it("keeps the build-relevant plugin families", () => {
    for (const source of ["ai-docs.mjs", "image-assets.mjs", "browser-qa.mjs"]) {
      assert.equal(isTaskOnlyPluginTool(tool("t", source)), false, source);
    }
  });

  it("drops connectors and the other inspection families", () => {
    for (const source of [
      "github.mjs",
      "stripe.mjs",
      "figma.mjs",
      "sentry.mjs",
      "static-analysis.mjs",
      "test-intelligence.mjs",
      "git-inspector.mjs",
      "database-inspector.mjs",
      "api-tester.mjs",
      "project-intelligence.mjs",
    ]) {
      assert.equal(isTaskOnlyPluginTool(tool("t", source)), true, source);
    }
  });

  it("gateToolsForDefaultMode filters a mixed pool", () => {
    const pool = [
      tool("read_file"),
      tool("accessibility_audit", "browser-qa.mjs"),
      tool("fetch_provider_docs", "ai-docs.mjs"),
      tool("github_issues", "github.mjs"),
      tool("stripe_prices", "stripe.mjs"),
      tool("lint_project", "static-analysis.mjs"),
    ];
    assert.deepEqual(
      gateToolsForDefaultMode(pool).map((t) => t.name),
      ["read_file", "accessibility_audit", "fetch_provider_docs"],
    );
  });
});
