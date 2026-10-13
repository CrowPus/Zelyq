import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { isId, newId, randomUUID, slugify } from "../src/ids.js";

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

test("randomUUID still works where the browser withholds crypto.randomUUID", (t) => {
  // A page served over plain HTTP from a fresh server is not a secure context,
  // and there `crypto.randomUUID` does not exist.
  const native = globalThis.crypto.randomUUID;
  t.after(() => {
    globalThis.crypto.randomUUID = native;
  });
  // @ts-expect-error simulating an insecure browser context
  globalThis.crypto.randomUUID = undefined;
  const a = randomUUID();
  const b = randomUUID();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(z.string().uuid().safeParse(a).success, "the server's request schema accepts it");
  assert.notEqual(a, b);
  assert.ok(isId("imageGeneration", newId("imageGeneration")));
});
