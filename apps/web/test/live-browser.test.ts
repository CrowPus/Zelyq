import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL, reduce } from "../src/hooks/useChatSocket.js";

/**
 * The live browser panel's state. A capture opens one page per viewport width,
 * so open/close repeats several times inside a single tool call — the panel has
 * to ride that out rather than blink.
 */

const open = (callId: string, label = "example.com") =>
  ({ type: "browser.open", sessionId: "s", callId, label }) as never;
const frame = (callId: string, data = "AAAA") =>
  ({ type: "browser.frame", sessionId: "s", callId, data, width: 800, height: 600 }) as never;
const close = (callId: string) => ({ type: "browser.close", sessionId: "s", callId }) as never;

test("no browser until a tool opens one", () => {
  assert.equal(INITIAL.browser, null);
});

test("open then frame shows the page, live", () => {
  let s = reduce(INITIAL, open("c1", "example.com @ 1280px"));
  assert.equal(s.browser?.live, true);
  assert.equal(s.browser?.frame, null, "no frame until one arrives");

  s = reduce(s, frame("c1", "JPEGDATA"));
  assert.equal(s.browser?.frame, "JPEGDATA");
  assert.equal(s.browser?.label, "example.com @ 1280px");
});

test("closing keeps the last frame and drops the LIVE badge", () => {
  // The page it ended on stays visible; vanishing would lose the result at the
  // moment it became interesting.
  let s = reduce(reduce(INITIAL, open("c1")), frame("c1", "LAST"));
  s = reduce(s, close("c1"));
  assert.equal(s.browser?.frame, "LAST");
  assert.equal(s.browser?.live, false);
});

test("a capture's next viewport carries the previous frame across", () => {
  // Otherwise the panel blinks empty between every width a capture visits.
  let s = reduce(reduce(INITIAL, open("c1")), frame("c1", "WIDE"));
  s = reduce(s, close("c1"));
  s = reduce(s, open("c2", "example.com @ 768px"));
  assert.equal(s.browser?.frame, "WIDE", "the old frame holds until the new page paints");
  assert.equal(s.browser?.live, true);
  assert.equal(s.browser?.label, "example.com @ 768px");
});

test("a frame from a call the panel is not showing is ignored", () => {
  const s = reduce(reduce(INITIAL, open("c1")), frame("c2", "STALE"));
  assert.equal(s.browser?.frame, null);
});

test("a close for a different call does not tear down the current one", () => {
  const s = reduce(reduce(reduce(INITIAL, open("c1")), frame("c1", "X")), close("c9"));
  assert.equal(s.browser?.live, true);
  assert.equal(s.browser?.frame, "X");
});

test("the panel is cleared when the turn ends", () => {
  // A tool that crashes mid-stream never sends browser.close, so the turn
  // ending has to be what guarantees the panel does not stick.
  let s = reduce(reduce(INITIAL, open("c1")), frame("c1", "X"));
  s = reduce(s, {
    type: "turn.end",
    sessionId: "s",
    messageId: "m",
    stopReason: "end_turn",
  } as never);
  assert.equal(s.browser, null);
});

test("the panel is cleared when a turn is aborted", () => {
  let s = reduce(reduce(INITIAL, open("c1")), frame("c1", "X"));
  s = reduce(s, { type: "aborted", sessionId: "s", messageId: "m" } as never);
  assert.equal(s.browser, null);
});
