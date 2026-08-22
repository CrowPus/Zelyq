import { createClient } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as pgSchema from "./schema/pg.js";
import * as sqliteSchema from "./schema/sqlite.js";

export type Dialect = "sqlite" | "postgres";

/**
 * Repositories are written once, against the SQLite-typed Drizzle client.
 *
 * Drizzle types a database by dialect, so a single repository cannot be typed
 * for both without generics leaking into every call site. Since the two schemas
 * are column-identical (enforced by `test/schema-parity.test.ts`) and the
 * queries used here are plain CRUD that both dialects compile the same way, the
 * PostgreSQL client is presented under the SQLite type at exactly one place:
 * the cast below. Nothing downstream needs to know which one it got.
 *
 * The rule that keeps this honest: repositories may only use portable Drizzle
 * operations. Anything dialect-specific belongs behind `dialect` checks here,
 * not in a repository.
 */
export type ZelyqDb = LibSQLDatabase<typeof sqliteSchema>;

export interface DatabaseHandle {
  db: ZelyqDb;
  dialect: Dialect;
  /**
   * Runs a statement as written. For maintenance and for tests that need to
   * exercise migration SQL directly — never for request handling, which goes
   * through the repositories so the dialects stay interchangeable.
   */
  exec(statement: string): Promise<void>;
  /** Where the data lives, with credentials stripped — safe to log. */
  describe(): string;
  close(): Promise<void>;
}

export function detectDialect(url: string): Dialect {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgres";
  if (url.startsWith("file:") || url.startsWith("libsql://") || url.endsWith(".db"))
    return "sqlite";
  throw new Error(
    `Unsupported DATABASE_URL: ${redact(url)}. Use file:./data/zelyq.db or postgres://…`,
  );
}

export function createDatabase(url: string): DatabaseHandle {
  const dialect = detectDialect(url);

  if (dialect === "postgres") {
    const sql = postgres(url, { max: 10, idle_timeout: 30 });
    const db = drizzlePostgres(sql, { schema: pgSchema });
    return {
      db: db as unknown as ZelyqDb,
      dialect,
      // postgres.js: `unsafe` is its raw path. The statement is written by
      // this codebase, never assembled from request input.
      exec: async (statement: string) => {
        await sql.unsafe(statement);
      },
      describe: () => redact(url),
      close: async () => {
        await sql.end({ timeout: 5 });
      },
    };
  }

  const client = createClient({ url });
  const db = drizzleLibsql(client, { schema: sqliteSchema });
  return {
    db,
    dialect,
    exec: async (statement: string) => {
      await client.execute(statement);
    },
    describe: () => redact(url),
    close: async () => {
      client.close();
    },
  };
}

/**
 * Never let a password reach a log line.
 *
 * Only URLs that can carry credentials are parsed. Running a relative SQLite
 * path through `new URL` would rewrite `file:./data/zelyq.db` as
 * `file:///data/zelyq.db` — a different, wrong path in every log line and error
 * message that quotes it.
 */
export function redact(url: string): string {
  if (!url.includes("@") || !url.includes("://")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    // Unparseable and credential-shaped: drop everything before the "@".
    return url.replace(/\/\/[^@/]*@/, "//***@");
  }
}
