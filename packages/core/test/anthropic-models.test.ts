import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANTHROPIC_MODELS,
  anthropicMaxOutputTokens,
  anthropicThinkingConfig,
  availableAnthropicModels,
  cacheReadFactorFor,
  chooseAnthropicAutoModel,
  withAnthropicAuto,
} from "../src/anthropic-models.js";

test("discovery keeps only catalog models and drops everything else", () => {
  const models = availableAnthropicModels([
    "claude-opus-5",
    "claude-haiku-4-5",
    "claude-mythos-5-1",
    "claude-3-opus-20240229",
  ]);
  assert.deepEqual(
    models.map((model) => model.value),
    ["claude-opus-5", "claude-haiku-4-5"],
  );
  // Project Glasswing only — must never be offered to an ordinary account.
  assert.equal(
    ANTHROPIC_MODELS.some((model) => model.value === "claude-mythos-5-1"),
    false,
  );
});

test("a model listed only under a dated snapshot is still offered, under its bare ID", () => {
  // Exactly what a live account returned on 2026-09-10: Haiku 4.5 appears
  // solely as a dated snapshot. Exact matching alone silently dropped it.
  const listed = [
    "claude-fable-5-1",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-opus-4-5-20251101",
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20250929",
  ];
  const values = availableAnthropicModels(listed).map((model) => model.value);
  assert.ok(values.includes("claude-haiku-4-5"), "Haiku 4.5 must survive alias matching");
  // The bare, documented ID is what gets offered and stored — not the snapshot.
  assert.ok(!values.some((value) => /-\d{8}$/.test(value)));
  // Config still resolves when someone pins the dated ID by hand.
  assert.equal(anthropicMaxOutputTokens("claude-haiku-4-5-20251001"), 64_000);
  assert.equal(
    anthropicThinkingConfig("claude-haiku-4-5-20251001", "max", 64_000).effort,
    undefined,
  );
});

test("Auto prefers Opus 5 and never invents access it was not shown", () => {
  assert.equal(
    chooseAnthropicAutoModel(
      withAnthropicAuto(availableAnthropicModels(["claude-sonnet-5", "claude-opus-5"])),
    ),
    "claude-opus-5",
  );
  // Opus 5 absent: falls to the next preferred that is actually listed.
  assert.equal(
    chooseAnthropicAutoModel(availableAnthropicModels(["claude-haiku-4-5", "claude-sonnet-5"])),
    "claude-sonnet-5",
  );
  assert.equal(chooseAnthropicAutoModel([]), undefined);
  assert.deepEqual(withAnthropicAuto([]), []);
});

test("Haiku 4.5 is never sent an effort parameter, and gets a valid thinking budget", () => {
  const config = anthropicThinkingConfig("claude-haiku-4-5", "max", 64_000);
  // The bug this catalog exists to fix: `output_config.effort` is an error here.
  assert.equal(config.effort, undefined);
  assert.equal(config.thinking.type, "enabled");
  assert.ok((config.thinking.budget_tokens ?? 0) >= 1024);
  assert.ok((config.thinking.budget_tokens ?? 0) < 64_000);
});

test("a budget that cannot fit under max_tokens disables thinking rather than erroring", () => {
  const config = anthropicThinkingConfig("claude-haiku-4-5", "high", 1024);
  assert.equal(config.thinking.type, "disabled");
  assert.equal(config.thinking.budget_tokens, undefined);
});

test("xhigh steps down on the 4.6 family and is kept everywhere it exists", () => {
  assert.equal(anthropicThinkingConfig("claude-sonnet-4-6", "xhigh", 128_000).effort, "high");
  assert.equal(anthropicThinkingConfig("claude-opus-4-6", "xhigh", 128_000).effort, "high");
  assert.equal(anthropicThinkingConfig("claude-opus-4-6", "max", 128_000).effort, "max");
  assert.equal(anthropicThinkingConfig("claude-opus-5", "xhigh", 128_000).effort, "xhigh");
  assert.equal(anthropicThinkingConfig("claude-fable-5-1", "max", 128_000).effort, "max");
});

test("an unknown custom ID gets the safe shape and no guessed effort", () => {
  const config = anthropicThinkingConfig("claude-something-new", "max", 64_000);
  assert.equal(config.effort, undefined);
  assert.deepEqual(config.thinking, { type: "adaptive", display: "summarized" });
});

test("output ceilings come from the catalog, conservatively for unknown IDs", () => {
  assert.equal(anthropicMaxOutputTokens("claude-opus-5"), 128_000);
  // Previously held to 64,000 by a regex that only matched the 5-series.
  assert.equal(anthropicMaxOutputTokens("claude-opus-4-8"), 128_000);
  assert.equal(anthropicMaxOutputTokens("claude-fable-5"), 128_000);
  assert.equal(anthropicMaxOutputTokens("claude-haiku-4-5"), 64_000);
  assert.equal(anthropicMaxOutputTokens("claude-something-new"), 64_000);
});

test("cache read factor is derived, so Fable 5.1's flat rate is not assumed to be 0.1x", () => {
  const opus = ANTHROPIC_MODELS.find((model) => model.value === "claude-opus-5");
  const fable = ANTHROPIC_MODELS.find((model) => model.value === "claude-fable-5-1");
  assert.ok(opus && fable);
  assert.equal(cacheReadFactorFor(opus), 0.1);
  assert.equal(cacheReadFactorFor(fable), 0.025);
});

test("every catalog entry is well-formed", () => {
  for (const model of ANTHROPIC_MODELS) {
    assert.ok(model.value.startsWith("claude-"), `${model.value} id`);
    // Claude IDs carry no date suffix; a dated one is a silent 404.
    assert.ok(!/-\d{8}$/.test(model.value), `${model.value} must not be date-suffixed`);
    assert.ok(model.maxOutputTokens > 0, `${model.value} max output`);
    assert.ok(model.label.length > 0, `${model.value} label`);
    if (model.thinking === "budget") assert.equal(model.effort.length, 0, `${model.value} effort`);
  }
});
