import assert from "node:assert/strict";
import { test } from "node:test";
import type { Content } from "@google/genai";
import { OMITTED_TOOL_INPUT_MARKER } from "@zelyq/core";
import { reduceChatGptHistory } from "../src/providers/chatgpt-responses.js";
import { reduceGoogleHistory } from "../src/providers/google.js";
import {
  REDUCTION_THRESHOLD_CHARS,
  REPIN_AFTER_ENTRIES,
  RESULT_KEEP_CHARS,
  recoverableChars,
  reduceToolArgumentsJson,
  reduceToolInput,
  reduceToolResultText,
  safeCacheBoundary,
} from "../src/providers/history-reduction.js";
import { reduceChatHistory } from "../src/providers/openai-compatible.js";

/**
 * R7 — `stripHeavyToolInputs` runs at the persistence seam only, so the LIVE
 * conversation keeps every `write_file` body forever and re-sends it on every
 * iteration. These cover the live-side sweep that closes that gap.
 */

const BIG = "x".repeat(60_000);

test("a heavy write_file body is replaced with the same marker the persisted side uses", () => {
  const reduced = reduceToolInput("write_file", { path: "src/App.tsx", content: BIG });
  assert.deepEqual(reduced, { path: "src/App.tsx", content: OMITTED_TOOL_INPUT_MARKER });
});

test("a small edit stays inline — the saving is all in the large ones", () => {
  assert.equal(reduceToolInput("edit_file", { path: "a.ts", old_text: "x", new_text: "y" }), null);
  assert.equal(reduceToolInput("read_file", { path: "a.ts" }), null);
});

test("malformed arguments are left exactly as they are", () => {
  assert.equal(reduceToolArgumentsJson("write_file", "{not json"), null);
  assert.equal(reduceToolArgumentsJson("write_file", "[1,2]"), null);
});

test("recoverableChars measures what a sweep would actually save", () => {
  const saved = recoverableChars("write_file", { path: "a.ts", content: BIG });
  assert.ok(saved > 59_000, `expected most of the body back, got ${saved}`);
  assert.equal(recoverableChars("read_file", { path: "a.ts" }), 0);
});

/** One Gemini `model` turn carrying a heavy write. */
const geminiWrite = (n: number): Content => ({
  role: "model",
  parts: [{ functionCall: { name: "write_file", args: { path: `f${n}.tsx`, content: BIG } } }],
});
const geminiResult = (): Content => ({
  role: "user",
  parts: [{ functionResponse: { name: "write_file", response: { output: "written" } } }],
});

test("Gemini: nothing is rewritten until a sweep is worth the prefix change it costs", () => {
  // One 60k body is well under the threshold — rewriting for it would throw
  // away the cached prefix to save less than the invalidation costs.
  const small: Content[] = [geminiWrite(1), geminiResult(), geminiWrite(2), geminiResult()];
  assert.equal(reduceGoogleHistory(small), small, "must be the same array, not a copy");
});

test("Gemini: past the threshold the bodies go and the shape survives", () => {
  const contents: Content[] = [];
  // Enough to cross the threshold, plus the untouched tail.
  const rounds = Math.ceil(REDUCTION_THRESHOLD_CHARS / BIG.length) + 4;
  for (let i = 0; i < rounds; i++) {
    contents.push(geminiWrite(i), geminiResult());
  }
  const out = reduceGoogleHistory(contents);
  assert.notEqual(out, contents);
  assert.equal(out.length, contents.length, "no entry may be dropped — pairs must stay intact");

  const args = out[0]?.parts?.[0]?.functionCall?.args as Record<string, unknown>;
  assert.equal(args.content, OMITTED_TOOL_INPUT_MARKER);
  assert.equal(args.path, "f0.tsx", "the path is what makes the body re-readable — keep it");

  // The round in flight is never touched.
  const tail = out[out.length - 2]?.parts?.[0]?.functionCall?.args as Record<string, unknown>;
  assert.equal(tail.content, BIG, "the newest call must survive verbatim");
});

test("OpenAI dialect: same threshold, same untouched tail", () => {
  const messages: Parameters<typeof reduceChatHistory>[0] = [];
  const rounds = Math.ceil(REDUCTION_THRESHOLD_CHARS / BIG.length) + 4;
  for (let i = 0; i < rounds; i++) {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: `c${i}`,
          type: "function",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: `f${i}.tsx`, content: BIG }),
          },
        },
      ],
    });
    messages.push({ role: "tool", tool_call_id: `c${i}`, content: "written" });
  }
  const out = reduceChatHistory(messages);
  assert.equal(out.length, messages.length);
  const first = out[0];
  assert.ok(first?.role === "assistant" && first.tool_calls);
  assert.ok(first.tool_calls[0]!.function.arguments.includes(OMITTED_TOOL_INPUT_MARKER));
  const last = out[out.length - 2];
  assert.ok(last?.role === "assistant" && last.tool_calls);
  assert.ok(last.tool_calls[0]!.function.arguments.includes(BIG), "newest call untouched");
});

test("Responses API: same rule over its flat input array", () => {
  const items: Parameters<typeof reduceChatGptHistory>[0] = [];
  const rounds = Math.ceil(REDUCTION_THRESHOLD_CHARS / BIG.length) + 4;
  for (let i = 0; i < rounds; i++) {
    items.push({
      type: "function_call",
      call_id: `c${i}`,
      name: "write_file",
      arguments: JSON.stringify({ path: `f${i}.tsx`, content: BIG }),
    });
    items.push({ type: "function_call_output", call_id: `c${i}`, output: "written" });
  }
  const out = reduceChatGptHistory(items);
  assert.equal(out.length, items.length);
  const first = out[0];
  assert.ok(first?.type === "function_call");
  assert.ok(first.arguments.includes(OMITTED_TOOL_INPUT_MARKER));
  const last = out[out.length - 2];
  assert.ok(last?.type === "function_call" && last.arguments.includes(BIG));
});

test("a realistic Zelyq session trips the threshold — the 200k it used to be never did", () => {
  // Measured from a real session (a todo app, 4 turns): the live conversation
  // carried 36 whole file bodies, and the project's own source totals ~45k
  // characters. The old 200,000 threshold would not have fired once across the
  // whole session, while that session's fourth turn still paid 248,253
  // uncached input tokens.
  const bodies: Content[] = [];
  const FILE = "y".repeat(4_000); // a mid-sized component
  for (let i = 0; i < 12; i++) {
    bodies.push(
      {
        role: "model",
        parts: [
          { functionCall: { name: "write_file", args: { path: `c${i}.tsx`, content: FILE } } },
        ],
      },
      geminiResult(),
    );
  }
  // 12 written files, of which the newest is held back by the tail guard, so
  // ~44k characters are sweepable — over the threshold, nowhere near the old
  // 200k.
  const out = reduceGoogleHistory(bodies);
  assert.notEqual(out, bodies, "a dozen component writes must be enough to trip a sweep");
  const first = out[0]?.parts?.[0]?.functionCall?.args as Record<string, unknown>;
  assert.equal(first.content, OMITTED_TOOL_INPUT_MARKER);
});

// ---------------------------------------------------------------------------
// Tool RESULTS. Measured on one real Gemini turn (a motion/theme pass over a
// todo app): tool inputs totalled 2,989 characters, tool results 74,704 — and
// that is with each stored result already capped at 4,000. Live, its 17
// `read_file` results carried whole files. The turn cost 3,980,570 prompt
// tokens at a 10.8% cache hit rate.
// ---------------------------------------------------------------------------

test("a small result is left completely alone", () => {
  assert.equal(reduceToolResultText("written"), null);
  assert.equal(reduceToolResultText("x".repeat(RESULT_KEEP_CHARS)), null);
});

test("a big result keeps both ends — the tail is where exit lines and paging live", () => {
  const body = `${"HEAD".repeat(10)}${"m".repeat(50_000)}${"TAIL".repeat(10)}`;
  const reduced = reduceToolResultText(body);
  assert.ok(reduced);
  assert.ok(reduced.startsWith("HEAD"), "the start of a file/command must survive");
  assert.ok(
    reduced.endsWith("TAIL"),
    "the end — exit status, 'showing lines X of Y' — must survive",
  );
  assert.match(reduced, /characters dropped from history — re-run the tool/);
  assert.ok(reduced.length < 2_500, `expected a bounded excerpt, got ${reduced.length}`);
});

test("Gemini: a superseded read_file result is cut down, an ERROR result never is", () => {
  const big = "z".repeat(50_000);
  const contents: Content[] = [];
  for (let i = 0; i < 4; i++) {
    contents.push(
      {
        role: "model",
        parts: [{ functionCall: { name: "read_file", args: { path: `f${i}.tsx` } } }],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "read_file",
              // Alternate success and failure: only the successes may shrink.
              response: i % 2 === 0 ? { output: big } : { error: big },
            },
          },
        ],
      },
    );
  }
  // Two 50k successes are well past the threshold; the tail guard holds back
  // the newest pair.
  const out = reduceGoogleHistory(contents);
  assert.notEqual(out, contents);

  const first = out[1]?.parts?.[0]?.functionResponse?.response as Record<string, unknown>;
  assert.ok(String(first.output).length < 2_500, "a superseded success must be cut down");

  const failure = out[3]?.parts?.[0]?.functionResponse?.response as Record<string, unknown>;
  assert.equal(failure.error, big, "an error result must survive whole — truncating it misleads");
});

test("OpenAI dialect: tool results are swept too, not just arguments", () => {
  const big = "q".repeat(50_000);
  const messages: Parameters<typeof reduceChatHistory>[0] = [];
  for (let i = 0; i < 4; i++) {
    messages.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `c${i}`,
            type: "function",
            function: { name: "read_file", arguments: JSON.stringify({ path: `f${i}.tsx` }) },
          },
        ],
      },
      { role: "tool", tool_call_id: `c${i}`, content: big },
    );
  }
  const out = reduceChatHistory(messages);
  const first = out[1];
  assert.ok(first?.role === "tool");
  assert.ok(first.content.length < 2_500, "a superseded result must be cut down");
  const newest = out[out.length - 1];
  assert.ok(newest?.role === "tool" && newest.content === big, "the newest result stays whole");
});

test("Responses API: same, over its flat input array", () => {
  const big = "w".repeat(50_000);
  const items: Parameters<typeof reduceChatGptHistory>[0] = [];
  for (let i = 0; i < 4; i++) {
    items.push(
      {
        type: "function_call",
        call_id: `c${i}`,
        name: "read_file",
        arguments: JSON.stringify({ path: `f${i}.tsx` }),
      },
      { type: "function_call_output", call_id: `c${i}`, output: big },
    );
  }
  const out = reduceChatGptHistory(items);
  const first = out[1];
  assert.ok(first?.type === "function_call_output" && first.output.length < 2_500);
  const newest = out[out.length - 1];
  assert.ok(newest?.type === "function_call_output" && newest.output === big);
});

// ---------------------------------------------------------------------------
// Conversation pinning. Pinning only the static prefix left the transcript
// itself uncached, and a session carries its transcript across turns: measured
// on two consecutive turns of one real session, the second turn did 31% LESS
// work for 31% MORE uncached input (1,649,233 vs 1,262,048) because it started
// where the first one ended.
// ---------------------------------------------------------------------------

test("a cache boundary never splits a model turn from its tool results", () => {
  // Gemini alternates model -> user(results). Cutting after the model entry
  // would replay a functionCall server-side with its functionResponse sent
  // inline — a malformed request.
  const roles = ["user", "model", "user", "model", "user", "model"];
  assert.equal(safeCacheBoundary(roles, 6), 5, "must fall back to just past the last user entry");
  assert.equal(safeCacheBoundary(roles, 5), 5);
  assert.equal(safeCacheBoundary(roles, 4), 3);
  assert.equal(safeCacheBoundary(roles, 2), 1);
});

test("no safe boundary means pin the static prefix only", () => {
  assert.equal(safeCacheBoundary(["model"], 1), 0);
  assert.equal(safeCacheBoundary([], 0), 0);
});

test("the boundary is never past the limit it was given", () => {
  const roles = ["user", "user", "user", "user"];
  for (let limit = 0; limit <= roles.length; limit++) {
    assert.ok(safeCacheBoundary(roles, limit) <= limit, `limit ${limit}`);
  }
});

test("re-pin cadence sits near the arithmetic optimum, not at either extreme", () => {
  // Re-pinning costs S; R rounds between pins cost ~R^2*d/2. The optimum is
  // R = sqrt(2S/d). Pinning every round would pay S every round; never pinning
  // is what the measurement above showed costs.
  const S = 60_000;
  const d = 1_500;
  const optimalRounds = Math.sqrt((2 * S) / d);
  const roundsBetweenPins = REPIN_AFTER_ENTRIES / 2; // two entries per round
  assert.ok(
    roundsBetweenPins > 1 && roundsBetweenPins < optimalRounds * 1.5,
    `${roundsBetweenPins} rounds should sit under ~${(optimalRounds * 1.5).toFixed(1)}`,
  );
});
