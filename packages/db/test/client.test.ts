import assert from "node:assert/strict";
import { test } from "node:test";
import { detectDialect, redact } from "../src/client.js";

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
