import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { detectDialect, resolveDatabaseUrl, SQLITE_BUSY_TIMEOUT_MS } from "./client.js";

/**
 * A consistent copy of the SQLite database, safe to take while the server and
 * the agent are running.
 *
 * Copying `zelyq.db` with `cp` is no longer a backup: the file is in WAL mode
 * (see `createDatabase`), so recent writes live in `zelyq.db-wal` until a
 * checkpoint folds them in. Found in review: the main file was hours behind.
 * `VACUUM INTO` writes one self-contained file from a single consistent
 * snapshot, the WAL's contents included.
 *
 * Without a destination the copy goes to `backups/` beside the database, named
 * by the time it was taken — `data/backups/zelyq-<time>.db` by default.
 */
export async function backupDatabase(databaseUrl: string, destination?: string): Promise<string> {
  if (detectDialect(databaseUrl) !== "sqlite") {
    throw new Error("Only a SQLite database is backed up here; use pg_dump for PostgreSQL.");
  }
  const resolved = resolveDatabaseUrl(databaseUrl);
  if (!resolved.startsWith("file:")) {
    throw new Error("Only a local SQLite file is backed up here.");
  }
  const source = resolved.slice("file:".length);
  const target = path.resolve(
    destination ??
      path.join(
        path.dirname(source),
        "backups",
        `${path.basename(source, ".db")}-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
      ),
  );
  // `VACUUM INTO` refuses an existing file anyway; saying so first is clearer.
  if (existsSync(target)) throw new Error(`${target} already exists; not overwriting it.`);
  mkdirSync(path.dirname(target), { recursive: true });

  const client = createClient({ url: resolved, timeout: SQLITE_BUSY_TIMEOUT_MS });
  try {
    await client.execute({ sql: "VACUUM INTO ?", args: [target] });
  } finally {
    client.close();
  }
  return target;
}

const isEntrypoint = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isEntrypoint) {
  const url = process.env.DATABASE_URL ?? "file:./data/zelyq.db";
  // pnpm runs this from packages/db; a path the person typed is relative to
  // where they typed it.
  const destination = process.argv[2]
    ? path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2])
    : undefined;
  backupDatabase(url, destination)
    .then((target) => {
      console.log(`Backed up to ${target}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Backup failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
