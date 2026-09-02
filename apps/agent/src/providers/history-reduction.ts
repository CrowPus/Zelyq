import { OMITTED_TOOL_INPUT_MARKER, stripHeavyToolInputs, type ToolCall } from "@zelyq/core";

/**
 * R7 — the live conversation is the expensive one.
 *
 * `stripHeavyToolInputs` runs at the persistence seam only, so a **resumed**
 * Zelyq session is dramatically cheaper than the live session it resumed from:
 * every `write_file` / `edit_file` body the model ever sent stays in the
 * in-memory provider history for the rest of the session, and is re-transmitted
 * on every iteration. Those bodies were measured at 68.5% of all tool-call
 * bytes, and they duplicate what is already on disk and re-readable.
 *
 * This module applies the identical reduction to the live history — same
 * fields, same marker, same threshold — so the two sides cannot drift.
 *
 * **Why it is batched, not continuous.** Rewriting an old entry changes the
 * request prefix, so a sweep costs whatever caching that prefix was getting.
 * Done per round it would churn the prefix constantly. So a sweep waits until
 * enough recoverable payload has accumulated to be worth it, and then the
 * transcript stays smaller for every round after.
 */

/**
 * Recoverable characters that must accumulate before a sweep is worth it.
 *
 * This is deliberately low, and the reason is what the providers using this
 * module actually do with the conversation. Only Anthropic puts the transcript
 * itself inside an explicit `cache_control` prefix, where a rewrite forfeits a
 * real 0.1x discount — and Anthropic does not use this module at all
 * (`ZELYQ_CONTEXT_EDITING` does the same job server-side, without
 * invalidating). For Google and the OpenAI dialect the transcript is only ever
 * *implicitly* cached, if at all: measured on a real Zelyq session, a fourth
 * turn still paid 248,253 uncached input tokens, so there was no discount to
 * protect. A sweep there is close to free and should happen early.
 *
 * An earlier 200,000 was set by reasoning about Anthropic's economics and then
 * applied to providers that do not share them. On the measured session — a todo
 * app whose live history carried 36 stripped-at-persist file payloads, roughly
 * 48,000 characters in total — it would never have fired once, while that
 * session's fourth turn still paid 248,253 uncached input tokens.
 *
 * 30,000 characters is about 7.5k tokens: low enough to fire partway through an
 * ordinary build rather than never, high enough that it is not rewriting the
 * array every round. The exact figure is a benchmark parameter, not a truth —
 * re-tune it against real `usage_schema = 1` data once that exists.
 *
 * If a reducer is ever added for Anthropic, it needs its own higher threshold;
 * this constant is not one-size-fits-all and should become per-provider then.
 */
export const REDUCTION_THRESHOLD_CHARS = 30_000;

/**
 * Native entries at the tail that are never touched: the round in flight. The
 * model may still be reasoning about the arguments it just sent, and a
 * `tool_use` must keep its matching `tool_result` intact either way.
 */
export const REDUCTION_TAIL_KEEP = 4;

/**
 * A superseded tool RESULT larger than this is cut down to an excerpt.
 *
 * Results, not inputs, are where the weight actually is. Measured on one real
 * Gemini turn (a design/motion pass over a todo app): tool *inputs* totalled
 * 2,989 characters, while tool *results* totalled 74,704 — and that is with
 * every stored result already capped at 4,000. Live, the same 17 `read_file`
 * calls carried whole files, up to 60,000 characters each, and every one of
 * them rode along on every later round. That turn cost 3,980,570 prompt tokens
 * at a 10.8% cache hit rate.
 *
 * `stripHeavyToolInputs` never touched this side, so neither did the first
 * version of this module.
 */
export const RESULT_KEEP_CHARS = 1_200;

/** How much of a cut-down result is kept from each end. */
const RESULT_HEAD_CHARS = 600;
const RESULT_TAIL_CHARS = 300;

/**
 * A superseded tool result, cut to a bounded excerpt — or null when it is
 * already small enough to leave alone.
 *
 * Head AND tail, never just the head: a command's exit line, a compiler's error
 * summary and a paged read's "showing lines X–Y of Z" footer all live at the
 * end, and those are the parts a model reasons from. The note in the middle
 * says what was dropped and that re-running the tool brings it back, so the
 * model has a way forward instead of a silent hole.
 *
 * Callers must not pass an ERROR result. Error identity, exit status and
 * validation output stay whole — a shortened error is how a model ends up
 * confidently fixing the wrong thing.
 */
export function reduceToolResultText(text: string): string | null {
  if (text.length <= RESULT_KEEP_CHARS) return null;
  const head = text.slice(0, RESULT_HEAD_CHARS);
  const tail = text.slice(-RESULT_TAIL_CHARS);
  const dropped = text.length - head.length - tail.length;
  return `${head}\n\n[${dropped} characters dropped from history — re-run the tool to see them again]\n\n${tail}`;
}

/** How many characters a sweep would recover from one tool result. */
export function recoverableResultChars(text: string): number {
  const reduced = reduceToolResultText(text);
  return reduced ? text.length - reduced.length : 0;
}

/** The reduced form of one tool call's input, or null when nothing was heavy. */
export function reduceToolInput(
  name: string,
  input: Record<string, unknown>,
): Record<string, unknown> | null {
  const call: ToolCall = { id: "x", name, input };
  const [reduced] = stripHeavyToolInputs([call]);
  // `stripHeavyToolInputs` returns the same object when it changed nothing.
  return reduced && reduced !== call ? reduced.input : null;
}

/**
 * The same, for the providers that carry arguments as a JSON string. Malformed
 * JSON is left exactly as it is — a history entry is not the place to discover
 * a parse error.
 */
export function reduceToolArgumentsJson(name: string, argsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const reduced = reduceToolInput(name, parsed as Record<string, unknown>);
  return reduced ? JSON.stringify(reduced) : null;
}

/** How many characters a sweep would recover from one tool call. */
export function recoverableChars(name: string, input: Record<string, unknown>): number {
  const reduced = reduceToolInput(name, input);
  if (!reduced) return 0;
  return JSON.stringify(input).length - JSON.stringify(reduced).length;
}

/** The same, for a JSON-string argument list. */
export function recoverableCharsJson(name: string, argsJson: string): number {
  const reduced = reduceToolArgumentsJson(name, argsJson);
  return reduced ? argsJson.length - reduced.length : 0;
}

/**
 * How many un-pinned `contents` entries may pile up before the conversation is
 * re-pinned into a fresh cache.
 *
 * The trade-off is arithmetic. Re-pinning re-writes the whole cache (cost `S`
 * tokens). Between pins, every round re-sends the un-pinned tail at full price,
 * and that tail grows by roughly `d` tokens a round — so `R` rounds between
 * pins cost about `R²·d/2`. Total per round is `S/R + R·d/2`, which is smallest
 * at `R = sqrt(2S/d)`.
 *
 * On the measured session — `S` around 60,000 tokens, `d` around 1,500 — that
 * lands at about 9 rounds. A Gemini round appends two entries (the model turn,
 * then its tool results), so 16 entries is ~8 rounds: the flat part of a very
 * shallow curve, and deliberately on the conservative side because a re-pin is
 * a real charge while an un-pinned round is only a slightly larger one.
 */
export const REPIN_AFTER_ENTRIES = 16;

/**
 * The largest index at or before `limit` that is safe to end a cached prefix on.
 *
 * A cache must never split a model turn from the tool results answering it: the
 * pinned half would be replayed server-side and the other half sent inline,
 * and a `functionCall` without its `functionResponse` is a malformed request.
 * Gemini's history alternates model → user(results), so a boundary is safe
 * immediately after a `user` entry.
 *
 * Returns 0 when there is no safe boundary, which simply means "pin the static
 * prefix only" — the behaviour before conversation pinning existed.
 */
export function safeCacheBoundary(roles: Array<string | undefined>, limit: number): number {
  for (let i = Math.min(limit, roles.length); i > 0; i--) {
    if (roles[i - 1] === "user") return i;
  }
  return 0;
}

export { OMITTED_TOOL_INPUT_MARKER };
