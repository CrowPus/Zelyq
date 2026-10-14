import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableGoogleModels,
  chooseGoogleAutoModel,
  GOOGLE_DEFAULT_MODEL,
  GOOGLE_MODELS,
  googleModel,
  googleThinkingConfig,
  withGoogleAuto,
} from "../src/google-models.js";

test("the 2.5 family is never sent thinkingLevel, which it rejects outright", () => {
  // Probed live 2026-09-10: "Thinking level is not supported for this model."
  // `gemini-2.5-pro` was the configured default, so every turn on it failed.
  for (const model of ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]) {
    const config = googleThinkingConfig(model, "high");
    assert.equal(config.thinkingLevel, undefined, `${model} must not get a level`);
    assert.equal(typeof config.thinkingBudget, "number", `${model} needs a budget`);
  }
});

test("a thinking budget always lands inside that model's own advertised range", () => {
  for (const model of GOOGLE_MODELS.filter((entry) => entry.thinking === "budget")) {
    const [min, max] = model.budgetRange ?? [0, 0];
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      const budget = googleThinkingConfig(model.value, effort).thinkingBudget ?? -1;
      assert.ok(
        budget >= min && budget <= max,
        `${model.value} at ${effort}: ${budget} outside ${min}-${max}`,
      );
    }
  }
  // The ranges genuinely differ between models — this is why one shared
  // constant would be wrong.
  assert.equal(googleThinkingConfig("gemini-2.5-pro", "max").thinkingBudget, 32_768);
  assert.ok((googleThinkingConfig("gemini-2.5-flash-lite", "low").thinkingBudget ?? 0) >= 512);
});

test("3.x models and -latest aliases take a level, not a budget", () => {
  for (const model of ["gemini-pro-latest", "gemini-3.8-flash", "gemini-flash-lite-latest"]) {
    const config = googleThinkingConfig(model, "max");
    assert.equal(config.thinkingLevel, "HIGH");
    assert.equal(config.thinkingBudget, undefined);
  }
  assert.equal(googleThinkingConfig("gemini-3.8-flash", "low").thinkingLevel, "LOW");
  assert.equal(googleThinkingConfig("gemini-3.8-flash", "medium").thinkingLevel, "MEDIUM");
});

test("an unknown ID gets the modern shape rather than a guessed budget range", () => {
  const config = googleThinkingConfig("gemini-4-pro", "high");
  assert.equal(config.thinkingLevel, "HIGH");
  assert.equal(config.thinkingBudget, undefined);
});

test("discovery keeps only catalog models, and Auto prefers the current Pro", () => {
  const listed = [
    "gemini-pro-latest",
    "gemini-3.8-flash",
    "gemini-2.5-flash-preview-tts",
    "gemini-3-pro-image",
    "embedding-001",
  ];
  assert.deepEqual(
    availableGoogleModels(listed).map((model) => model.value),
    ["gemini-pro-latest", "gemini-3.8-flash"],
  );
  assert.equal(
    chooseGoogleAutoModel(withGoogleAuto(availableGoogleModels(listed))),
    "gemini-pro-latest",
  );
  assert.equal(
    chooseGoogleAutoModel(availableGoogleModels(["gemini-3.8-flash"])),
    "gemini-3.8-flash",
  );
  assert.equal(chooseGoogleAutoModel([]), undefined);
  assert.deepEqual(withGoogleAuto([]), []);
});

test("no image, TTS, transcribe or embedding model is in the catalog", () => {
  for (const model of GOOGLE_MODELS) {
    assert.ok(
      !/(image|tts|transcribe|embedding|robotics|computer-use|omni)/.test(model.value),
      `${model.value} cannot run a tool-calling turn`,
    );
    assert.ok(model.value.startsWith("gemini-"), `${model.value} id`);
    if (model.thinking === "budget") assert.ok(model.budgetRange, `${model.value} needs a range`);
  }
});

test("Gemini 4 Argon is offered, takes a level, and does not take over the default", () => {
  const argon = googleModel("gemini-4-argon");
  assert.ok(argon, "listed in the catalog the chat picker and Settings read");
  assert.equal(argon.group, "recommended");
  assert.equal(argon.maxOutputTokens, 32_768, "Google reports half the usual output limit");
  assert.equal(googleThinkingConfig("gemini-4-argon", "high").thinkingLevel, "HIGH");
  assert.equal(googleThinkingConfig("gemini-4-argon", "high").thinkingBudget, undefined);
  // Discovery keeps it when the key can see it.
  assert.deepEqual(
    availableGoogleModels(["gemini-4-argon", "gemini-pro-latest"]).map((m) => m.value),
    ["gemini-pro-latest", "gemini-4-argon"],
  );
  // The agent routes `strong` child tasks to the first strong model in the
  // catalog; adding Argon must not silently move them.
  assert.equal(GOOGLE_MODELS.find((m) => m.tier === "strong")?.value, GOOGLE_DEFAULT_MODEL);
  assert.equal(
    chooseGoogleAutoModel(availableGoogleModels(["gemini-4-argon", "gemini-pro-latest"])),
    GOOGLE_DEFAULT_MODEL,
  );
});
