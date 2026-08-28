import assert from "node:assert/strict";
import { test } from "node:test";
import { toolDefinitions } from "@zelyq/tools";
import { toFunctionDeclarations, toThinkingLevel } from "../src/providers/google.js";
import {
  apiKeyFromEnv,
  createProvider,
  defaultModelFor,
  isProviderId,
  PROVIDERS,
} from "../src/providers/index.js";

test("every registered provider is fully described", () => {
  for (const provider of Object.values(PROVIDERS)) {
    assert.ok(provider.label.length > 0, `${provider.id} needs a label`);
    assert.ok(provider.apiKeyEnv.length > 0, `${provider.id} needs at least one key variable`);
    assert.match(provider.docsUrl, /^https:\/\//);

    // A vendor knows which model it serves by default. An endpoint the operator
    // supplies does not, and guessing produces a 404 that reads like our bug —
    // so `baseUrl: null`, the self-hosted door, is one entry allowed to have no
    // default. The other: a hosted vendor with no `models` entry either, which
    // means nothing about it is confirmed yet — same evidence bar as `custom`,
    // just for a different reason. Anything with a confirmed model
    // list but no default is a mistake — those two must agree.
    if (provider.baseUrl === null || !provider.models) {
      assert.equal(
        provider.defaultModel,
        "",
        `${provider.id} must not guess a model it has not confirmed`,
      );
    } else {
      assert.ok(provider.defaultModel.length > 0, `${provider.id} needs a default model`);
    }
  }
});

test("provider ids are validated, not trusted", () => {
  assert.ok(isProviderId("anthropic"));
  assert.ok(isProviderId("google"));
  assert.ok(isProviderId("openai"));
  assert.ok(isProviderId("xai"));
  assert.ok(isProviderId("deepseek"));
  assert.ok(isProviderId("mistral"));
  assert.ok(isProviderId("groq"));
  assert.ok(isProviderId("openrouter"));
  assert.ok(isProviderId("custom"));
  assert.ok(!isProviderId("acme-models"));
  assert.ok(!isProviderId(""));
});

test("each provider brings its own default model", () => {
  assert.equal(defaultModelFor("anthropic"), "claude-opus-5");
  assert.match(defaultModelFor("google"), /^gemini-/);
  assert.equal(defaultModelFor("deepseek"), "deepseek-chat");
  assert.equal(defaultModelFor("mistral"), "mistral-large-latest");
  assert.equal(defaultModelFor("xai"), "grok-4");
  assert.equal(defaultModelFor("groq"), "llama-3.3-70b-versatile");
  assert.equal(defaultModelFor("openrouter"), "anthropic/claude-sonnet-4.5");
  // Only `custom` has no default — the server it points at is the user's,
  // and guessing a model produces a 404 that reads like our bug.
  assert.equal(defaultModelFor("custom"), "");
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

test("the newer OpenAI-dialect vendors build without a base URL to remember", () => {
  // createProvider takes whatever model the caller resolved — it does not
  // re-apply a registry default itself, the same contract every existing
  // provider already has. `defaultModelFor` is what a caller uses first.
  const deepseek = createProvider({
    provider: "deepseek",
    model: defaultModelFor("deepseek"),
    apiKey: "x",
  });
  assert.equal(deepseek.id, "deepseek");
  const mistral = createProvider({
    provider: "mistral",
    model: defaultModelFor("mistral"),
    apiKey: "x",
  });
  assert.equal(mistral.id, "mistral");
});

test("a custom endpoint with no model refuses rather than guesses", () => {
  assert.throws(
    () => createProvider({ provider: "custom", model: "", apiKey: "x" }),
    /no default model|model/i,
  );
  // Naming a model explicitly always works, even with no registry default.
  const grok = createProvider({ provider: "xai", model: "grok-4", apiKey: "x" });
  assert.equal(grok.id, "xai");
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
