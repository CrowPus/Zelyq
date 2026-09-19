import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDatabase, SQLITE_BUSY_TIMEOUT_MS } from "../src/client.js";

/**
 * The Zelyq server and agent are separate processes on one SQLite file. With
 * libsql's default busy timeout of 0, a write that met another process's lock
 * failed at once with SQLITE_BUSY — found live, that turned every signed-in
 * request into a 500 and blacked out the editor.
 */

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function scratchDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-sqlite-"));
  return path.join(dir, "zelyq.db");
}

/** Hold the database's write lock from ANOTHER process for `ms`, the way a
 * second Zelyq process does. Resolves once the lock is held. */
function holdWriteLock(file: string, ms: number): Promise<() => Promise<void>> {
  const script = `
    import { createClient } from "@libsql/client";
    const c = createClient({ url: ${JSON.stringify(`file:${file}`)} });
    // transaction("write"), not a bare BEGIN through execute(): libsql only
    // really holds the write lock on its own transaction path.
    const tx = await c.transaction("write");
    await tx.execute("INSERT INTO t (x) VALUES (1)");
    process.stdout.write("locked\\n");
    setTimeout(async () => { await tx.commit(); process.exit(0); }, ${ms});
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: PACKAGE_DIR,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const done = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  return new Promise((resolve, reject) => {
    child.stdout.on("data", (data: Buffer) => {
      if (data.toString().includes("locked")) resolve(() => done);
    });
    child.on("error", reject);
  });
}

test("every connection waits for a lock rather than failing at once", async () => {
  const handle = createDatabase(`file:${await scratchDb()}`);
  const [row] = await handle.db.all<{ timeout: number }>(sql`PRAGMA busy_timeout`);
  assert.equal(row?.timeout, SQLITE_BUSY_TIMEOUT_MS);
  await handle.close();
});

test("the database is switched to WAL, so readers are not blocked by a writer", async () => {
  const file = await scratchDb();
  const handle = createDatabase(`file:${file}`);
  await handle.exec("SELECT 1");
  const [row] = await handle.db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
  assert.equal(row?.journal_mode, "wal");
  await handle.close();
});

test("a write that meets another process's lock waits for it, instead of a 500", async () => {
  const file = await scratchDb();
  const setup = createDatabase(`file:${file}`);
  await setup.exec("CREATE TABLE t (x INTEGER)");
  await setup.close();

  // Another process takes the write lock and keeps it for a moment.
  const released = await holdWriteLock(file, 400);

  const handle = createDatabase(`file:${file}`);
  const started = Date.now();
  // Before the fix this threw SQLITE_BUSY immediately.
  await handle.exec("INSERT INTO t (x) VALUES (2)");
  const waited = Date.now() - started;

  const [row] = await handle.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM t`);
  assert.equal(row?.n, 2, "both writes landed");
  assert.ok(waited >= 100, `the write waited for the lock (${waited}ms) rather than failing`);
  await released();
  await handle.close();
});
