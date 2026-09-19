import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeConsecutiveTurns } from "../src/session.js";

/** Auto Mode saves each pass as its own message; providers such as Gemini
 * refuse a history that does not alternate. */

test("back-to-back assistant passes are joined into one turn", () => {
  const merged = mergeConsecutiveTurns([
    { role: "user" as const, content: "build it" },
    {
      role: "assistant" as const,
      content: "Pass one.",
      toolCalls: [{ id: "a", name: "write_file", input: {} }],
    },
    {
      role: "assistant" as const,
      content: "Pass two.",
      toolCalls: [{ id: "b", name: "write_file", input: {} }],
    },
    { role: "user" as const, content: "thanks" },
  ]);
  assert.deepEqual(
    merged.map((m) => m.role),
    ["user", "assistant", "user"],
  );
  assert.equal(merged[1]?.content, "Pass one.\n\nPass two.");
  assert.deepEqual(
    merged[1]?.toolCalls?.map((c) => c.id),
    ["a", "b"],
    "every pass's tool calls are kept, in order",
  );
});

test("an alternating history is left exactly as it was", () => {
  const history = [
    { role: "user" as const, content: "a" },
    { role: "assistant" as const, content: "b" },
    { role: "user" as const, content: "c" },
  ];
  assert.deepEqual(mergeConsecutiveTurns(history), history);
});

test("a pass with no words of its own does not leave a blank line behind", () => {
  const merged = mergeConsecutiveTurns([
    { role: "assistant" as const, content: "Done." },
    { role: "assistant" as const, content: "  " },
  ]);
  assert.equal(merged[0]?.content, "Done.");
});
