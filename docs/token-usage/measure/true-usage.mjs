/**
 * Reconstructs TRUE per-turn token usage from a Zelyq database.
 *
 * `messages.tokens_in` / `tokens_out` are NOT that message's usage — the agent
 * emits a session-cumulative running total and the gateway stores it verbatim
 * (see 07-review-and-amendments.md, R1). This script differences the monotonic
 * runs back into per-turn deltas, restarting a run whenever the counter drops
 * (an agent process restart resets the in-memory counter).
 *
 *   node docs/token-usage/measure/true-usage.mjs [path/to/zelyq.db]
 */
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2] ?? "data/zelyq.db";
const db = new DatabaseSync(path, { readOnly: true });

const sessions = Object.fromEntries(
  db.prepare("select id, provider, model, effort from sessions").all().map((s) => [s.id, s]),
);
const rows = db
  .prepare("select session_id, tokens_in, tokens_out from messages where role = ? order by session_id, created_at")
  .all("assistant");

const bySession = {};
for (const r of rows) (bySession[r.session_id] ||= []).push(r);

const deltasIn = [];
const deltasOut = [];
const byModel = {};
let storedSum = 0;

for (const r of rows) storedSum += r.tokens_in;

for (const id of Object.keys(bySession)) {
  const meta = sessions[id] ?? { provider: "?", model: "?" };
  const key = `${meta.provider} / ${meta.model}`;
  const agg = (byModel[key] ||= { turns: 0, in: 0, out: 0, maxTurn: 0 });
  let prevIn = 0;
  let prevOut = 0;
  for (const r of bySession[id]) {
    if (r.tokens_in === 0 && r.tokens_out === 0) continue; // no usage recorded
    let dIn = r.tokens_in - prevIn;
    let dOut = r.tokens_out - prevOut;
    if (dIn < 0 || dOut < 0) {
      dIn = r.tokens_in; // counter reset — a new agent process
      dOut = r.tokens_out;
    }
    prevIn = r.tokens_in;
    prevOut = r.tokens_out;
    if (dIn <= 0 && dOut <= 0) continue;
    deltasIn.push(dIn);
    deltasOut.push(dOut);
    agg.turns += 1;
    agg.in += dIn;
    agg.out += dOut;
    agg.maxTurn = Math.max(agg.maxTurn, dIn);
  }
}

const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
const n = (x) => x.toLocaleString();
const totalIn = deltasIn.reduce((s, x) => s + x, 0);
const totalOut = deltasOut.reduce((s, x) => s + x, 0);

console.log(`db: ${path}`);
console.log(`user turns with usage:            ${n(deltasIn.length)}`);
console.log(`TRUE uncached input tokens:       ${n(totalIn)}`);
console.log(`TRUE output tokens:               ${n(totalOut)}`);
console.log(`naive sum of stored per-message:  ${n(storedSum)}  (${(storedSum / totalIn).toFixed(1)}x inflated)`);
console.log(`uncached input / turn p50 p90 max ${n(pct(deltasIn, 0.5))}  ${n(pct(deltasIn, 0.9))}  ${n(Math.max(...deltasIn))}`);
console.log(`output / turn        p50 p90 max  ${n(pct(deltasOut, 0.5))}  ${n(pct(deltasOut, 0.9))}  ${n(Math.max(...deltasOut))}`);
console.log(`output share of processed tokens: ${((100 * totalOut) / (totalIn + totalOut)).toFixed(1)}%`);
console.log();
console.log("provider / model".padEnd(40), "turns".padStart(6), "uncachedIn".padStart(14), "out".padStart(10), "in/turn".padStart(12), "maxTurn".padStart(12));
for (const [k, a] of Object.entries(byModel).sort((x, y) => y[1].in - x[1].in)) {
  console.log(
    k.padEnd(40),
    String(a.turns).padStart(6),
    n(a.in).padStart(14),
    n(a.out).padStart(10),
    n(Math.round(a.in / a.turns)).padStart(12),
    n(a.maxTurn).padStart(12),
  );
}
