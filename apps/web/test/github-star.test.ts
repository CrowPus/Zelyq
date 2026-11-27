import assert from "node:assert/strict";
import { test } from "node:test";
import { compactCount } from "../src/components/GitHubStar.js";

test("the star count reads like GitHub's", () => {
  assert.equal(compactCount(10), "10");
  assert.equal(compactCount(999), "999");
  assert.equal(compactCount(1000), "1k");
  assert.equal(compactCount(1234), "1.2k");
  assert.equal(compactCount(12_345), "12k");
});
