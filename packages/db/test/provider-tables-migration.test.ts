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

test("a fresh database ends with the provider_connections shape: the server's own or a team's", async () => {
  const url = `file:${path.join(tmp, "fresh.db")}`;
  await runMigrations(url);
  const cols = await columns(url, "provider_connections");
  // 0010 made the connection the server's; 0060 lets a team own one again
  // (team_id nullable: null is the server's own).
  assert.ok(cols.includes("team_id"), `team_id should be back, got: ${cols.join(",")}`);
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
    "team_id",
  ]);
});

test("a database that already ran the team-scoped 0009 is reconciled by 0010", async () => {
  const url = `file:${path.join(tmp, "legacy.db")}`;
  const c = createClient({ url });
  // Simulate: everything up to and including the ORIGINAL team-scoped 0009,
  // recorded as applied so the migrator skips straight to 0010.
  await c.execute(`CREATE TABLE users (id text primary key)`);
  await c.execute(`CREATE TABLE teams (id text primary key)`);
  // Every real database has it (0002); 0052 reads it to give old Studio items a team.
  await c.execute(`CREATE TABLE team_members (team_id text, user_id text, joined_at text)`);
  // name and slug come from 0000 and team_id from 0002, so a database that
  // ran 0009 has them — and 0021 reads them when it moves old secrets.
  await c.execute(
    `CREATE TABLE projects (id text primary key, name text not null default '', slug text not null default '', team_id text not null default '')`,
  );
  // A DB that ran everything up to 0009 has this from 0000; later migrations
  // (0011) alter it.
  await c.execute(`CREATE TABLE messages (id text primary key)`);
  // From 0000 too; 0061 adds the device columns to it.
  await c.execute(`CREATE TABLE auth_sessions (id text primary key)`);
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
  // 0010 dropped 0009's required team_id; 0060 brings it back optional.
  assert.ok(cols.includes("team_id"), `team_id should be back, got: ${cols.join(",")}`);
  assert.ok(cols.includes("provider"));
  const c2 = createClient({ url });
  try {
    const info = await c2.execute(`PRAGMA table_info(provider_connections)`);
    const teamId = info.rows.find((r) => String(r.name) === "team_id");
    assert.equal(Number(teamId?.notnull), 0, "team_id is optional: null is the server's own");
  } finally {
    c2.close();
  }
});
