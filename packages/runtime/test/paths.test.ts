import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { isIgnored, resolveInside, toPosix } from "../src/paths.js";

const ROOT = "/tmp/zelyq-test/prj_1";

test("resolves ordinary paths inside the root", () => {
  assert.equal(resolveInside(ROOT, "src/App.tsx"), path.join(ROOT, "src/App.tsx"));
  assert.equal(resolveInside(ROOT, "./src/../package.json"), path.join(ROOT, "package.json"));
});

test("rejects traversal instead of clamping it", () => {
  assert.throws(() => resolveInside(ROOT, "../secrets.env"), /escapes the project root/);
  assert.throws(() => resolveInside(ROOT, "src/../../../etc/passwd"), /escapes the project root/);
  assert.throws(() => resolveInside(ROOT, "/etc/passwd"), /escapes the project root/);
});

test("rejects null bytes", () => {
  assert.throws(() => resolveInside(ROOT, "src/App\0.tsx"), /null byte/);
});

test("a sibling directory sharing the root prefix is still outside", () => {
  assert.throws(() => resolveInside("/tmp/zelyq-test/prj_1", "../prj_1-backup/x"), /escapes/);
});

test("ignored directories are excluded from the tree", () => {
  assert.ok(isIgnored("node_modules"));
  assert.ok(isIgnored(".git"));
  assert.ok(!isIgnored("src"));
});

test("paths are reported in posix form", () => {
  assert.equal(toPosix(path.join("src", "components", "App.tsx")), "src/components/App.tsx");
});
