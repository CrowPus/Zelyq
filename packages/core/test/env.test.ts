import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadEnvFile } from "../src/env.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zelyq-env-"));
const nested = path.join(root, "apps", "server");
fs.mkdirSync(nested, { recursive: true });
fs.writeFileSync(
  path.join(root, ".env"),
  "ZELYQ_TEST_FROM_FILE=from_file\nZELYQ_TEST_ALREADY_SET=from_file\n",
);

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("finds .env by walking up from the process directory", () => {
  // Each app runs with its own package as the cwd, so the repo's .env is
  // several levels above — assuming it sits next to the process would mean
  // only the root-launched process ever saw it.
  process.env.ZELYQ_TEST_ALREADY_SET = "from_environment";
  const found = loadEnvFile(nested);

  assert.equal(found, path.join(root, ".env"));
  assert.equal(process.env.ZELYQ_TEST_FROM_FILE, "from_file");
});

test("a real environment variable beats the file", () => {
  // Deployments set variables directly; the file must never override them.
  assert.equal(process.env.ZELYQ_TEST_ALREADY_SET, "from_environment");
});

test("no .env anywhere is not an error", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "zelyq-noenv-"));
  try {
    assert.equal(loadEnvFile(empty), null);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
