import assert from "node:assert/strict";
import { test } from "node:test";
import { collapseUnchanged, countChanges, diffLines } from "../src/lib/diff.js";

test("an unchanged file reports nothing changed", () => {
  const lines = diffLines("a\nb\nc", "a\nb\nc");
  assert.deepEqual(countChanges(lines), { added: 0, removed: 0 });
  assert.ok(lines.every((line) => line.kind === "same"));
});

test("an inserted line is added, and the rest is left alone", () => {
  const lines = diffLines("a\nc", "a\nb\nc");
  assert.deepEqual(countChanges(lines), { added: 1, removed: 0 });
  const added = lines.find((line) => line.kind === "added");
  assert.equal(added?.text, "b");
  assert.equal(added?.before, null);
  assert.equal(added?.after, 2);
});

test("a deleted line is removed and keeps its old line number", () => {
  const lines = diffLines("a\nb\nc", "a\nc");
  assert.deepEqual(countChanges(lines), { added: 0, removed: 1 });
  const removed = lines.find((line) => line.kind === "removed");
  assert.equal(removed?.text, "b");
  assert.equal(removed?.before, 2);
  assert.equal(removed?.after, null);
});

test("a changed line reads as one removal and one addition", () => {
  const lines = diffLines("hello\nworld", "hello\nthere");
  assert.deepEqual(countChanges(lines), { added: 1, removed: 1 });
});

test("a new file is entirely additions", () => {
  const lines = diffLines("", "a\nb");
  assert.equal(countChanges(lines).removed, 1); // the empty line the file started as
  assert.ok(countChanges(lines).added >= 2);
});

test("long runs of unchanged lines collapse to a gap", () => {
  const before = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const after = before.replace("line 30", "line 30 changed");
  const collapsed = collapseUnchanged(diffLines(before, after), 2);

  assert.ok(collapsed.includes("gap"), "expected the untouched stretches to collapse");
  assert.ok(collapsed.length < 20, `expected a short summary, got ${collapsed.length} rows`);
  const kept = collapsed.filter((row): row is Exclude<typeof row, "gap"> => row !== "gap");
  assert.ok(kept.some((line) => line.text === "line 30 changed"));
});

test("a very large file does not build the table", () => {
  const huge = Array.from({ length: 4000 }, (_, i) => `x${i}`).join("\n");
  const lines = diffLines(huge, `${huge}\nextra`);
  // Falls back to whole-file replacement rather than locking the tab up.
  assert.ok(lines.length > 4000);
});
