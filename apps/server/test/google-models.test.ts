import assert from "node:assert/strict";
import { test } from "node:test";
import { GoogleModelDiscovery } from "../src/services/google-models.js";

test("discovery caches per credential, keeps the key out of the URL, and drops non-chat models", async () => {
  const calls: Array<{ url: string; key: string | null }> = [];
  const discovery = new GoogleModelDiscovery(async (input, init) => {
    calls.push({ url: String(input), key: new Headers(init?.headers).get("x-goog-api-key") });
    return Response.json({
      models: [
        { name: "models/gemini-pro-latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
        // Real entries from a live listing that cannot run a turn.
        {
          name: "models/gemini-2.5-flash-preview-tts",
          supportedGenerationMethods: ["generateContent"],
        },
        { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
      ],
    });
  });
  const [first, second] = await Promise.all([
    discovery.list("key-one", "https://generativelanguage.googleapis.com"),
    discovery.list("key-one", "https://generativelanguage.googleapis.com"),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.key, "key-one");
  // The credential must never reach the query string.
  assert.ok(!calls[0]?.url.includes("key-one"));
  assert.equal(
    calls[0]?.url,
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
  );
  assert.deepEqual(
    first.models.map((model) => model.value),
    ["gemini-pro-latest", "gemini-3.8-flash"],
  );
  await discovery.list("key-two", "https://generativelanguage.googleapis.com");
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(first).includes("key-one"));
});

test("empty success differs from discovery failure; no key makes no request", async () => {
  const empty = new GoogleModelDiscovery(async () => Response.json({ models: [] }));
  assert.deepEqual((await empty.list("key", "")).models, []);
  assert.equal((await empty.list("key", "")).modelAvailability, "verified");

  for (const request of [
    async () => Response.json({ error: "denied" }, { status: 403 }),
    async () => Response.json({ invalid: true }),
    async () => {
      throw new Error("timeout");
    },
  ]) {
    const result = await new GoogleModelDiscovery(request).list("key", "");
    assert.equal(result.modelAvailability, "unverified");
    assert.ok(result.models.length > 0);
  }

  let requested = false;
  const unconfigured = await new GoogleModelDiscovery(async () => {
    requested = true;
    return Response.json({ models: [] });
  }).list("", "");
  assert.equal(requested, false);
  assert.equal(unconfigured.modelAvailability, "unconfigured");
});

test("a plaintext endpoint is refused unless it is loopback", async () => {
  let requested = false;
  const discovery = new GoogleModelDiscovery(async () => {
    requested = true;
    return Response.json({ models: [{ name: "models/gemini-3.8-flash" }] });
  });
  assert.equal(
    (await discovery.list("k", "http://evil.example.com")).modelAvailability,
    "unverified",
  );
  assert.equal(requested, false);
  assert.equal(
    (await discovery.list("k", "http://127.0.0.1:8080/v1beta")).modelAvailability,
    "verified",
  );
  assert.equal(requested, true);
});
