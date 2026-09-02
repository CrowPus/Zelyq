import assert from "node:assert/strict";
import { it, describe as suite } from "node:test";
import type { CheckContext } from "../evals/checks.js";
import { runCheck } from "../evals/checks.js";

/**
 * The Engineer-Mode reply checks the harness appends on an acting turn
 *. These lock the regexes — the likely bug is a
 * pattern that never matches a real reply, or one that matches everything.
 */
function ctx(reply: string): CheckContext {
  return {
    runtime: {} as CheckContext["runtime"],
    projectId: "p",
    before: { files: new Map() } as CheckContext["before"],
    after: { files: new Map() } as CheckContext["after"],
    changed: [],
    toolCalls: 0,
    reply,
  };
}

const PURPOSE = {
  kind: "reply_matches" as const,
  pattern: "^\\s*Purpose:",
  why: "opens with Purpose",
};
const ASSUMED = {
  kind: "reply_matches" as const,
  pattern: "[Aa]ssum(e|ed|ption|ptions)\\b",
  why: "names what was assumed",
};
const VERIFIED = {
  kind: "reply_matches" as const,
  pattern: "[Vv]erif(y|ied|ication)\\b",
  why: "names what was verified",
};

suite("engineer-mode reply checks", () => {
  const good =
    "Purpose: give the user a working counter.\n\n" +
    "Verified: `tsc --noEmit` is clean and the preview renders.\n" +
    "Assumed: a start value of 0, since the request didn't say.\n";

  it("passes a well-formed Engineer-Mode summary", async () => {
    for (const check of [PURPOSE, ASSUMED, VERIFIED]) {
      const r = await runCheck(check, ctx(good));
      assert.equal(r.ok, true, `${check.why}: ${r.detail}`);
    }
  });

  it("Purpose must be at the very start, not buried mid-message", async () => {
    assert.equal((await runCheck(PURPOSE, ctx("Here's what I did.\nPurpose: …"))).ok, false);
    assert.equal((await runCheck(PURPOSE, ctx("  Purpose: fix the bug"))).ok, true);
  });

  it("prose forms count, not just the labelled ones", async () => {
    assert.equal((await runCheck(ASSUMED, ctx("I assumed the API returns JSON."))).ok, true);
    assert.equal((await runCheck(VERIFIED, ctx("I could not verify the deploy step."))).ok, true);
  });

  it("fails a plain summary with none of the three", async () => {
    const plain = "Added a counter component with increment and decrement buttons.";
    for (const check of [PURPOSE, ASSUMED, VERIFIED]) {
      assert.equal((await runCheck(check, ctx(plain))).ok, false, check.why);
    }
  });
});
