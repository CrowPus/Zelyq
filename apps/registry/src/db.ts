import { mkdirSync } from "node:fs";
import path from "node:path";
import { type Client, createClient, type InValue } from "@libsql/client";

/**
 * The registry's own database: SQLite, one file, beside the packages and the
 * signing key. It runs only on our server, so it is plain SQL — no second
 * dialect to keep in step.
 */
export interface RegistryDb {
  all<T>(sql: string, args?: InValue[]): Promise<T[]>;
  get<T>(sql: string, args?: InValue[]): Promise<T | null>;
  run(sql: string, args?: InValue[]): Promise<number>;
  close(): void;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
     token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS installations (
     id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, zelyq_version TEXT,
     created_at TEXT NOT NULL, last_seen_at TEXT, blocked_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS plugins (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS versions (
     plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE, version TEXT NOT NULL,
     sha256 TEXT NOT NULL, signature TEXT NOT NULL, key_id TEXT NOT NULL, size_bytes INTEGER NOT NULL,
     manifest TEXT NOT NULL, readme TEXT NOT NULL, changelog TEXT,
     published_by TEXT NOT NULL, published_at TEXT NOT NULL,
     yanked_at TEXT, yanked_reason TEXT,
     PRIMARY KEY (plugin_id, version))`,
  `CREATE TABLE IF NOT EXISTS downloads (
     plugin_id TEXT NOT NULL, version TEXT NOT NULL, installation_id TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
     detail TEXT NOT NULL, at TEXT NOT NULL)`,
];

export async function openRegistryDb(dataDir: string): Promise<RegistryDb> {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const client: Client = createClient({ url: `file:${path.join(dataDir, "registry.db")}` });
  await client.execute("PRAGMA foreign_keys = ON");
  for (const statement of SCHEMA) await client.execute(statement);
  return {
    async all<T>(sql: string, args: InValue[] = []) {
      return (await client.execute({ sql, args })).rows as unknown as T[];
    },
    async get<T>(sql: string, args: InValue[] = []) {
      return ((await client.execute({ sql, args })).rows[0] as unknown as T) ?? null;
    },
    async run(sql: string, args: InValue[] = []) {
      return (await client.execute({ sql, args })).rowsAffected;
    },
    close: () => client.close(),
  };
}
