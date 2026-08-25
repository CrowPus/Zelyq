import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { createProvider } from "../src/providers/index.js";

/**
 * `045` in the council notes — using a Claude Code-issued OAuth token in
 * place of an API key. The Anthropic SDK exposes both `apiKey` and
 * `authToken` as plain readable properties on the client it builds, so the
 * actual auth shape a request will carry is directly checkable here,
 * without a live call.
 */

function clientOf(provider: AnthropicProvider): {
  apiKey: string | null;
  authToken: string | null;
} {
  return (provider as unknown as { client: { apiKey: string | null; authToken: string | null } })
    .client;
}

test("default auth mode sends the value as a classic API key", () => {
  const provider = new AnthropicProvider("claude-opus-5", "sk-ant-test");
  const client = clientOf(provider);
  assert.equal(client.apiKey, "sk-ant-test");
  assert.equal(client.authToken, null);
});

test("api_key mode is explicitly the same as the default", () => {
  const provider = new AnthropicProvider("claude-opus-5", "sk-ant-test", "api_key");
  const client = clientOf(provider);
  assert.equal(client.apiKey, "sk-ant-test");
  assert.equal(client.authToken, null);
});

test("subscription mode sends the value as a bearer token, never as an api key", () => {
  const provider = new AnthropicProvider("claude-opus-5", "cli-issued-oauth-token", "subscription");
  const client = clientOf(provider);
  assert.equal(client.authToken, "cli-issued-oauth-token");
  assert.equal(client.apiKey, null);
});

test("createProvider threads authMode through to AnthropicProvider", () => {
  const provider = createProvider({
    provider: "anthropic",
    model: "claude-opus-5",
    apiKey: "cli-issued-oauth-token",
    authMode: "subscription",
  }) as AnthropicProvider;
  const client = clientOf(provider);
  assert.equal(client.authToken, "cli-issued-oauth-token");
});

test("createProvider without authMode behaves exactly as before this existed", () => {
  const provider = createProvider({
    provider: "anthropic",
    model: "claude-opus-5",
    apiKey: "sk-ant-test",
  }) as AnthropicProvider;
  const client = clientOf(provider);
  assert.equal(client.apiKey, "sk-ant-test");
  assert.equal(client.authToken, null);
});
