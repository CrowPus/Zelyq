import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveFromRepoRoot } from "../src/paths.js";

// This test file is packages/core/test/ — the repo root is three up.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("a relative path resolves against the repo root, not the cwd", () => {
  const original = process.cwd();
  try {
    // `pnpm --filter <app> <script>` runs each app from its own package dir,
    // so a bare relative ZELYQ_WORKSPACE_DIR would otherwise differ per process.
    process.chdir(path.join(REPO_ROOT, "packages", "core"));
    assert.equal(resolveFromRepoRoot("workspace"), path.join(REPO_ROOT, "workspace"));
    assert.equal(resolveFromRepoRoot("./data/skills"), path.join(REPO_ROOT, "data", "skills"));
  } finally {
    process.chdir(original);
  }
});

test("an absolute path is returned unchanged", () => {
  const abs = path.join(path.sep, "data", "workspace");
  assert.equal(resolveFromRepoRoot(abs), abs);
});
