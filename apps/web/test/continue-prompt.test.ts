import assert from "node:assert/strict";
import { test } from "node:test";
import { continueLabel, detectContinuePrompt } from "../src/lib/continuePrompt";

test("detects the bold-quoted 'Reply with continue to proceed' form", () => {
  const msg =
    'Decision Responsibility\n- Why rejected: …\n\nReply with **"continue"** to proceed with the next batch of client components (AuthContext, ChatContext, Sidebar).';
  assert.equal(detectContinuePrompt(msg), "continue");
});

test("detects plain-word and single-quote variants", () => {
  assert.equal(detectContinuePrompt("Type continue to continue."), "continue");
  assert.equal(detectContinuePrompt("Reply 'go on' to continue the build."), "go on");
  assert.equal(detectContinuePrompt('Say "build it" to proceed.'), "build it");
  assert.equal(
    detectContinuePrompt("Respond with `keep going` to move on to the next task."),
    "keep going",
  );
});

test("detects 'reply with \"continue\"' when the word is the whole ask, no trailing clause", () => {
  // The AI often says the trigger word once, then explains what it will do —
  // "so I can…", "and I'll…", or just a full stop. The word already is the ask.
  assert.equal(
    detectContinuePrompt('Please reply with "continue" so I can write the complete showcase code.'),
    "continue",
  );
  assert.equal(
    detectContinuePrompt("Reply with **continue** and I'll finish the build."),
    "continue",
  );
  assert.equal(detectContinuePrompt("Type `keep going`."), "keep going");
  assert.equal(detectContinuePrompt('Send "build it" whenever you like.'), "build it");
});

test("ignores messages that only mention continuing in passing", () => {
  assert.equal(
    detectContinuePrompt("The build will continue automatically after verification."),
    null,
  );
  assert.equal(detectContinuePrompt("I could not continue because the preview crashed."), null);
  assert.equal(detectContinuePrompt(""), null);
  assert.equal(detectContinuePrompt(null), null);
});

test("only accepts a known short word, not an arbitrary quoted string", () => {
  assert.equal(
    detectContinuePrompt('Reply with "the full requirements document" to proceed.'),
    null,
  );
});

test("continueLabel normalises the caption", () => {
  assert.equal(continueLabel("continue"), "Continue");
  assert.equal(continueLabel("proceed"), "Continue");
  assert.equal(continueLabel("go on"), "Go On");
  assert.equal(continueLabel("build it"), "Build It");
});
