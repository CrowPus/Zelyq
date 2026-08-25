import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { describeAnthropicError } from "../src/providers/anthropic.js";

/**
 * Found live: a real 429 from a Claude Code subscription session reached
 * the chat as `429 {"type":"error","error":{"type":"rate_limit_error",
 * "message":"Error"}}` — the SDK's own raw HTTP body, verbatim, since its
 * `.message` for that error is just the wire response repeated back. Built
 * with the SDK's real `APIError.generate` factory, the same thing the SDK
 * itself calls on a real HTTP response — not a hand-built fake shaped like
 * one.
 */

function realError(status: number, errorType: string, message = "Error"): unknown {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type: errorType, message } },
    undefined,
    new Headers(),
  );
}

test("a rate limit becomes a clear, specific explanation, not the raw HTTP body", () => {
  const description = describeAnthropicError(realError(429, "rate_limit_error"));
  assert.match(description, /rate-limiting/i);
  assert.match(description, /Claude Code session/);
  assert.doesNotMatch(description, /"type":"error"/, "the raw JSON envelope must not leak through");
});

test("an authentication failure points at reconnecting the session, not a raw 401", () => {
  const description = describeAnthropicError(realError(401, "authentication_error"));
  assert.match(description, /credentials/);
  assert.match(description, /Settings/);
});

test("an error the vendor did explain keeps that explanation", () => {
  const description = describeAnthropicError(
    realError(400, "invalid_request_error", "The model field is required."),
  );
  assert.equal(description, "The model field is required.");
});

test("something with no useful text at all falls back to the raw message rather than nothing", () => {
  const description = describeAnthropicError(new Error("socket hang up"));
  assert.equal(description, "socket hang up");
});
