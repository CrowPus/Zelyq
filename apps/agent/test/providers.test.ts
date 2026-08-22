import assert from "node:assert/strict";
import { test } from "node:test";
import { toolDefinitions } from "@zelyq/tools";
import { toFunctionDeclarations, toThinkingLevel } from "../src/providers/google.js";
import {
  PROVIDERS,
  apiKeyFromEnv,
  createProvider,
  defaultModelFor,
  isProviderId,
} from "../src/providers/index.js";

test("every registered provider is fully described", () => {
  for (const provider of Object.values(PROVIDERS)) {
    assert.ok(provider.label.length > 0, `${provider.id} needs a label`);
    assert.ok(provider.defaultModel.length > 0, `${provider.id} needs a default model`);
    assert.ok(provider.apiKeyEnv.length > 0, `${provider.id} needs at least one key variable`);
    assert.match(provider.docsUrl, /^https:\/\//);
  }
});

test("provider ids are validated, not trusted", () => {
  assert.ok(isProviderId("anthropic"));
  assert.ok(isProviderId("google"));
  assert.ok(!isProviderId("openai"));
  assert.ok(!isProviderId(""));
});

test("each provider brings its own default model", () => {
  assert.equal(defaultModelFor("anthropic"), "claude-opus-5");
  assert.match(defaultModelFor("google"), /^gemini-/);
});

test("api keys resolve from the provider's own variables, in order", () => {
  assert.equal(apiKeyFromEnv("anthropic", { ANTHROPIC_API_KEY: "a" }), "a");
  assert.equal(apiKeyFromEnv("google", { GEMINI_API_KEY: "g" }), "g");
  // GOOGLE_API_KEY is the documented fallback for the same provider.
  assert.equal(apiKeyFromEnv("google", { GOOGLE_API_KEY: "fallback" }), "fallback");
  assert.equal(
    apiKeyFromEnv("google", { GEMINI_API_KEY: "first", GOOGLE_API_KEY: "second" }),
    "first",
  );
  assert.equal(apiKeyFromEnv("google", {}), undefined);
  // An Anthropic key must never satisfy Gemini.
  assert.equal(apiKeyFromEnv("google", { ANTHROPIC_API_KEY: "a" }), undefined);
});

test("the factory builds each provider", () => {
  const claude = createProvider({ provider: "anthropic", model: "claude-opus-5", apiKey: "x" });
  assert.equal(claude.id, "anthropic");
  const gemini = createProvider({ provider: "google", model: "gemini-3.7-flash", apiKey: "x" });
  assert.equal(gemini.id, "google");
});

test("effort maps onto Gemini's thinking levels", () => {
  assert.equal(toThinkingLevel("low"), "LOW");
  assert.equal(toThinkingLevel("medium"), "MEDIUM");
  assert.equal(toThinkingLevel("high"), "HIGH");
  // Gemini has no level above HIGH, so the top three efforts collapse into it.
  assert.equal(toThinkingLevel("xhigh"), "HIGH");
  assert.equal(toThinkingLevel("max"), "HIGH");
});

test("tool schemas are scrubbed of keys the Gemini API rejects", () => {
  const declarations = toFunctionDeclarations(toolDefinitions());
  assert.equal(declarations.length, toolDefinitions().length);

  const serialised = JSON.stringify(declarations);
  assert.ok(!serialised.includes("$schema"), "$schema must be stripped");
  assert.ok(!serialised.includes("$ref"), "$ref must be stripped");

  for (const declaration of declarations) {
    assert.match(declaration.name, /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/);
    const schema = declaration.parametersJsonSchema as { type?: string; properties?: object };
    assert.equal(schema.type, "object");
    assert.ok(schema.properties, `${declaration.name} lost its properties`);
  }
});

test("scrubbing keeps nested property schemas intact", () => {
  const readFile = toFunctionDeclarations(toolDefinitions()).find(
    (declaration) => declaration.name === "read_file",
  );
  const schema = readFile?.parametersJsonSchema as {
    properties: { path: { type: string; description?: string } };
    required?: string[];
  };
  assert.equal(schema.properties.path.type, "string");
  assert.ok(schema.required?.includes("path"));
});
