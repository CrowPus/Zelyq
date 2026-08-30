import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { detectDialect, redact, resolveDatabaseUrl } from "../src/client.js";

// This test file is packages/db/test/ — the repo root is three up.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("dialect is derived from the connection string", () => {
  assert.equal(detectDialect("file:./data/zelyq.db"), "sqlite");
  assert.equal(detectDialect("libsql://example.turso.io"), "sqlite");
  assert.equal(detectDialect("postgres://user:pw@host:5432/zelyq"), "postgres");
  assert.equal(detectDialect("postgresql://user:pw@host:5432/zelyq"), "postgres");
});

test("an unsupported url fails loudly, with the password hidden", () => {
  assert.throws(
    () => detectDialect("mysql://user:hunter2@host/db"),
    (error: Error) => {
      assert.ok(!error.message.includes("hunter2"), "password leaked into the error message");
      return true;
    },
  );
});

test("redact strips credentials for logging", () => {
  assert.ok(!redact("postgres://user:hunter2@host:5432/zelyq").includes("hunter2"));
  assert.equal(redact("file:./data/zelyq.db"), "file:./data/zelyq.db");
});

test("a relative file: path resolves against the repo root, not the cwd", () => {
  // Under `pnpm --filter <pkg> <script>` the cwd is the package dir, so a bare
  // relative path would name a different file per app.
  assert.equal(
    resolveDatabaseUrl("file:./data/zelyq.db"),
    `file:${path.join(REPO_ROOT, "data", "zelyq.db")}`,
  );
  assert.equal(
    resolveDatabaseUrl("file:data/zelyq.db"),
    `file:${path.join(REPO_ROOT, "data", "zelyq.db")}`,
  );
});

test("an absolute file: path and non-file URLs pass through unchanged", () => {
  const abs = `file:${path.join(path.sep, "var", "lib", "zelyq", "zelyq.db")}`;
  assert.equal(resolveDatabaseUrl(abs), abs);
  assert.equal(resolveDatabaseUrl("libsql://example.turso.io"), "libsql://example.turso.io");
  assert.equal(
    resolveDatabaseUrl("postgres://user:pw@host:5432/zelyq"),
    "postgres://user:pw@host:5432/zelyq",
  );
});
