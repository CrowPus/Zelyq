import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedTimeout, MAX_TIMEOUT_MS } from "../src/timeout.js";

test("a caller's timeout is kept between zero and a day", () => {
  assert.equal(boundedTimeout(5_000), 5_000);
  assert.equal(boundedTimeout(Number.MAX_SAFE_INTEGER), MAX_TIMEOUT_MS);
  assert.equal(boundedTimeout(-1), 0);
  assert.equal(boundedTimeout(Number.NaN), 30_000);
  assert.equal(boundedTimeout(undefined, 1_000), 1_000);
});
