import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { backupDatabase } from "../src/backup.js";

test("a backup taken while the database is open includes writes still in the WAL", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-backup-"));
  const source = path.join(dir, "zelyq.db");
  // Stays open for the whole test, as the server's connection does — so
  // nothing checkpoints the WAL back into the main file behind our back.
  const live = createClient({ url: `file:${source}` });
  try {
    await live.execute("PRAGMA journal_mode=WAL");
    await live.execute("PRAGMA wal_autocheckpoint=0");
    await live.execute("CREATE TABLE notes (body TEXT)");
    await live.execute("INSERT INTO notes VALUES ('written just now')");
    assert.ok(existsSync(`${source}-wal`), "the write is sitting in the WAL");

    const target = await backupDatabase(`file:${source}`);
    assert.equal(path.dirname(target), path.join(dir, "backups"));

    const copy = createClient({ url: `file:${target}` });
    try {
      const rows = await copy.execute("SELECT body FROM notes");
      assert.deepEqual(
        rows.rows.map((row) => row.body),
        ["written just now"],
      );
    } finally {
      copy.close();
    }

    await assert.rejects(() => backupDatabase(`file:${source}`, target), /already exists/);
  } finally {
    live.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a PostgreSQL database is pointed at pg_dump rather than copied", async () => {
  await assert.rejects(() => backupDatabase("postgres://u:p@db.example.com/app"), /pg_dump/);
});
