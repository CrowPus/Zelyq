import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import { neverRan } from "../evals/harness.js";
import type { CaseResult } from "../evals/types.js";

const base: CaseResult = {
  id: "x",
  title: "x",
  tags: [],
  intact: false,
  done: false,
  clean: false,
  checks: [],
  rounds: 0,
  toolCalls: 0,
  toolErrors: 0,
  tokensIn: 0,
  tokensOut: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  filesChanged: [],
  reply: "",
  durationMs: 0,
  error: null,
};

/**
 * `neverRan` gates whether a case's checks are scored at all (F5). The pristine
 * template passes every critical check by construction, so a case that never
 * reached the model must be classed `errored`, not `intact` — otherwise an
 * unreachable model reports `intact 100%`.
 */
suite("neverRan", () => {
  it("true when the model was never reached — error, no rounds, no tokens", () => {
    assert.equal(neverRan({ ...base, error: "internal: model not found" }), true);
  });

  it("false with no error, even if the case was a no-op", () => {
    assert.equal(neverRan({ ...base, error: null }), false);
  });

  it("false once any round ran — a mid-turn rate limit still did real work", () => {
    assert.equal(
      neverRan({ ...base, error: "429 rate limited", rounds: 3, tokensIn: 5000 }),
      false,
    );
  });

  it("false if tokens were spent even with rounds still at 0", () => {
    assert.equal(neverRan({ ...base, error: "stream broke", tokensIn: 1200 }), false);
  });

  it("a skipped case (suite aborted) counts as never-ran", () => {
    assert.equal(
      neverRan({ ...base, error: "skipped — suite aborted on a repeated config error" }),
      true,
    );
  });
});
