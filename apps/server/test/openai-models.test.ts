import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAIModelDiscovery } from "../src/services/openai-models.js";

test("discovery shares in-flight calls, caches per credential/endpoint, and sends the actual alias", async () => {
  const calls: Array<{ url: string; auth: string | null }> = [];
  const discovery = new OpenAIModelDiscovery(async (input, init) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
    return Response.json({
      data: [{ id: "gpt-5.6" }, { id: "gpt-5.6-terra" }, { id: "gpt-image-2" }],
    });
  });
  const [first, second] = await Promise.all([
    discovery.list("key-one", "https://example.com/v1/responses"),
    discovery.list("key-one", "https://example.com/v1/responses"),
  ]);
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { url: "https://example.com/v1/models", auth: "Bearer key-one" });
  assert.deepEqual(
    first.models.map((model) => model.value),
    ["gpt-5.6", "gpt-5.6-terra"],
  );
  await discovery.list("key-two", "https://example.com/v1/responses");
  await discovery.list("key-two", "https://another.example.com/v1");
  assert.equal(calls.length, 3);
  assert.ok(!JSON.stringify(first).includes("key-one"));
});
test("empty success differs from discovery failure; no key makes no request", async () => {
  const empty = new OpenAIModelDiscovery(async () => Response.json({ data: [] }));
  assert.deepEqual((await empty.list("key", "")).models, []);
  assert.equal((await empty.list("key", "")).modelAvailability, "verified");
  for (const request of [
    async () => Response.json({ error: "denied" }, { status: 403 }),
    async () => Response.json({ invalid: true }),
    async () => {
      throw new Error("timeout");
    },
  ]) {
    const result = await new OpenAIModelDiscovery(request).list("key", "");
    assert.equal(result.modelAvailability, "unverified");
    assert.ok(result.models.some((model) => model.value === "gpt-6-astra"));
  }
  const discovery = new OpenAIModelDiscovery(async () => {
    assert.fail("must not call");
  });
  assert.equal((await discovery.list("", "")).modelAvailability, "unconfigured");
  assert.equal(
    (await discovery.list("key", "http://remote.example.com")).modelAvailability,
    "unverified",
  );
});

test("switching from a custom provider uses OpenAI defaults and preserves explicit choices", async () => {
  const { createStore, runMigrations } = await import("@zelyq/db");
  const { randomBytes } = await import("node:crypto");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { SettingsService } = await import("../src/services/settings.js");
  const { SecretBox } = await import("../src/services/secrets.js");
  const dir = await mkdtemp(join(tmpdir(), "openai-settings-"));
  const database = `file:${join(dir, "settings.db")}`;
  await runMigrations(database);
  const store = createStore(database);
  const env = {
    ZELYQ_PROVIDER: "custom",
    ZELYQ_MODEL: "custom-model",
    ZELYQ_MODEL_BASE_URL: "https://previous-vendor.example/v1",
  };
  const settings = new SettingsService(store, new SecretBox(randomBytes(32)), env);
  try {
    await store.settings.set("model", "another-custom-model");
    await settings.update({ provider: "openai" });
    assert.equal(await settings.modelFor("openai"), "auto");
    assert.equal(await settings.openAIBaseUrl(), "https://api.openai.com/v1");
    await settings.update({ model: "" });
    assert.equal(await settings.modelFor("openai"), "");
    await settings.update({ provider: "custom" });
    await settings.update({ provider: "openai", model: "gpt-6-astra" });
    assert.equal(await settings.modelFor("openai"), "gpt-6-astra");
    const proxySettings = new SettingsService(store, new SecretBox(randomBytes(32)), {
      ...env,
      ZELYQ_PROVIDER: "openai",
    });
    assert.equal(await proxySettings.openAIBaseUrl(), "https://previous-vendor.example/v1");
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
