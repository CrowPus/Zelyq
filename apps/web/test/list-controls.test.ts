import assert from "node:assert/strict";
import { test } from "node:test";
import { matches, PAGE_SIZE, pageOf } from "../src/components/ListControls.js";

test("search: every word must appear, in any field, any case", () => {
  assert.equal(matches("", "anything"), true);
  assert.equal(matches("shop", "Shop front", null), true);
  assert.equal(matches("shop api", "Shop", "api server"), true);
  assert.equal(matches("shop admin", "Shop", "api server"), false);
  assert.equal(matches("  ", "x"), true);
});

test("pages: 10 a page, and a page past the end shows the last one", () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  assert.equal(PAGE_SIZE, 10);
  assert.deepEqual(pageOf(items, 1).rows, items.slice(0, 10));
  assert.deepEqual(pageOf(items, 3), { rows: items.slice(20), page: 3 });
  // The list got shorter while page 9 was open.
  assert.deepEqual(pageOf(items, 9), { rows: items.slice(20), page: 3 });
  assert.deepEqual(pageOf([], 4), { rows: [], page: 1 });
});
