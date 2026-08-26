import { z } from "zod";
import { exec, jsonOutput, quote, readText } from "./lib/shared.mjs";

const sqlitePath = z.string().regex(/\.(db|sqlite|sqlite3)$/i, "Expected a SQLite database file");
export default [
  {
    name: "inspect_database_schema",
    description: "Inspect a project-local SQLite schema without modifying the database.",
    schema: z.object({ database: sqlitePath }),
    async run(context, input) {
      return exec(
        context,
        `sqlite3 -readonly -json ${quote(input.database)} ${quote("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name;")}`,
        30000,
      );
    },
  },
  {
    name: "run_readonly_query",
    description:
      "Run exactly one read-only SELECT, WITH, EXPLAIN, or PRAGMA query against a project-local SQLite database.",
    schema: z.object({
      database: sqlitePath,
      query: z.string().min(1).max(20000),
      limit: z.number().int().min(1).max(1000).default(200),
    }),
    async run(context, input) {
      const normalized = input.query.trim().replace(/;+$/, "");
      if (
        !/^(select|with|explain|pragma)\b/i.test(normalized) ||
        /\b(insert|update|delete|drop|alter|attach|detach|replace|vacuum|reindex|create)\b/i.test(
          normalized,
        )
      )
        return { output: "Refused: query is not read-only.", isError: true };
      const query = /^(select|with)\b/i.test(normalized)
        ? `SELECT * FROM (${normalized}) LIMIT ${input.limit}`
        : normalized;
      return exec(
        context,
        `sqlite3 -readonly -json ${quote(input.database)} ${quote(query)}`,
        30000,
      );
    },
  },
  {
    name: "explain_database_query",
    description: "Return SQLite's query plan for a read-only SQL statement.",
    schema: z.object({ database: sqlitePath, query: z.string().min(1).max(20000) }),
    async run(context, input) {
      if (!/^(select|with)\b/i.test(input.query.trim()))
        return { output: "Only SELECT or WITH statements can be explained.", isError: true };
      return exec(
        context,
        `sqlite3 -readonly ${quote(input.database)} ${quote(`EXPLAIN QUERY PLAN ${input.query.replace(/;+$/, "")}`)}`,
        30000,
      );
    },
  },
  {
    name: "database_migration_status",
    description:
      "Inspect migration files and migration-related package scripts without applying migrations.",
    schema: z.object({}),
    async run(context) {
      const entries = await context.runtime.listFiles(context.projectId, { depth: 12 });
      const migrationFiles = entries
        .filter(
          (e) => e.type !== "directory" && /(^|\/)(migrations?|drizzle|prisma)\//i.test(e.path),
        )
        .map((e) => e.path)
        .slice(0, 500);
      const pkg = JSON.parse((await readText(context, "package.json")) ?? "null");
      return jsonOutput({
        migrationFiles,
        scripts: Object.fromEntries(
          Object.entries(pkg?.scripts ?? {}).filter(([name]) => /migrat|schema|db:/.test(name)),
        ),
      });
    },
  },
];
