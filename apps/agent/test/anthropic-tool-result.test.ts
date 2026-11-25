import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnthropicToolResult } from "../src/providers/anthropic.js";

const image = { mimeType: "image/png", data: "iVBORw0KGgo=" };

test("a failed result with a screenshot keeps the picture and says it failed in words", () => {
  const block = buildAnthropicToolResult({
    id: "t1",
    output: "step 2 failed",
    isError: true,
    images: [image],
  });
  assert.equal(block.is_error, false);
  assert.ok(Array.isArray(block.content));
  const content = block.content as Array<{ type: string; text?: string }>;
  assert.equal(content[0]?.type, "image");
  assert.equal(content.at(-1)?.text, "Error: step 2 failed");
});

test("a failed text-only result keeps the error flag", () => {
  const block = buildAnthropicToolResult({ id: "t2", output: "no such file", isError: true });
  assert.equal(block.is_error, true);
  assert.equal(block.content, "no such file");
});

test("a successful result with a screenshot is unchanged", () => {
  const block = buildAnthropicToolResult({
    id: "t3",
    output: "ok",
    isError: false,
    images: [image],
  });
  assert.equal(block.is_error, false);
  const content = block.content as Array<{ type: string; text?: string }>;
  assert.equal(content.at(-1)?.text, "ok");
});
