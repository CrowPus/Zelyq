import assert from "node:assert/strict";
import { test } from "node:test";
import { getTableColumns } from "drizzle-orm";
import * as pg from "../src/schema/pg.js";
import * as sqlite from "../src/schema/sqlite.js";

/**
 * The SQLite and PostgreSQL schemas are maintained by hand so both dialects
 * stay first-class. This test is what stops them drifting: add a column to one
 * and forget the other, and the build fails here rather than in production on
 * whichever dialect you do not run locally.
 */
const TABLES = [
  "users",
  "teams",
  "teamMembers",
  "authSessions",
  "projects",
  "sessions",
  "messages",
  "snapshots",
  "settings",
  "auditLog",
] as const;

for (const name of TABLES) {
  test(`${name}: both dialects declare the same columns`, () => {
    const sqliteColumns = getTableColumns(sqlite.schema[name]);
    const pgColumns = getTableColumns(pg.schema[name]);

    assert.deepEqual(
      Object.keys(sqliteColumns).sort(),
      Object.keys(pgColumns).sort(),
      `${name} column names differ between dialects`,
    );

    for (const [key, sqliteColumn] of Object.entries(sqliteColumns)) {
      const pgColumn = pgColumns[key as keyof typeof pgColumns];
      assert.equal(sqliteColumn.name, pgColumn.name, `${name}.${key} maps to a different column`);
      assert.equal(
        sqliteColumn.notNull,
        pgColumn.notNull,
        `${name}.${key} nullability differs between dialects`,
      );
      assert.equal(
        sqliteColumn.primary,
        pgColumn.primary,
        `${name}.${key} primary-key flag differs between dialects`,
      );
      assert.deepEqual(
        sqliteColumn.default,
        pgColumn.default,
        `${name}.${key} default differs between dialects`,
      );
    }
  });
}
