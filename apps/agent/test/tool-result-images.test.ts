import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnthropicToolResultContent } from "../src/providers/anthropic.js";
import { buildGoogleToolResultParts } from "../src/providers/google.js";
import type { ToolResult } from "../src/providers/types.js";

/**
 * `view_preview` (`040`) is the first tool whose result can carry an image.
 * Anthropic and Google each attach it differently — this is the actual
 * per-provider surface `040` named up front. See
 * `apps/agent/test/openai-compatible.test.ts` for the third: the dialect
 * that dialect targets has no image-carrying tool-message variant at all, so
 * that case is proven against a real HTTP server instead of a pure function.
 */

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    id: "call_1",
    name: "view_preview",
    output: "Screenshot of the running preview.",
    isError: false,
    ...overrides,
  };
}

test("Anthropic: a result with no images stays a plain string, same as before 040", () => {
  const content = buildAnthropicToolResultContent(result());
  assert.equal(content, "Screenshot of the running preview.");
});

test("Anthropic: an image rides inside the tool_result's own content, native support", () => {
  const content = buildAnthropicToolResultContent(
    result({ images: [{ mimeType: "image/jpeg", data: "ZmFrZQ==" }] }),
  );
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((block) => block.type),
    ["image", "text"],
  );
  const imageBlock = content[0] as { type: "image"; source: { media_type: string; data: string } };
  assert.equal(imageBlock.source.media_type, "image/jpeg");
  assert.equal(imageBlock.source.data, "ZmFrZQ==");
  const textBlock = content[1] as { type: "text"; text: string };
  assert.equal(textBlock.text, "Screenshot of the running preview.");
});

test("Anthropic: multiple images each become their own image block, text still last", () => {
  const content = buildAnthropicToolResultContent(
    result({
      images: [
        { mimeType: "image/jpeg", data: "b25l" },
        { mimeType: "image/jpeg", data: "dHdv" },
      ],
    }),
  );
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((block) => block.type),
    ["image", "image", "text"],
  );
});

test("Google: a result with no images produces just its functionResponse part", () => {
  const parts = buildGoogleToolResultParts(result(), "provider-call-id");
  assert.equal(parts.length, 1);
  const response = parts[0] as {
    functionResponse: { id?: string; name: string; response: unknown };
  };
  assert.equal(response.functionResponse.id, "provider-call-id");
  assert.equal(response.functionResponse.name, "view_preview");
  assert.deepEqual(response.functionResponse.response, {
    output: "Screenshot of the running preview.",
  });
});

test("Google: no callId at all is omitted, not sent as undefined", () => {
  const parts = buildGoogleToolResultParts(result(), undefined);
  const response = parts[0] as { functionResponse: Record<string, unknown> };
  assert.ok(!("id" in response.functionResponse));
});

test("Google: an image rides as its own inlineData part, right after the functionResponse", () => {
  const parts = buildGoogleToolResultParts(
    result({ images: [{ mimeType: "image/jpeg", data: "ZmFrZQ==" }] }),
    undefined,
  );
  assert.equal(parts.length, 2);
  assert.ok("functionResponse" in parts[0]!);
  const inline = parts[1] as { inlineData: { mimeType: string; data: string } };
  assert.equal(inline.inlineData.mimeType, "image/jpeg");
  assert.equal(inline.inlineData.data, "ZmFrZQ==");
});

test("Google: an errored result still carries its image", () => {
  const parts = buildGoogleToolResultParts(
    result({
      isError: true,
      output: "The preview isn't running.",
      images: [{ mimeType: "image/jpeg", data: "ZmFrZQ==" }],
    }),
    undefined,
  );
  const response = parts[0] as { functionResponse: { response: unknown } };
  assert.deepEqual(response.functionResponse.response, { error: "The preview isn't running." });
  assert.equal(parts.length, 2, "the image is not dropped just because the call failed");
});
