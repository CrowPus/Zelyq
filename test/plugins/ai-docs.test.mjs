import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Isolate the on-disk cache before importing the plugin (it reads the env at
// module load for the cache dir default is fine — it re-reads per call via the
// constant, so set it here and the constant picks it up on import).
process.env.ZELYQ_DOC_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zelyq-doccache-test-"));

const [fetchProviderDocs] = (await import("../../plugins/ai-docs.mjs")).default;

const ctx = { log() {}, signal: { aborted: false } };
const realFetch = globalThis.fetch;

test("rejects a host that is not on the documentation allowlist", async () => {
  const r = await fetchProviderDocs.run(ctx, { url: "https://evil.example.com/docs" });
  assert.equal(r.isError, true);
  assert.match(r.output, /not on the documentation allowlist/);
});

test("with no url and no provider, tells the model to ask the user", async () => {
  const r = await fetchProviderDocs.run(ctx, {});
  assert.equal(r.isError, undefined);
  assert.match(r.output, /ask the user to paste/i);
});

test("a known provider slug resolves to an allowlisted docs URL and returns text", async () => {
  globalThis.fetch = async () =>
    new Response(
      "<html><body><h1>Messages API</h1><p>client.messages.create(...)</p></body></html>",
      {
        status: 200,
        headers: { "content-type": "text/html" },
      },
    );
  try {
    const r = await fetchProviderDocs.run(ctx, { provider: "anthropic" });
    assert.equal(r.isError, undefined);
    assert.match(r.output, /docs\.claude\.com/);
    assert.match(r.output, /client\.messages\.create/);
    assert.doesNotMatch(r.output, /<html>|<body>/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a fetch failure is a soft fallback, not an error", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    const r = await fetchProviderDocs.run(ctx, { provider: "openai" });
    assert.equal(r.isError, undefined);
    assert.match(r.output, /Could not reach/);
    assert.match(r.output, /ask the user to paste/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the result is cached on disk and the second call does not re-fetch", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("plain text docs body", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };
  try {
    const url = "https://docs.mistral.ai/api/";
    const first = await fetchProviderDocs.run(ctx, { url });
    const second = await fetchProviderDocs.run(ctx, { url });
    assert.equal(calls, 1, "only fetched once");
    assert.match(first.output, /plain text docs body/);
    assert.match(second.output, /\(cached\)/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
