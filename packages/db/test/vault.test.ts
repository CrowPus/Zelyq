import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId, VAULT_VERSIONS_KEPT } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "../src/index.js";

let tmp: string;
let store: Store;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-vault-"));
  const url = `file:${tmp}/test.db`;
  await runMigrations(url);
  store = createStore(url);
});

after(async () => {
  await store?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seedProject(): Promise<{ projectId: string; userId: string }> {
  const suffix = newId("team").slice(-8);
  const userId = newId("user");
  await store.users.create({
    id: userId,
    name: "Ama",
    email: `${suffix}@example.com`,
    passwordHash: "unused",
  });
  const teamId = newId("team");
  await store.teams.create({ id: teamId, name: "vault", slug: `vault-${suffix}` });
  const projectId = newId("project");
  await store.projects.create({
    id: projectId,
    teamId,
    name: "vault",
    slug: `vault-${suffix}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });
  return { projectId, userId };
}

const now = () => new Date().toISOString();

test("a list never carries the stored value", async () => {
  const { projectId, userId } = await seedProject();
  await store.vault.create({
    projectId,
    name: "STRIPE_KEY",
    environment: "development",
    value: "ciphertext-1",
    description: null,
    userId,
    now: now(),
  });
  const [row] = await store.vault.list(projectId);
  assert.ok(row);
  assert.equal(row.name, "STRIPE_KEY");
  assert.equal("value" in row, false);
});

test("one name per environment, and the same name may exist in another", async () => {
  const { projectId, userId } = await seedProject();
  const base = { projectId, name: "API_KEY", value: "c", description: null, userId, now: now() };
  await store.vault.create({ ...base, environment: "development" });
  await store.vault.create({ ...base, environment: "production" });
  await assert.rejects(() => store.vault.create({ ...base, environment: "development" }));
  assert.equal((await store.vault.list(projectId, "production")).length, 1);
  assert.deepEqual(await store.vault.valuesFor(projectId, "development"), [
    { name: "API_KEY", value: "c" },
  ]);
});

test("each new value is a version, and only the newest are kept", async () => {
  const { projectId, userId } = await seedProject();
  const created = await store.vault.create({
    projectId,
    name: "TOKEN",
    environment: "development",
    value: "v1",
    description: null,
    userId,
    now: now(),
  });
  const writes = VAULT_VERSIONS_KEPT + 4;
  for (let n = 2; n <= writes; n++) {
    await store.vault.setValue(created.id, `v${n}`, userId, now());
  }
  const current = await store.vault.findById(created.id);
  assert.equal(current?.version, writes);
  assert.equal(current?.value, `v${writes}`);

  const kept = await store.vault.listVersions(created.id);
  assert.equal(kept.length, VAULT_VERSIONS_KEPT);
  assert.equal(kept[0]?.version, writes);
  assert.equal(await store.vault.versionValue(created.id, writes - 1), `v${writes - 1}`);
  assert.equal(await store.vault.versionValue(created.id, 1), null);
});

test("concurrent writes each get their own version", async () => {
  const { projectId, userId } = await seedProject();
  const created = await store.vault.create({
    projectId,
    name: "RACE",
    environment: "development",
    value: "v1",
    description: null,
    userId,
    now: now(),
  });
  await Promise.all(
    [2, 3, 4, 5].map((n) => store.vault.setValue(created.id, `v${n}`, userId, now())),
  );
  const kept = await store.vault.listVersions(created.id);
  assert.deepEqual(
    kept.map((row) => row.version),
    [5, 4, 3, 2, 1],
  );
});

test("removing a secret removes its history, and deleting the project removes both", async () => {
  const { projectId, userId } = await seedProject();
  const base = { projectId, environment: "development", value: "c", description: null, userId };
  const one = await store.vault.create({ ...base, name: "ONE", now: now() });
  await store.vault.create({ ...base, name: "TWO", now: now() });

  assert.equal(await store.vault.remove(one.id), true);
  assert.equal(await store.vault.remove(one.id), false);
  assert.deepEqual(await store.vault.listVersions(one.id), []);

  await store.projects.remove(projectId);
  assert.deepEqual(await store.vault.list(projectId), []);
});

test("a description change is not a new version", async () => {
  const { projectId, userId } = await seedProject();
  const created = await store.vault.create({
    projectId,
    name: "DESCRIBED",
    environment: "test",
    value: "c",
    description: null,
    userId,
    now: now(),
  });
  const updated = await store.vault.setDescription(created.id, "Payments", userId, now());
  assert.equal(updated?.description, "Payments");
  assert.equal(updated?.version, 1);
  assert.equal((await store.vault.listVersions(created.id)).length, 1);
});
