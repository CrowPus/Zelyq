import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Body,
  MIN_DWELL_MS,
  onThinking,
  onToolEnd,
  onToolStart,
  onTurnStart,
  postureFor,
  RESTING,
} from "../src/lib/posture.js";

const at = (body: Body, name: string, now: number, input?: Record<string, unknown>) =>
  onToolStart(body, { name, ...(input ? { input } : {}) }, now);

test("every tool the agent actually uses lands in a posture", () => {
  // The real list, from this instance's own history.
  const seen: Record<string, string> = {
    read_file: "reading",
    list_files: "reading",
    search_files: "reading",
    preview_logs: "reading",
    analyze_project: "reading",
    write_file: "writing",
    edit_file: "writing",
    update_plan: "writing",
    run_command: "running",
    typecheck_project: "running",
    start_preview: "running",
    supabase_deploy_function: "running",
    verify: "inspecting",
    view_preview: "inspecting",
    inspect_page: "inspecting",
    accessibility_audit: "inspecting",
    check_console_errors: "inspecting",
    test_responsive_layout: "inspecting",
    browse_page: "browsing",
    capture_reference: "browsing",
    http_request: "browsing",
    fetch_reference_image: "browsing",
    use_skill: "consulting",
    use_design_ref: "consulting",
    dispatch_task: "delegating",
    design_pass: "delegating",
    cinematic_pass: "delegating",
  };
  for (const [tool, posture] of Object.entries(seen)) {
    assert.equal(postureFor(tool), posture, tool);
  }
});

test("an MCP tool is read by its verb, not its server", () => {
  assert.equal(postureFor("files__read_text_file"), "reading");
  assert.equal(postureFor("files__write_file"), "writing");
});

test("an unknown tool still gets a posture rather than freezing the body", () => {
  assert.equal(postureFor("some_vendor_thing"), "reading");
});

test("a run of the same family holds one posture", () => {
  // 563 read_file calls at 3ms each are one activity, not 563 gestures.
  let b = at(RESTING, "read_file", 1000);
  const since = b.since;
  for (let t = 1003; t < 1100; t += 3) b = at(b, "read_file", t);
  assert.equal(b.posture, "reading");
  assert.equal(b.since, since, "the pose was never re-adopted");
});

test("interleaved read and write does not strobe", () => {
  // read, edit, read, edit at 4ms is the common real pattern. Without a dwell
  // floor the body would change pose ~250 times a second.
  let b = at(RESTING, "read_file", 1000);
  for (let i = 0; i < 20; i++) {
    b = at(b, i % 2 === 0 ? "edit_file" : "read_file", 1000 + i * 4);
  }
  assert.equal(b.posture, "reading", "the first pose is held through the flicker");
});

test("a genuine change of activity does come through", () => {
  let b = at(RESTING, "read_file", 1000);
  b = at(b, "run_command", 1000 + MIN_DWELL_MS + 1);
  assert.equal(b.posture, "running");
});

test("delegating is never delayed by the dwell rule", () => {
  // Handing work to a specialist lasts a minute; showing it late shows it wrong.
  let b = at(RESTING, "read_file", 1000);
  b = at(b, "dispatch_task", 1010);
  assert.equal(b.posture, "delegating");
});

test("tempo rises with the rate of work and is bounded", () => {
  let fast = at(RESTING, "read_file", 1000);
  for (let t = 1010; t < 1400; t += 10) fast = at(fast, "read_file", t);
  let slow = at(RESTING, "read_file", 1000);
  for (let t = 3000; t < 20000; t += 2000) slow = at(slow, "read_file", t);
  assert.ok(fast.tempo > slow.tempo, "working faster reads as working harder");
  assert.ok(fast.tempo <= 1 && slow.tempo >= 0);
});

test("tempo is measured between calls, not since the pose was adopted", () => {
  // A posture is held across a whole burst, so `since` stops moving while the
  // work continues. Reading the rate from it made a sustained run of fast
  // reads look like it was winding down.
  let b = at(RESTING, "read_file", 1000);
  let previous = 0;
  for (let t = 1010; t <= 1200; t += 10) {
    b = at(b, "read_file", t);
    assert.ok(b.tempo >= previous, `tempo fell at ${t}`);
    previous = b.tempo;
  }
});

test("failures raise tension and success bleeds it back down", () => {
  // A body that cannot show strain is decoration.
  let b = at(RESTING, "run_command", 1000);
  assert.equal(b.tension, 0);
  b = onToolEnd(b, { isError: true });
  b = onToolEnd(b, { isError: true });
  const strained = b.tension;
  assert.ok(strained > 0.5, "repeated failure is visible");
  for (let i = 0; i < 8; i++) b = onToolEnd(b, { isError: false });
  assert.ok(b.tension < strained, "and it settles when things start working");
  assert.ok(b.tension >= 0, "never negative");
});

test("tension is capped, so a bad run cannot peg the body forever", () => {
  let b = RESTING;
  for (let i = 0; i < 20; i++) b = onToolEnd(b, { isError: true });
  assert.equal(b.tension, 1);
});

test("thinking is its own state, not the absence of one", () => {
  // The gap between tool calls is the model deciding. Today that is
  // indistinguishable from being stuck.
  let b = at(RESTING, "read_file", 1000);
  b = onThinking(b, 2000);
  assert.equal(b.posture, "thinking");
  assert.ok(b.tempo < 1);
});

test("a sentence between two edits does not drop the working pose", () => {
  // Models narrate mid-turn. Without the dwell floor here the body would fall
  // out of `writing` and back into it several times a second.
  let b = at(RESTING, "edit_file", 1000);
  b = onThinking(b, 1100);
  assert.equal(b.posture, "writing");
  b = onThinking(b, 1000 + MIN_DWELL_MS + 1);
  assert.equal(b.posture, "thinking", "a real pause still comes through");
});

test("a turn opens thinking, and its first tool is not held off", () => {
  const start = onTurnStart();
  assert.equal(start.posture, "thinking");
  const b = at(start, "read_file", 5_000_000);
  assert.equal(b.posture, "reading", "the dwell floor must not swallow the first call");
});

test("the focus is the thing being worked on, shortened", () => {
  const b = at(RESTING, "read_file", 1000, { path: "apps/web/src/components/ChatPanel.tsx" });
  assert.equal(b.focus, "components/ChatPanel.tsx");
});

test("focus survives a call that does not name one", () => {
  let b = at(RESTING, "read_file", 1000, { path: "src/App.tsx" });
  b = at(b, "typecheck_project", 1000 + MIN_DWELL_MS + 1, {});
  assert.equal(b.focus, "src/App.tsx", "the body keeps looking at the last real thing");
});
