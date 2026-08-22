import assert from "node:assert/strict";
import { test } from "node:test";
import { isId, newId, slugify } from "../src/ids.js";

test("ids are prefixed by kind and unique", () => {
  const a = newId("project");
  const b = newId("project");
  assert.ok(isId("project", a));
  assert.ok(!isId("session", a));
  assert.notEqual(a, b);
});

test("slugify strips punctuation and collapses separators", () => {
  assert.equal(slugify("My Great App!!"), "my-great-app");
  assert.equal(slugify("  --Café Menu--  "), "cafe-menu");
});

test("slugify falls back when nothing survives", () => {
  assert.equal(slugify("!!!"), "project");
  assert.equal(slugify("!!!", "untitled"), "untitled");
});
