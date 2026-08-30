import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as migrateLibsql } from "drizzle-orm/libsql/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, detectDialect } from "./client.js";

/**
 * Applies pending migrations, then exits. Safe to run on every boot: Drizzle
 * records what it has applied and skips the rest.
 *
 * A relative `file:` path is resolved against the repo root and its parent
 * directory is created — both handled by `createDatabase` below, so a fresh
 * clone with no `./data` works.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const dialect = detectDialect(databaseUrl);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(
    here,
    "..",
    "drizzle",
    dialect === "postgres" ? "pg" : "sqlite",
  );

  const handle = createDatabase(databaseUrl);
  try {
    if (dialect === "postgres") {
      // The cast mirrors the one in client.ts: same schema, different dialect type.
      await migratePostgres(handle.db as never, { migrationsFolder });
    } else {
      await migrateLibsql(handle.db, { migrationsFolder });
    }
  } finally {
    await handle.close();
  }
}

const isEntrypoint = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isEntrypoint) {
  const url = process.env.DATABASE_URL ?? "file:./data/zelyq.db";
  runMigrations(url)
    .then(() => {
      console.log(`Migrations applied (${detectDialect(url)}).`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
