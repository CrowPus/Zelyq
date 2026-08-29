import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createClient } from "@libsql/client";
import { runMigrations } from "../src/index.js";

/**
 * The four provider_* tables were reshaped (the connection went
 * instance-wide, losing `team_id`) via migration 0010. This proves 0010
 * lands the final shape both on a fresh database and on one that already
 * ran the earlier team-scoped 0009.
 */

const tmp = path.join(os.tmpdir(), `zelyq-provider-mig-${Date.now()}`);

before(() => fs.mkdir(tmp, { recursive: true }));
after(() => fs.rm(tmp, { recursive: true, force: true }));

async function columns(url: string, table: string): Promise<string[]> {
  const c = createClient({ url });
  try {
    const res = await c.execute(`select name from pragma_table_info('${table}')`);
    return res.rows.map((r) => String(r.name)).sort();
  } finally {
    c.close();
  }
}

test("a fresh database ends with the instance-wide provider_connections shape", async () => {
  const url = `file:${path.join(tmp, "fresh.db")}`;
  await runMigrations(url);
  const cols = await columns(url, "provider_connections");
  assert.ok(!cols.includes("team_id"), `team_id should be gone, got: ${cols.join(",")}`);
  assert.deepEqual(cols, [
    "created_at",
    "created_by",
    "credential_type",
    "encrypted_blob",
    "expires_at",
    "granted_scopes",
    "id",
    "last_used_at",
    "provider",
    "status",
  ]);
});

test("a database that already ran the team-scoped 0009 is reconciled by 0010", async () => {
  const url = `file:${path.join(tmp, "legacy.db")}`;
  const c = createClient({ url });
  // Simulate: everything up to and including the ORIGINAL team-scoped 0009,
  // recorded as applied so the migrator skips straight to 0010.
  await c.execute(`CREATE TABLE users (id text primary key)`);
  await c.execute(`CREATE TABLE teams (id text primary key)`);
  await c.execute(`CREATE TABLE projects (id text primary key)`);
  await c.execute(
    `CREATE TABLE provider_connections (
       id text primary key, team_id text not null, provider text not null,
       credential_type text not null, encrypted_blob text not null,
       granted_scopes text default '' not null, expires_at text,
       status text default 'active' not null, created_by text not null,
       created_at text not null, last_used_at text)`,
  );
  await c.execute(
    `CREATE TABLE provider_resources (id text primary key, connection_id text not null)`,
  );
  await c.execute(`CREATE TABLE project_provider_links (zelyq_project_id text primary key)`);
  await c.execute(`CREATE TABLE provider_operations (id text primary key)`);
  await c.execute(
    `CREATE TABLE __drizzle_migrations (id integer primary key autoincrement, hash text not null, created_at numeric)`,
  );
  // Any created_at below 0010's journal `when` (1787918832923).
  await c.execute(
    `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('legacy-0009', 1787918831923)`,
  );
  c.close();

  await runMigrations(url);

  const cols = await columns(url, "provider_connections");
  assert.ok(!cols.includes("team_id"), `0010 should have dropped team_id, got: ${cols.join(",")}`);
  assert.ok(cols.includes("provider"));
});
