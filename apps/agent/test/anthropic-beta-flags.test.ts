import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import { extraBetaHeader, extraRequestBody } from "../src/providers/anthropic.js";

/**
 * The two opt-in Anthropic server-side features (compaction, refusal fallback).
 * Both are betas passed as a header + a body param the non-beta SDK types do
 * not know, so this pins the exact strings — a wrong one is a 400 on the whole
 * turn, and there is no typecheck to catch it.
 */
suite("anthropic beta feature flags", () => {
  it("both off — nothing is added, so a normal request is unchanged", () => {
    assert.equal(extraBetaHeader({}), "");
    assert.deepEqual(extraRequestBody({}), {});
  });

  it("ZELYQ_COMPACTION=1 adds context-management + compact_20260112", () => {
    const env = { ZELYQ_COMPACTION: "1" };
    assert.equal(extraBetaHeader(env), "context-management-2025-06-27");
    assert.deepEqual(extraRequestBody(env), {
      context_management: { edits: [{ type: "compact_20260112" }] },
    });
  });

  it("ZELYQ_REFUSAL_FALLBACK=1 adds server-side-fallback + fallbacks:default", () => {
    const env = { ZELYQ_REFUSAL_FALLBACK: "1" };
    assert.equal(extraBetaHeader(env), "server-side-fallback-2026-07-01");
    assert.deepEqual(extraRequestBody(env), { fallbacks: "default" });
  });

  it("both flags on — both betas, comma-joined, and both body params", () => {
    const env = { ZELYQ_COMPACTION: "1", ZELYQ_REFUSAL_FALLBACK: "1" };
    assert.equal(
      extraBetaHeader(env),
      "context-management-2025-06-27,server-side-fallback-2026-07-01",
    );
    const body = extraRequestBody(env);
    assert.ok("context_management" in body && "fallbacks" in body);
  });

  it('a value other than exactly "1" does not enable the flag', () => {
    assert.equal(extraBetaHeader({ ZELYQ_COMPACTION: "true" }), "");
    assert.equal(extraBetaHeader({ ZELYQ_COMPACTION: "0" }), "");
  });
});
