import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateRowTokens, historyWindow } from "../src/repositories/messages.js";

type Row = {
  role: string;
  content?: string | null;
  thinking?: string | null;
  toolCalls?: string | null;
};

const row = (role: string, content = "", extra: Partial<Row> = {}): Row => ({
  role,
  content,
  toolCalls: "[]",
  ...extra,
});

test("historyWindow keeps the newest messages, in chronological order", () => {
  const rows = [
    row("assistant", "turn 5"), // DB gives newest first
    row("user", "turn 4"),
    row("assistant", "turn 3"),
    row("user", "turn 2"),
    row("user", "turn 1"), // a real conversation opens on a user turn
  ];
  const out = historyWindow(rows, 1_000_000).map((r) => r.content);
  assert.deepEqual(out, ["turn 1", "turn 2", "turn 3", "turn 4", "turn 5"]);
});

test("a token budget drops the oldest, and the window still opens on a user turn", () => {
  // Each row ~250 tokens (1000 chars / 4). Budget 1100 → 4 newest fit; the
  // forward-trim then drops one leading assistant → 3, starting on a user turn.
  const big = "x".repeat(1000);
  const rows = [
    row("user", big), // newest
    row("assistant", big),
    row("user", big),
    row("assistant", big),
    row("user", big), // oldest — dropped by the budget
  ];
  const out = historyWindow(rows, 1100);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.role, "user");
});

test("the window is trimmed forward so it opens on a user turn", () => {
  const rows = [
    row("user", "u2"),
    row("assistant", "a1"),
    row("user", "u1"), // first chronologically, a clean opener
  ];
  assert.deepEqual(
    historyWindow(rows, 1_000_000).map((r) => r.content),
    ["u1", "a1", "u2"],
  );

  // Leading assistant turns (no clean opener) are all shed.
  const noOpener = [row("user", "keep"), row("assistant", "x"), row("assistant", "y")];
  assert.deepEqual(
    historyWindow(noOpener, 1_000_000).map((r) => r.content),
    ["keep"],
  );
});

test("everything trimmed away yields an empty window, not a broken one", () => {
  const rows = [row("assistant", "a"), row("assistant", "b")];
  assert.deepEqual(historyWindow(rows, 1_000_000), []);
});

test("estimateRowTokens counts content, thinking and tool calls", () => {
  assert.equal(estimateRowTokens({ content: "abcd", thinking: "efgh", toolCalls: "ij" }), 3);
  assert.equal(estimateRowTokens({ content: null, thinking: null, toolCalls: null }), 0);
});
