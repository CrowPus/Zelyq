import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableOpenAIModels,
  chooseOpenAIAutoModel,
  openAIReasoningEffort,
  withOpenAIAuto,
} from "../src/openai-models.js";

test("discovery filters non-coding/deprecated models and preserves accessible aliases", () => {
  const models = availableOpenAIModels([
    "gpt-5.6",
    "gpt-6-astra",
    "gpt-5.2-codex",
    "o4-mini",
    "gpt-image-2",
    "whisper-1",
  ]);
  assert.deepEqual(
    models.map((model) => model.value),
    ["gpt-6-astra", "gpt-5.6"],
  );
  assert.equal(models[1]?.label, "GPT-5.6 Sol");
  assert.equal(availableOpenAIModels(["gpt-5.6", "gpt-5.6-sol"]).length, 1);
});
test("Auto selects only available models; empty discovery never invents access", () => {
  assert.equal(
    chooseOpenAIAutoModel(withOpenAIAuto(availableOpenAIModels(["gpt-6-astra", "gpt-5.6-terra"]))),
    "gpt-5.6-terra",
  );
  assert.equal(chooseOpenAIAutoModel(availableOpenAIModels(["gpt-5.6"])), "gpt-5.6");
  assert.equal(chooseOpenAIAutoModel([]), undefined);
  assert.deepEqual(withOpenAIAuto([]), []);
});
test("effort is model-specific, including aliases and snapshots", () => {
  assert.equal(openAIReasoningEffort("gpt-6-astra", "max"), "max");
  assert.equal(openAIReasoningEffort("gpt-5.6", "max"), "max");
  assert.equal(openAIReasoningEffort("gpt-5.3-codex", "max"), "xhigh");
  assert.equal(openAIReasoningEffort("gpt-5.4-pro", "low"), "medium");
  assert.equal(openAIReasoningEffort("gpt-5.1-2025-11-13", "max"), "high");
  assert.equal(openAIReasoningEffort("gpt-4o", "max"), undefined);
  assert.equal(openAIReasoningEffort("gpt-5.1-unknown", "max"), undefined);
});
