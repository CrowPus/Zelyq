import assert from "node:assert/strict";
import { test } from "node:test";
import type { PromptAttachment } from "@zelyq/core";
import { buildAnthropicUserContent } from "../src/providers/anthropic.js";
import { buildGoogleUserParts } from "../src/providers/google.js";
import { buildOpenAIUserContent } from "../src/providers/openai-compatible.js";

function image(overrides: Partial<PromptAttachment> = {}): PromptAttachment {
  return { filename: "screenshot.png", mimeType: "image/png", data: "ZmFrZQ==", ...overrides };
}

test("Anthropic: no attachments produces a plain string", () => {
  assert.equal(buildAnthropicUserContent("hello"), "hello");
});

test("Anthropic: an attachment produces images before a trailing text block", () => {
  const content = buildAnthropicUserContent("what is this?", [image()]);
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((block) => block.type),
    ["image", "text"],
  );
  const imageBlock = content[0] as { type: "image"; source: { media_type: string; data: string } };
  assert.equal(imageBlock.source.media_type, "image/png");
  assert.equal(imageBlock.source.data, "ZmFrZQ==");
  const textBlock = content[1] as { type: "text"; text: string };
  assert.equal(textBlock.text, "what is this?");
});

test("Anthropic: multiple attachments each become their own image block, in order", () => {
  const content = buildAnthropicUserContent("compare these", [
    image({ filename: "a.png" }),
    image({ filename: "b.jpeg", mimeType: "image/jpeg", data: "b2theQ==" }),
  ]);
  assert.ok(Array.isArray(content));
  assert.equal(content.length, 3);
  assert.equal((content[0] as { type: string }).type, "image");
  assert.equal((content[1] as { type: string }).type, "image");
  assert.equal((content[1] as { source: { media_type: string } }).source.media_type, "image/jpeg");
  assert.equal((content[2] as { type: string }).type, "text");
});

test("Anthropic: an attachment with blank/whitespace-only text omits the text block", () => {
  const content = buildAnthropicUserContent("   ", [image()]);
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((block) => block.type),
    ["image"],
  );
});

test("Google: no attachments produces a single text part", () => {
  assert.deepEqual(buildGoogleUserParts("hello"), [{ text: "hello" }]);
});

test("Google: an attachment produces inlineData parts before a trailing text part", () => {
  const parts = buildGoogleUserParts("what is this?", [image()]);
  assert.equal(parts.length, 2);
  const inline = parts[0] as { inlineData: { mimeType: string; data: string } };
  assert.equal(inline.inlineData.mimeType, "image/png");
  assert.equal(inline.inlineData.data, "ZmFrZQ==");
  assert.deepEqual(parts[1], { text: "what is this?" });
});

test("Google: an attachment with blank text omits the trailing text part", () => {
  const parts = buildGoogleUserParts("", [image()]);
  assert.equal(parts.length, 1);
  assert.ok("inlineData" in parts[0]!);
});

test("OpenAI-compatible: no attachments produces a plain string", () => {
  assert.equal(buildOpenAIUserContent("hello"), "hello");
});

test("OpenAI-compatible: an attachment produces image_url parts before a trailing text part", () => {
  const content = buildOpenAIUserContent("what is this?", [image()]);
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((part) => part.type),
    ["image_url", "text"],
  );
  const imagePart = content[0] as { type: "image_url"; image_url: { url: string } };
  assert.equal(imagePart.image_url.url, "data:image/png;base64,ZmFrZQ==");
  const textPart = content[1] as { type: "text"; text: string };
  assert.equal(textPart.text, "what is this?");
});

test("OpenAI-compatible: an attachment with blank text omits the text part", () => {
  const content = buildOpenAIUserContent("  \n", [image()]);
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((part) => part.type),
    ["image_url"],
  );
});
