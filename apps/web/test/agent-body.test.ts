import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL, reduce } from "../src/hooks/useChatSocket.js";

/**
 * The body is a reading of the event stream, never a second signal beside it.
 * That is the whole difference between this and a mascot: it cannot show the
 * agent working unless the agent is working, and it cannot hide a failure.
 */

const turnStart = () => ({ type: "turn.start", sessionId: "s", messageId: "m1" }) as never;
const toolStart = (name: string, input: Record<string, unknown> = {}) =>
  ({
    type: "tool.start",
    sessionId: "s",
    call: { id: `${name}-${Math.random()}`, name, input },
  }) as never;
const toolEnd = (name: string, isError = false) =>
  ({
    type: "tool.end",
    sessionId: "s",
    call: { id: `${name}-end`, name, input: {}, result: "", isError },
  }) as never;
const turnEnd = () =>
  ({ type: "turn.end", sessionId: "s", messageId: "m1", message: null }) as never;

test("the body rests until a turn starts", () => {
  assert.equal(INITIAL.body.posture, "idle");
});

test("a turn opens with the model thinking, not with a blank", () => {
  assert.equal(reduce(INITIAL, turnStart()).body.posture, "thinking");
});

test("the posture follows the tool actually running", () => {
  let s = reduce(INITIAL, turnStart());
  s = reduce(s, toolStart("read_file", { path: "src/App.tsx" }));
  assert.equal(s.body.posture, "reading");
  assert.equal(s.body.focus, "src/App.tsx");
});

test("a failing tool is visible in the body", () => {
  let s = reduce(reduce(INITIAL, turnStart()), toolStart("run_command"));
  const calm = s.body.tension;
  s = reduce(s, toolEnd("run_command", true));
  assert.ok(s.body.tension > calm, "strain has to reach the body, or it is decoration");
});

test("the body settles when the turn ends and keeps no focus", () => {
  let s = reduce(INITIAL, turnStart());
  s = reduce(s, toolStart("write_file", { path: "src/App.tsx" }));
  s = reduce(s, turnEnd());
  assert.equal(s.body.posture, "idle");
  assert.equal(s.body.focus, null);
});

test("an error leaves the body visibly strained rather than merely idle", () => {
  const s = reduce(reduce(INITIAL, turnStart()), {
    type: "error",
    sessionId: "s",
    message: "provider refused",
  } as never);
  assert.equal(s.body.posture, "idle");
  assert.ok(s.body.tension >= 0.5, "a turn that failed must not look like one that did not");
});

test("a reconnect resets the body with the rest of the stream", () => {
  let s = reduce(reduce(INITIAL, turnStart()), toolStart("read_file"));
  s = reduce(s, { type: "connected", sessionId: "s", history: [] } as never);
  assert.equal(s.body.posture, "idle");
});
