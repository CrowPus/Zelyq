import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import {
  cachedFraction,
  estimateCostUsd,
  formatUsd,
  MODEL_RATES,
  totalPromptTokens,
} from "../evals/rates.js";

/**
 * The eval report's cost axis (F4 / 06-measurement.md §2). The point of these:
 * on Anthropic `tokensIn` is the *uncached* remainder, so the report must add
 * the cache reads and the cache write back to show the real prompt size, and
 * the dollar figure has to price cache reads at 0.1× — otherwise a working
 * cache reads as a 90% cost drop that never happened.
 */
suite("eval cost axis", () => {
  const counts = {
    tokensIn: 10_000,
    tokensOut: 2_000,
    cacheReadTokens: 90_000,
    cacheCreationTokens: 5_000,
  };

  it("totalPromptTokens is the whole prompt, not the uncached slice", () => {
    assert.equal(totalPromptTokens(counts), 105_000);
  });

  it("cachedFraction is reads over the whole prompt", () => {
    assert.ok(Math.abs((cachedFraction(counts) ?? 0) - 90_000 / 105_000) < 1e-9);
    assert.equal(
      cachedFraction({
        tokensIn: 0,
        tokensOut: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      }),
      null,
    );
  });

  it("prices cache reads at 0.1x and the cache write at 1.25x the input rate", () => {
    // claude-opus-5: $5/M in, $25/M out.
    const expected = (10_000 * 5 + 90_000 * 5 * 0.1 + 5_000 * 5 * 1.25 + 2_000 * 25) / 1_000_000;
    assert.ok(Math.abs((estimateCostUsd("claude-opus-5", counts) ?? 0) - expected) < 1e-9);
  });

  it("a fully-cached turn costs a fraction of the same turn uncached", () => {
    const uncached = estimateCostUsd("claude-opus-5", {
      tokensIn: 100_000,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    const cached = estimateCostUsd("claude-opus-5", {
      tokensIn: 1_000,
      tokensOut: 0,
      cacheReadTokens: 99_000,
      cacheCreationTokens: 0,
    });
    assert.ok(cached !== null && uncached !== null);
    assert.ok((cached as number) < (uncached as number) * 0.2);
  });

  it("returns null for a model with no rate, so the report drops the $ rather than lying", () => {
    assert.equal(estimateCostUsd("some-unknown-model-v9", counts), null);
    assert.equal(formatUsd(null), "—");
  });

  it("formats small and large figures readably", () => {
    assert.equal(formatUsd(0), "$0");
    assert.equal(formatUsd(0.0042), "$0.0042");
    assert.equal(formatUsd(2.937), "$2.94");
  });

  it("every rate is well-formed", () => {
    for (const [model, rate] of Object.entries(MODEL_RATES)) {
      assert.ok(rate.inputPer1M > 0, `${model} input rate`);
      assert.ok(rate.outputPer1M > 0, `${model} output rate`);
      assert.ok(rate.cacheReadFactor >= 0 && rate.cacheReadFactor <= 1, `${model} read factor`);
      assert.ok(rate.cacheCreationFactor >= 0, `${model} write factor`);
    }
  });
});
