import assert from "node:assert/strict";
import { test } from "node:test";
import { insertTranscript, preferredRecordingMimeType } from "../src/lib/voice.js";

test("voice transcript inserts at the cursor without joining words", () => {
  assert.deepEqual(insertTranscript("Build dashboard", "a fast", 5, 5), {
    value: "Build a fast dashboard",
    cursor: 12,
  });
});

test("voice transcript replaces the selected text", () => {
  assert.deepEqual(insertTranscript("Build the old page", "a new", 6, 13), {
    value: "Build a new page",
    cursor: 11,
  });
});

test("empty transcription leaves the draft untouched", () => {
  assert.deepEqual(insertTranscript("Keep this", "   ", 4, 4), {
    value: "Keep this",
    cursor: 4,
  });
});

test("recording chooses the first browser-supported format", () => {
  const checked: string[] = [];
  const selected = preferredRecordingMimeType((mimeType) => {
    checked.push(mimeType);
    return mimeType === "audio/ogg;codecs=opus";
  });
  assert.equal(selected, "audio/ogg;codecs=opus");
  assert.deepEqual(checked, ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]);
});
