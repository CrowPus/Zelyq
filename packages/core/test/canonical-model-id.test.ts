import assert from "node:assert/strict";
import { test } from "node:test";
import { ANTHROPIC_MODELS, canonicalModelId, GOOGLE_MODELS, OPENAI_MODELS } from "../src/index.js";

test("a model typed by its shown name becomes its real ID", () => {
  // What was saved on a real instance, and refused by OpenAI as "Invalid model ID".
  assert.equal(canonicalModelId("gpt-6 astra", OPENAI_MODELS), "gpt-6-astra");
  assert.equal(canonicalModelId("GPT-6.2 Astra", OPENAI_MODELS), "gpt-6.2-astra");
  assert.equal(canonicalModelId("Claude Opus 5.5", ANTHROPIC_MODELS), "claude-opus-5-5");
  assert.equal(canonicalModelId(" Gemini 4 Carbon ", GOOGLE_MODELS), "gemini-4-carbon");
});

test("real IDs and dated aliases are kept as they are", () => {
  assert.equal(canonicalModelId("gpt-6.1-terra", OPENAI_MODELS), "gpt-6.1-terra");
  assert.equal(
    canonicalModelId("claude-haiku-4-5-20251001", ANTHROPIC_MODELS),
    "claude-haiku-4-5-20251001",
  );
});

test("an unknown model is passed through, trimmed, so new and custom models still work", () => {
  assert.equal(canonicalModelId("  my-own-model ", OPENAI_MODELS), "my-own-model");
  assert.equal(canonicalModelId("auto", OPENAI_MODELS), "auto");
  assert.equal(canonicalModelId("", OPENAI_MODELS), "");
});

test("the newest models are offered and are the defaults", async () => {
  const core = await import("../src/index.js");
  assert.equal(core.ANTHROPIC_DEFAULT_MODEL, "claude-opus-5-5");
  assert.equal(core.OPENAI_DEFAULT_MODEL, "gpt-6.1-terra");
  for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"])
    assert.ok(
      ANTHROPIC_MODELS.some((m) => m.value === id && m.group === "recommended"),
      id,
    );
  for (const id of ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-terra", "gpt-6-luna"])
    assert.ok(
      OPENAI_MODELS.some((m) => m.value === id && m.group === "recommended"),
      id,
    );
  for (const id of ["gemini-4-carbon", "gemini-4-neon", "gemini-4-hydrogen"])
    assert.ok(
      GOOGLE_MODELS.some((m) => m.value === id),
      id,
    );
  // Every model appears once.
  for (const list of [ANTHROPIC_MODELS, OPENAI_MODELS, GOOGLE_MODELS]) {
    const ids = list.map((m) => m.value);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("a pasted key loses the quotes and spaces it was copied with, nothing else", async () => {
  const { cleanApiKey } = await import("../src/index.js");
  assert.equal(cleanApiKey("  sk-abc123\n"), "sk-abc123");
  assert.equal(cleanApiKey("“sk-abc123”"), "sk-abc123");
  assert.equal(cleanApiKey("'sk-abc123'"), "sk-abc123");
  assert.equal(cleanApiKey("sk-ab“c"), "sk-ab“c", "the inside is never touched");
  assert.equal(cleanApiKey(""), "");
});

test("cleaning a long crafted key stays fast", async () => {
  const { cleanApiKey } = await import("../src/index.js");
  const crafted = `sk-a${"\t".repeat(100_000)}b`;
  const started = Date.now();
  assert.equal(cleanApiKey(crafted), crafted);
  assert.ok(Date.now() - started < 200, "linear, not quadratic");
});
