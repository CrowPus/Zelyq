import assert from "node:assert/strict";
import { test } from "node:test";
import { withConversationCacheBreakpoint } from "../src/providers/anthropic.ts";

test("adds one ephemeral breakpoint on the last message's last block", () => {
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

  // First two messages untouched, no cache_control anywhere in them.
  assert.equal(JSON.stringify(out[0]), JSON.stringify(messages[0]));
  assert.equal(JSON.stringify(out[1]), JSON.stringify(messages[1]));

  // Last message: only the FINAL block carries the breakpoint.
  const lastBlocks = out[2].content as Array<Record<string, unknown>>;
  assert.equal(lastBlocks[0].cache_control, undefined);
  assert.deepEqual(lastBlocks[1].cache_control, { type: "ephemeral" });

  // Exactly one message-level breakpoint in the whole payload.
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
