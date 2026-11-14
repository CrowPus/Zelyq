import assert from "node:assert/strict";
import { test } from "node:test";
import { spokenPart } from "../src/lib/ops-voice.js";

test("only a reply's opening sentence is read aloud, without Markdown marks", () => {
  assert.equal(
    spokenPart("Done: **production** exists on box and is protected. I checked it.\n\nDetails…"),
    "Done: production exists on box and is protected.",
  );
  assert.equal(
    spokenPart("The plan waits for your approval!\nRead it first."),
    "The plan waits for your approval!",
  );
  assert.equal(spokenPart("Run `npm test` first."), "Run npm test first.");
  assert.equal(spokenPart("No full stop here"), "No full stop here");
});
