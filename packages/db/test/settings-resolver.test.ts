import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createStore, runMigrations, type Store } from "../src/index.js";
import { resolveSetting } from "../src/settings-resolver.js";

/**
 * Against a real, migrated database — not a mock. The bug this exists to
 * catch (`034`) was "the real database is never even consulted," which a
 * mocked reader would hide exactly the way the original bug was hidden.
 */
const tmp = path.join(os.tmpdir(), `zelyq-settings-resolver-${Date.now()}`);
let store: Store;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  const url = `file:${path.join(tmp, "resolver.db")}`;
  await runMigrations(url);
  store = createStore(url);
});

after(async () => {
  await store.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("an environment variable wins over a stored value", async () => {
  await store.settings.set("previewHost", "10.0.0.5");
  const resolved = await resolveSetting(
    store.settings,
    "ZELYQ_PREVIEW_HOST",
    "previewHost",
    "127.0.0.1",
    { ZELYQ_PREVIEW_HOST: "192.168.1.1" },
  );
  assert.equal(resolved, "192.168.1.1");
});

test("a stored value applies when the environment is silent — the actual bug this closes", async () => {
  await store.settings.set("previewHost", "10.0.0.5");
  const resolved = await resolveSetting(
    store.settings,
    "ZELYQ_PREVIEW_HOST",
    "previewHost",
    "127.0.0.1",
    {},
  );
  assert.equal(resolved, "10.0.0.5", "the database value must actually be read, not just stored");
});

test("the fallback applies when neither the environment nor the database has a value", async () => {
  const resolved = await resolveSetting(
    store.settings,
    "ZELYQ_SOME_UNSET_SETTING",
    "someUnsetSetting",
    "a-default",
    {},
  );
  assert.equal(resolved, "a-default");
});
