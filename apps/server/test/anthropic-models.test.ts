import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicModelDiscovery } from "../src/services/anthropic-models.js";

test("discovery shares in-flight calls, caches per credential/endpoint, and authenticates correctly", async () => {
  const calls: Array<{ url: string; key: string | null; version: string | null }> = [];
  const discovery = new AnthropicModelDiscovery(async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      key: headers.get("x-api-key"),
      version: headers.get("anthropic-version"),
    });
    return Response.json({
      data: [{ id: "claude-opus-5" }, { id: "claude-haiku-4-5" }, { id: "claude-legacy-thing" }],
    });
  });
  const [first, second] = await Promise.all([
    discovery.list("key-one", "https://example.com/v1/messages"),
    discovery.list("key-one", "https://example.com/v1/messages"),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  // Anthropic uses x-api-key and a pinned version — not a bearer token.
  assert.deepEqual(calls[0], {
    url: "https://example.com/v1/models",
    key: "key-one",
    version: "2023-06-01",
  });
  assert.deepEqual(
    first.models.map((model) => model.value),
    ["claude-opus-5", "claude-haiku-4-5"],
  );
  await discovery.list("key-two", "https://example.com/v1/messages");
  await discovery.list("key-two", "https://another.example.com");
  assert.equal(calls.length, 3);
  // The credential must never end up inside the cached result.
  assert.ok(!JSON.stringify(first).includes("key-one"));
});

test("empty success differs from discovery failure; no key makes no request", async () => {
  const empty = new AnthropicModelDiscovery(async () => Response.json({ data: [] }));
  assert.deepEqual((await empty.list("key", "")).models, []);
  assert.equal((await empty.list("key", "")).modelAvailability, "verified");

  for (const request of [
    async () => Response.json({ error: "denied" }, { status: 403 }),
    async () => Response.json({ invalid: true }),
    async () => {
      throw new Error("timeout");
    },
  ]) {
    const result = await new AnthropicModelDiscovery(request).list("key", "");
    // A restricted key may generate without permission to list, so a failed
    // lookup shows the catalog rather than hiding every model.
    assert.equal(result.modelAvailability, "unverified");
    assert.ok(result.models.length > 0);
  }

  let requested = false;
  const unconfigured = await new AnthropicModelDiscovery(async () => {
    requested = true;
    return Response.json({ data: [] });
  }).list("", "");
  assert.equal(requested, false);
  assert.equal(unconfigured.modelAvailability, "unconfigured");
  assert.ok(unconfigured.models.length > 0);
});

test("a plaintext endpoint is refused unless it is loopback", async () => {
  let requested = false;
  const discovery = new AnthropicModelDiscovery(async () => {
    requested = true;
    return Response.json({ data: [{ id: "claude-opus-5" }] });
  });
  assert.equal(
    (await discovery.list("key", "http://evil.example.com")).modelAvailability,
    "unverified",
  );
  assert.equal(requested, false);
  assert.equal(
    (await discovery.list("key", "http://127.0.0.1:8080/v1")).modelAvailability,
    "verified",
  );
  assert.equal(requested, true);
});
