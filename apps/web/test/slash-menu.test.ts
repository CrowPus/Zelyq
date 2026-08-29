import assert from "node:assert/strict";
import { test } from "node:test";
import { findSlashCommand, matchByPrefix, replaceSlashCommand } from "../src/lib/slash-menu.js";

// ---------------------------------------------------------------------------
// findSlashCommand
// ---------------------------------------------------------------------------

test("no slash anywhere before the cursor means no command", () => {
  assert.equal(findSlashCommand("design my website", 18), null);
  assert.equal(findSlashCommand("", 0), null);
});

test("a slash at the very start still works — the original, narrower behaviour", () => {
  const result = findSlashCommand("/strip", 6);
  assert.deepEqual(result, { query: "strip", start: 0, end: 6 });
});

test("a slash in the middle of the message is found — the actual bug this fixes", () => {
  // A real-world example: typed after other words, not at the start.
  const text = "design my website /shad";
  const result = findSlashCommand(text, text.length);
  assert.deepEqual(result, { query: "shad", start: text.indexOf("/"), end: text.length });
});

test("the cursor can sit mid-message — only text up to it matters", () => {
  const text = "/strip design my website";
  // Cursor right after "strip", before the rest was even typed.
  const result = findSlashCommand(text, 6);
  assert.deepEqual(result, { query: "strip", start: 0, end: 6 });
});

test("a bare slash with nothing typed after it yet still opens, with an empty query", () => {
  const result = findSlashCommand("hello /", 7);
  assert.deepEqual(result, { query: "", start: 6, end: 7 });
});

test("a space after the slash closes the command", () => {
  assert.equal(findSlashCommand("/strip ", 7), null);
});

test("a slash stuck to the previous word never triggers — not a fresh word", () => {
  assert.equal(findSlashCommand("https://example.com", 8), null);
  assert.equal(findSlashCommand("a/b", 3), null);
});

test("only the closest slash before the cursor matters when there are two", () => {
  const text = "/first then /second";
  const result = findSlashCommand(text, text.length);
  assert.deepEqual(result, { query: "second", start: text.lastIndexOf("/"), end: text.length });
});

// ---------------------------------------------------------------------------
// matchByPrefix
// ---------------------------------------------------------------------------

test("matchByPrefix filters case-insensitively by prefix on the given label", () => {
  const items = [{ name: "shadcn-ui-setup" }, { name: "stripe-checkout" }];
  assert.deepEqual(
    matchByPrefix(items, "SHAD", (i) => i.name).map((i) => i.name),
    ["shadcn-ui-setup"],
  );
});

test("matchByPrefix with an empty query returns everything", () => {
  const items = [{ name: "a" }, { name: "b" }];
  assert.equal(matchByPrefix(items, "", (i) => i.name).length, 2);
});

// ---------------------------------------------------------------------------
// replaceSlashCommand
// ---------------------------------------------------------------------------

test("replaceSlashCommand removes just the /query fragment, leaving the rest untouched", () => {
  const text = "design my website /shad";
  const command = findSlashCommand(text, text.length)!;
  assert.equal(replaceSlashCommand(text, command), "design my website ");
});

test("replaceSlashCommand works when the command sits in the middle, not just at the end", () => {
  const text = "/strip please, thanks";
  const command = findSlashCommand(text, 6)!; // cursor right after "strip"
  assert.equal(replaceSlashCommand(text, command), " please, thanks");
});
