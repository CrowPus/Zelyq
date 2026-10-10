import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { newId, VAULT_VERSIONS_KEPT } from "@zelyq/core";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDatabase, createStore, runMigrations, type Store } from "../src/index.js";

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

const now = () => new Date().toISOString();

async function seedTeam(): Promise<{ teamId: string; projectId: string; userId: string }> {
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
    name: `App ${suffix}`,
    slug: `app-${suffix}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });
  return { teamId, projectId, userId };
}

function entry(scopeKey: string, teamId: string | null, name: string, value = "c1") {
  return {
    scopeKey,
    teamId,
    name,
    value,
    description: null,
    protected: false,
    userId: null,
    now: now(),
  };
}

test("a list of Vault entries never carries a value", async () => {
  const { teamId } = await seedTeam();
  await store.vault.create(entry(teamId, teamId, "STRIPE_KEY_LIVE"));
  const [row] = await store.vault.list(teamId);
  assert.equal(row?.name, "STRIPE_KEY_LIVE");
  assert.equal(row && "value" in row, false);
});

test("one name per team, the same name in another team, and one instance name space", async () => {
  const a = await seedTeam();
  const b = await seedTeam();
  await store.vault.create(entry(a.teamId, a.teamId, "SHARED"));
  await store.vault.create(entry(b.teamId, b.teamId, "SHARED"));
  await assert.rejects(() => store.vault.create(entry(a.teamId, a.teamId, "SHARED")));

  // The instance has no team, so uniqueness rests on the scope key, not team_id.
  await store.vault.create(entry("instance", null, "OPENAI"));
  await assert.rejects(() => store.vault.create(entry("instance", null, "OPENAI")));
});

test("each new value is a version, and only the newest are kept", async () => {
  const { teamId } = await seedTeam();
  const created = await store.vault.create(entry(teamId, teamId, "ROTATING", "v1"));
  const writes = VAULT_VERSIONS_KEPT + 4;
  for (let n = 2; n <= writes; n++) await store.vault.setValue(created.id, `v${n}`, null, now());
  assert.equal((await store.vault.findById(created.id))?.version, writes);
  const kept = await store.vault.listVersions(created.id);
  assert.equal(kept.length, VAULT_VERSIONS_KEPT);
  assert.equal(await store.vault.versionValue(created.id, 1), null);
  assert.equal(await store.vault.versionValue(created.id, writes), `v${writes}`);
});

test("concurrent writes each get their own version", async () => {
  const { teamId } = await seedTeam();
  const created = await store.vault.create(entry(teamId, teamId, "RACE"));
  await Promise.all(
    [2, 3, 4, 5].map((n) => store.vault.setValue(created.id, `v${n}`, null, now())),
  );
  assert.deepEqual(
    (await store.vault.listVersions(created.id)).map((row) => row.version),
    [5, 4, 3, 2, 1],
  );
});

test("a project variable is typed or points at Vault, and switching keeps typed history", async () => {
  const { projectId, userId } = await seedTeam();
  const typed = await store.vault.variables.create({
    projectId,
    name: "STRIPE_KEY",
    source: "direct",
    value: "cipher-1",
    vaultName: null,
    description: null,
    userId,
    now: now(),
  });
  const toVault = await store.vault.variables.setVaultSource(
    typed.id,
    "STRIPE_KEY_TEST",
    userId,
    now(),
  );
  assert.equal(toVault?.source, "vault");
  assert.equal(toVault?.value, null);
  assert.equal(toVault?.vaultName, "STRIPE_KEY_TEST");
  // The typed value it had is still restorable.
  assert.equal(await store.vault.variables.versionValue(typed.id, 1), "cipher-1");

  const back = await store.vault.variables.setDirectValue(typed.id, "cipher-2", userId, now());
  assert.equal(back?.source, "direct");
  assert.equal(back?.vaultName, null);
  assert.equal(back?.version, 3);
  assert.equal(
    (await store.vault.variables.list(projectId)).some((row) => "value" in row),
    false,
  );
});

test("a team's Vault usages name the project and the variable", async () => {
  const { teamId, projectId } = await seedTeam();
  await store.vault.variables.create({
    projectId,
    name: "PAYMENTS",
    source: "vault",
    value: null,
    vaultName: "STRIPE_KEY_LIVE",
    description: null,
    userId: null,
    now: now(),
  });
  const usages = await store.vault.teamUsages(teamId);
  assert.deepEqual(
    usages.map((u) => [u.projectId, u.variable, u.vaultName]),
    [[projectId, "PAYMENTS", "STRIPE_KEY_LIVE"]],
  );
});

test("deleting a team removes its Vault, deleting a project removes its variables", async () => {
  const { teamId, projectId } = await seedTeam();
  await store.vault.create(entry(teamId, teamId, "GONE"));
  await store.vault.variables.create({
    projectId,
    name: "ALSO_GONE",
    source: "direct",
    value: "c",
    vaultName: null,
    description: null,
    userId: null,
    now: now(),
  });
  await store.projects.remove(projectId);
  assert.deepEqual(await store.vault.variables.list(projectId), []);
  await store.teams.remove(teamId);
  assert.deepEqual(await store.vault.list(teamId), []);
});

test("service keys: found by hash, revoked once, used is recorded", async () => {
  const { teamId } = await seedTeam();
  const key = await store.vault.keys.create({
    id: newId("vaultServiceKey"),
    teamId,
    name: "CI",
    keyPrefix: "zvk_xxxxxxxx",
    keyHash: `hash-${teamId}`,
    scopes: JSON.stringify(["read"]),
    namePatterns: null,
    allowedIps: null,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    createdBy: null,
    createdAt: now(),
  });
  assert.equal((await store.vault.keys.findByHash(`hash-${teamId}`))?.id, key.id);
  await store.vault.keys.touch(key.id, now(), "203.0.113.9");
  const first = await store.vault.keys.revoke(key.id, "2026-01-01T00:00:00.000Z");
  const second = await store.vault.keys.revoke(key.id, "2027-01-01T00:00:00.000Z");
  assert.equal(first?.revokedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(second?.revokedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(second?.lastUsedIp, "203.0.113.9");
});

/**
 * The upgrade from the first Vault, which kept secrets per project and per
 * environment: build a database exactly as migration 0020 left it, put
 * secrets in it, then apply the rest.
 */
test("the per-project Vault upgrades: development to variables, the rest to Protected Vault", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-vault-upgrade-"));
  const url = `file:${dir}/upgrade.db`;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const full = path.resolve(here, "..", "drizzle", "sqlite");
  const upTo20 = path.join(dir, "migrations");
  await fs.cp(full, upTo20, { recursive: true });
  const journalPath = path.join(upTo20, "meta", "_journal.json");
  const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 20);
  await fs.writeFile(journalPath, JSON.stringify(journal));

  const before = createDatabase(url);
  await migrate(before.db, { migrationsFolder: upTo20 });
  const t = new Date().toISOString();
  for (const statement of [
    `INSERT INTO users (id, name, email, password_hash, instance_role, created_at, updated_at) VALUES ('usr_1','A','a@x.io','x','admin','${t}','${t}')`,
    `INSERT INTO teams (id, name, slug, created_at) VALUES ('tem_1','T','t','${t}')`,
    `INSERT INTO projects (id, team_id, name, slug, template, status, created_at, updated_at) VALUES ('prj_1','tem_1','P','p','vite-react','ready','${t}','${t}')`,
    // A development secret, its production twin, a test secret, and a
    // development secret whose name looks like a renamed test one.
    `INSERT INTO vault_secrets VALUES ('vsc_dev00001','prj_1','STRIPE_KEY','development','c-dev','Payments',2,'usr_1','usr_1','${t}','${t}')`,
    `INSERT INTO vault_secrets VALUES ('vsc_prod0001','prj_1','STRIPE_KEY','production','c-prod',NULL,1,'usr_1','usr_1','${t}','${t}')`,
    `INSERT INTO vault_secrets VALUES ('vsc_test0001','prj_1','MAIL','test','c-test',NULL,1,NULL,NULL,'${t}','${t}')`,
    `INSERT INTO vault_secrets VALUES ('vsc_clash001','prj_1','MAIL__TEST','development','c-clash',NULL,1,NULL,NULL,'${t}','${t}')`,
    `INSERT INTO vault_secret_versions VALUES ('vsv_1','vsc_dev00001',1,'c-dev-old','usr_1','${t}')`,
    `INSERT INTO vault_secret_versions VALUES ('vsv_2','vsc_dev00001',2,'c-dev','usr_1','${t}')`,
  ]) {
    await before.exec(statement);
  }
  await before.close();

  await runMigrations(url);
  const after = createStore(url);
  try {
    // Development values reached the app: they are the project's variables now.
    const rows = await after.vault.variables.listWithValues("prj_1");
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    assert.deepEqual(Object.keys(byName).sort(), ["MAIL__TEST", "STRIPE_KEY"]);
    assert.equal(byName.STRIPE_KEY?.value, "c-dev");
    assert.equal(byName.STRIPE_KEY?.description, "Payments");
    assert.equal(byName.STRIPE_KEY?.source, "direct");
    assert.equal(byName.MAIL__TEST?.value, "c-clash");
    assert.equal(await after.vault.variables.versionValue("vsc_dev00001", 1), "c-dev-old");

    // Test and production values reached nothing: they are kept in the team
    // Vault, Protected, and given to no app.
    const vault = await after.vault.list("tem_1");
    assert.deepEqual(vault.map((entry) => [entry.name, entry.protected]).sort(), [
      ["MAIL__TEST__p-test0001", true],
      ["STRIPE_KEY__PRODUCTION__p-prod0001", true],
    ]);
    const prod = await after.vault.findByName("tem_1", "STRIPE_KEY__PRODUCTION__p-prod0001");
    assert.equal(prod?.value, "c-prod");
    assert.equal(prod?.teamId, "tem_1");
    assert.equal(await after.vault.versionValue(prod?.id ?? "", 1), null);

    // And the old tables are gone.
    await assert.rejects(() => after.exec("SELECT 1 FROM vault_secrets"));
  } finally {
    await after.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
