import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
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

async function withTable(): Promise<{ file: string; handle: ReturnType<typeof createDatabase> }> {
  const file = await scratchDb();
  const handle = createDatabase(`file:${file}`);
  await handle.exec("CREATE TABLE t (x INTEGER PRIMARY KEY, v TEXT)");
  await handle.exec("INSERT INTO t VALUES (100, 'old')");
  return { file, handle };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a write that meets an open transaction waits its turn, and the server does not stand still", async () => {
  const { handle } = await withTable();
  const started = Date.now();
  let readDuring = 0;
  const transaction = handle.db.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO t VALUES (1, 'a')`);
    await pause(100);
    await tx.run(sql`INSERT INTO t VALUES (2, 'b')`);
  });
  await pause(20);
  const write = handle.db.all(sql`UPDATE t SET v = 'new' WHERE x = 100 RETURNING v`);
  const second = handle.db.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO t VALUES (3, 'c')`);
  });
  await handle.db.all(sql`SELECT * FROM t`);
  readDuring = Date.now() - started;
  await Promise.all([transaction, write, second]);
  assert.ok(readDuring < 100, `a read does not wait for the transaction (${readDuring} ms)`);
  assert.ok(Date.now() - started < 2000, "no busy timeout was waited out");
  const rows = await handle.db.all<{ x: number }>(sql`SELECT x FROM t ORDER BY x`);
  assert.deepEqual(
    rows.map((row) => row.x),
    [1, 2, 3, 100],
  );
  await handle.close();
});

test("a transaction that fails gives up its turn", async () => {
  const { handle } = await withTable();
  await assert.rejects(
    handle.db.transaction(async (tx) => {
      await tx.run(sql`INSERT INTO t VALUES (1, 'a')`);
      throw new Error("no");
    }),
    /no/,
  );
  await handle.db.run(sql`INSERT INTO t VALUES (2, 'b')`);
  const rows = await handle.db.all(sql`SELECT x FROM t`);
  assert.equal(rows.length, 2);
  await handle.close();
});

test("a write round an open transaction is refused at once rather than waited for for ever", async () => {
  const { handle } = await withTable();
  await handle.db.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO t VALUES (1, 'a')`);
    await assert.rejects(
      Promise.resolve(handle.db.run(sql`INSERT INTO t VALUES (2, 'b')`)),
      (error: Error) => /must use the transaction/.test(`${error.message} ${error.cause}`),
    );
  });
  // Also when the work hands back the query for the transaction to run.
  await assert.rejects(
    handle.db.transaction(() => handle.db.run(sql`INSERT INTO t VALUES (2, 'b')`)),
    (error: Error) => /must use the transaction/.test(`${error.message} ${error.cause}`),
  );
  await handle.db.run(sql`INSERT INTO t VALUES (3, 'c')`);
  await handle.close();
});

test("after another process held the lock too long, later writes are really saved", async () => {
  const { file, handle } = await withTable();
  // The same file by another path's client: the lock, held past the busy timeout.
  const other = createClient({ url: `file:${file}` });
  const held = await other.transaction("write");
  await held.execute("INSERT INTO t VALUES (1, 'theirs')");
  await assert.rejects(
    Promise.resolve(handle.db.all(sql`UPDATE t SET v = 'z' WHERE x = 100 RETURNING v`)),
  );
  // Reads carry on meanwhile.
  await Promise.all(
    Array.from({ length: 50 }, () => handle.db.all(sql`SELECT * FROM t WHERE x = 100`)),
  );
  await held.commit();
  for (const value of ["one", "two", "three"]) {
    await handle.db.all(sql`UPDATE t SET v = ${value} WHERE x = 100 RETURNING v`);
    const onDisk = await other.execute("SELECT v FROM t WHERE x = 100");
    assert.equal(onDisk.rows[0]?.v, value);
  }
  await handle.db.transaction(async (tx) => {
    await tx.run(sql`INSERT INTO t VALUES (2, 'b')`);
  });
  other.close();
  await handle.close();
});
