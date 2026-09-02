import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCacheTtl, withConversationCacheBreakpoint } from "../src/providers/anthropic.ts";

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
  assert.deepEqual(midBlocks[midBlocks.length - 1].cache_control, {
    type: "ephemeral",
    ttl: "5m",
  });

  // Last message: only the FINAL block carries the breakpoint.
  const lastBlocks = out[2].content as Array<Record<string, unknown>>;
  assert.equal(lastBlocks[0].cache_control, undefined);
  assert.deepEqual(lastBlocks[1].cache_control, { type: "ephemeral", ttl: "5m" });

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
    { type: "text", text: "hello", cache_control: { type: "ephemeral", ttl: "5m" } },
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

// R6 — cache lifetime. A 5-minute entry expires inside an ordinary Zelyq turn
// (an install, a preview build, a user reading a plan), and every expiry
// re-pays the whole transcript cold.

test("the ttl is carried onto every breakpoint it writes", () => {
  const out = withConversationCacheBreakpoint([{ role: "user" as const, content: "hello" }], "1h");
  assert.deepEqual(out[0].content, [
    { type: "text", text: "hello", cache_control: { type: "ephemeral", ttl: "1h" } },
  ]);
});

test("a session starts at 5m and does not pay the 1h write multiplier for nothing", () => {
  assert.deepEqual(resolveCacheTtl(null, false, {}), { ttl: "5m", upgraded: false });
  assert.deepEqual(resolveCacheTtl(30_000, false, {}), { ttl: "5m", upgraded: false });
});

test("one gap long enough to expire a 5m entry upgrades the session for good", () => {
  const first = resolveCacheTtl(5 * 60_000, false, {});
  assert.deepEqual(first, { ttl: "1h", upgraded: true });
  // Sticky: a fast round after a slow one must not drop back, or the next slow
  // round pays the cold re-write all over again.
  assert.deepEqual(resolveCacheTtl(1_000, first.upgraded, {}), { ttl: "1h", upgraded: true });
});

test("an unrecognised ZELYQ_CACHE_TTL measures rather than silently pinning", () => {
  // A typo must not quietly disable the measurement — "auto" is the documented
  // default and anything unknown behaves the same way.
  assert.deepEqual(resolveCacheTtl(null, false, { ZELYQ_CACHE_TTL: "auto" }), {
    ttl: "5m",
    upgraded: false,
  });
  assert.deepEqual(resolveCacheTtl(5 * 60_000, false, { ZELYQ_CACHE_TTL: "1hour" }), {
    ttl: "1h",
    upgraded: true,
  });
});

test("ZELYQ_CACHE_TTL pins the choice either way, for a controlled benchmark", () => {
  assert.deepEqual(resolveCacheTtl(60 * 60_000, true, { ZELYQ_CACHE_TTL: "5m" }), {
    ttl: "5m",
    upgraded: false,
  });
  assert.deepEqual(resolveCacheTtl(null, false, { ZELYQ_CACHE_TTL: "1h" }), {
    ttl: "1h",
    upgraded: true,
  });
});
