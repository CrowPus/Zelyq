import assert from "node:assert/strict";
import { test } from "node:test";
import { withConversationCacheBreakpoint } from "../src/providers/anthropic.ts";

test("marks the last two message boundaries — the write and the read breakpoint", () => {
  const messages = [
    { role: "user" as const, content: "build a page" },
    { role: "assistant" as const, content: [{ type: "text" as const, text: "on it" }] },
    {
      role: "user" as const,
      content: [
        { type: "tool_result" as const, tool_use_id: "a", content: "ok" },
        { type: "tool_result" as const, tool_use_id: "b", content: "done" },
      ],
    },
  ];
  const out = withConversationCacheBreakpoint(messages);

  // First message untouched.
  assert.equal(JSON.stringify(out[0]), JSON.stringify(messages[0]));

  // Second-to-last (the assistant turn): its last block carries a breakpoint.
  const midBlocks = out[1].content as Array<Record<string, unknown>>;
  assert.deepEqual(midBlocks[midBlocks.length - 1].cache_control, { type: "ephemeral" });

  // Last message: only the FINAL block carries the breakpoint.
  const lastBlocks = out[2].content as Array<Record<string, unknown>>;
  assert.equal(lastBlocks[0].cache_control, undefined);
  assert.deepEqual(lastBlocks[1].cache_control, { type: "ephemeral" });

  // Exactly two message-level breakpoints — plus the system one, that is 3, under Anthropic's 4.
  assert.equal(JSON.stringify(out).match(/"cache_control"/g)?.length, 2);
});

test("with a single message, marks just that one", () => {
  const out = withConversationCacheBreakpoint([
    { role: "user" as const, content: [{ type: "text" as const, text: "hi" }] },
  ]);
  assert.equal(JSON.stringify(out).match(/"cache_control"/g)?.length, 1);
});

test("a string last message is normalised to a text block with the breakpoint", () => {
  const out = withConversationCacheBreakpoint([{ role: "user" as const, content: "hello" }]);
  assert.deepEqual(out[0].content, [
    { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
  ]);
});

test("does not mutate the input (no stale breakpoints accumulate)", () => {
  const messages = [{ role: "user" as const, content: "x" }];
  withConversationCacheBreakpoint(messages);
  withConversationCacheBreakpoint(messages);
  assert.equal(messages[0].content, "x");
});

test("empty history is returned as-is", () => {
  assert.deepEqual(withConversationCacheBreakpoint([]), []);
});
