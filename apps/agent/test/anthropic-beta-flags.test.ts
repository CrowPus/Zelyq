import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import { extraBetaHeader, extraRequestBody, taskBudgetConfig } from "../src/providers/anthropic.js";

/**
 * The two opt-in Anthropic server-side features (context editing, refusal
 * fallback). Both are betas passed as a header + a body param the non-beta SDK
 * types do not know, so this pins the exact strings — a wrong one is a 400 on
 * the whole turn (confirmed live: `compact_20260112` was rejected 2026-09-02),
 * and there is no typecheck to catch it.
 */
suite("anthropic beta feature flags", () => {
  it("both off — nothing is added, so a normal request is unchanged", () => {
    assert.equal(extraBetaHeader({}), "");
    assert.deepEqual(extraRequestBody({}), {});
  });

  it("ZELYQ_CONTEXT_EDITING=1 adds context-management + clear_tool_uses_20250919", () => {
    const env = { ZELYQ_CONTEXT_EDITING: "1" };
    assert.equal(extraBetaHeader(env), "context-management-2025-06-27");
    assert.deepEqual(extraRequestBody(env), {
      context_management: {
        edits: [{ type: "clear_tool_uses_20250919", clear_tool_inputs: true }],
      },
    });
  });

  it("ZELYQ_REFUSAL_FALLBACK=1 adds server-side-fallback + fallbacks:default", () => {
    const env = { ZELYQ_REFUSAL_FALLBACK: "1" };
    assert.equal(extraBetaHeader(env), "server-side-fallback-2026-07-01");
    assert.deepEqual(extraRequestBody(env), { fallbacks: "default" });
  });

  it("both flags on — both betas, comma-joined, and both body params", () => {
    const env = { ZELYQ_CONTEXT_EDITING: "1", ZELYQ_REFUSAL_FALLBACK: "1" };
    assert.equal(
      extraBetaHeader(env),
      "context-management-2025-06-27,server-side-fallback-2026-07-01",
    );
    const body = extraRequestBody(env);
    assert.ok("context_management" in body && "fallbacks" in body);
  });

  it('a value other than exactly "1" does not enable the flag', () => {
    assert.equal(extraBetaHeader({ ZELYQ_CONTEXT_EDITING: "true" }), "");
    assert.equal(extraBetaHeader({ ZELYQ_CONTEXT_EDITING: "0" }), "");
  });

  it("ZELYQ_TASK_BUDGET=1 adds a task_budget to output_config; off → nothing", () => {
    assert.deepEqual(taskBudgetConfig({}), {});
    assert.deepEqual(taskBudgetConfig({ ZELYQ_TASK_BUDGET: "1" }), {
      task_budget: { type: "tokens", total: 1_000_000 },
    });
  });
});
