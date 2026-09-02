# Review and amendments (second pass)

Reviewer: second specialist. Date: 2026-09-02.
Reviewed: `report-source.md` and `01`–`06` plus `claim-to-source-ledger.md`, all dated 2026-09-01.

## Verdict in one paragraph

The first pass is architecturally sound and I am keeping ~85% of it. Its seven code findings
(F1–F9) are real — I re-derived every one of them from the current checkout, and none needs to be
withdrawn. What it got wrong is the **evidence**, and the evidence is what decides the ordering.
Every number in it was measured against a stale `dist/` build, so the static request floor is
understated by 30–57%. More seriously, the whole package treats Zelyq's stored token counters as
usable, and they are not: `messages.tokens_in` stores a session-cumulative running total in a
per-message column, so `sessions.tokens_in` is quadratically inflated. Once the counter is
differenced back into real per-turn deltas, the actual production picture is very different from
the "85% input / 15% output" scenario the strategy is built on — **output is 0.8% of processed
tokens, and 95% of the corpus is Gemini, not Anthropic.** That flips the priority order.

Nothing here changes the honest framing of "up to 90%", which I fully endorse and would not soften.

---

## R1 — NEW, P0: the token counter is broken, so every baseline in this package is unusable

**Not in the first pass.** Its F5 says accounting is "tokens, not money". The deeper problem is
that the tokens are wrong too.

`apps/agent/src/session.ts:2473-2486` accumulates `this.tokensIn` / `this.tokensOut` across the
whole agent-process lifetime and emits **that cumulative total** on every `usage` event.
`apps/server/src/ws/gateway.ts:512-514` stores it on the assistant message row as if it were that
message's usage, then `:535` calls `sessions.addUsage(...)`, which *adds* the cumulative total to
the session total (`packages/db/src/repositories/sessions.ts:66-76`).

So after N turns, `sessions.tokens_in` ≈ Σ of running totals ≈ N(N+1)/2 × average — not the sum of
anything. And `messages.tokens_in` is monotonically climbing garbage. Measured on `data/zelyq.db`:

| | value |
|---|---|
| stored `sum(messages.tokens_in)` | 508,036,096 |
| true total after differencing | 242,250,540 |
| inflation | **2.1×** (grows with turns per session) |

One real session's stored per-message `tokens_in` reads `101,324 → 145,996 → 193,768 → … →
9,678,591` — a running total, not 19 messages. Values also *drop* mid-session, because an agent
process restart resets the in-memory counter, so the series is not even consistently cumulative.

**Why it matters:** `06-measurement-and-rollout.md` proposes paired A/B runs and a ≥90% gate. Run
against this counter, a candidate that shortens sessions would score a fake win purely because
fewer turns means less quadratic inflation. Phase 0 cannot be "add cost fields" — it has to be
"fix the count first."

**Solution (small, do it before anything else):**

1. In `session.ts`, emit the per-round delta alongside the cumulative total:
   `{ type: "usage", tokensIn, tokensOut, deltaIn, deltaOut, cacheReadTokens, cacheCreationTokens }`.
2. In `gateway.ts`, accumulate the deltas into `assistant.tokensIn` for the message row, and pass
   the same accumulated delta — not the cumulative field — to `addUsage`.
3. Add `cache_read_tokens` and `cache_creation_tokens` columns to `messages`; they are computed in
   `session.ts:2475-2476` today and thrown away at the gateway.
4. Backfill is not possible and not needed. Mark rows before the migration `usage_schema = 1` and
   exclude them from any baseline.
5. Add a repository test asserting that two turns of 100/50 produce a session total of 200/100,
   not 300/150. That test would have caught this.

`docs/token-usage/measure/true-usage.mjs` reconstructs correct deltas from existing data and is
the only safe way to read the historical corpus until the fix lands.

---

## R2 — AMEND: the static floor numbers are understated by 30–57% (stale build)

`01-current-state-findings.md` reports base 1,718 / Engineer 3,392 / Architect 11,084 tokens and
"about 15.5k estimated tokens" for an empty-history Architect request, citing compiled
`buildSystemPrompt()`.

The compiled `dist/` in this workspace was stale — it contained 14 tools and predated `find_files`
(shipped in `ee6aa21`) and recent prompt work. Rebuilding both packages and re-running the same
chars/4 proxy gives:

| Measurement | First pass | Rebuilt, bare | Rebuilt, **production shape** |
|---|---:|---:|---:|
| base system prompt | 1,718 | 2,502 | 2,793 |
| Engineer system prompt | 3,392 | 4,175 | **10,903** |
| Architect system prompt | 11,084 | 11,867 | **19,765** |
| tool JSON, base | 2,262 (14 tools) | 2,487 (15 tools) | 1,945 (12, Supabase unlinked) |
| tool JSON, Engineer | — | — | 3,534 (15 + 4 passes) |
| tool JSON, Architect | 4,399 (19 tools) | — | 4,612 (15 + dispatch + 4) |
| **Architect static floor** | **~15.5k** | — | **~24,400** |

"Production shape" means what a real session actually sends: the 74-entry design-reference catalog,
`design-md/Agent.md` (1,909 tokens), the AI-provider catalog, `ai-providers/Agent.md` (882), and the
mode's skill body (`senior-software-engineering` 12.5 KB, `report-page-skill` 12.9 KB) — all of
which `session.ts:1435-1472` passes in and the first pass's measurement left out.

**Why it matters:** at 30 iterations, an Architect turn re-transmits ~732k tokens of *static*
prefix. On a provider where the cache misses, the prefix alone is over half the turn. The first
pass ranked tool-schema trimming as priority 1 partly because it under-measured the prompt; the
prompt is 4× the tools.

**Solution:** replace the finding's numbers with the table above, and make the measurement
reproducible — `docs/token-usage/measure/static-floor.mjs`, with a build step in front of it.
Add a CI check that fails if the Architect static floor grows more than 10% without a note, the
same shape as the existing prompt-hash gate in `4154d3f`.

---

## R3 — AMEND: the cost model's workload assumption is wrong for Zelyq

`02-reduction-strategy.md` ("Why this can approach 90%") and the `05-cost-model.md` scenario table
both build on "85% repeated input, 15% output". The first pass labels this "a transparent scenario,
not a measured Zelyq result", which is honest — but it is then used to order the whole stack, so
being wrong about it has consequences.

Measured across 199 real user turns:

| | value |
|---|---:|
| true uncached input tokens | 242,250,540 |
| true output tokens | 1,892,178 |
| **output share of processed tokens** | **0.8%** |
| uncached input per turn, p50 / p90 / max | 133,125 / 3,064,532 / **17,310,681** |
| output per turn, p50 / p90 / max | 2,945 / 29,986 / 101,925 |

Even at a 5× output price multiplier, output is roughly 4% of spend. It is a rounding error.

Two consequences:

- **Bounded output (`02` lever 4, `04` Phase 4) cannot deliver a material saving.** Keep it — an
  unbounded `max_tokens: 128_000` on Anthropic and no completion cap at all on the
  OpenAI-compatible adapter are real tail risks, and F6 is correct that they make budgets
  unenforceable. But demote it from a savings lever to a *safety* control, and stop counting its
  35% output reduction in the 90% arithmetic. Redo the `05` scenario table with an input share of
  ~96%, which makes the 90% target *easier* to state and harder to reach by any single lever.
- **The p90/max tail is where the money is.** A p50 of 133k and a p90 of 3.06M is a 23× spread.
  Fleet cost is not driven by the median session; it is driven by a handful of turns that spend
  17 million uncached input tokens. `06`'s corpus should be re-weighted to over-sample the tail,
  not to "represent traffic" evenly.

---

## R4 — AMEND: reprioritise around Gemini, which is 95% of actual usage

The package is written Anthropic-first: Anthropic gets the most detailed adapter section, and the
"strongest single verified price lever is repeated-input caching" argument leans on Anthropic's
0.1× read. But Anthropic is already the one provider where Zelyq has shipped caching. Measured
usage:

| provider / model | turns | uncached input | per turn | worst turn |
|---|---:|---:|---:|---:|
| google / gemini-3.7-flash | 185 | 230,760,526 | 1,247,354 | 17,310,681 |
| openai / gpt-5.4 | 4 | 5,922,239 | 1,480,560 | 3,064,532 |
| anthropic / claude-opus-5 | 6 | 5,406,961 | 901,160 | 2,359,492 |
| openai / gpt-5.1 | 4 | 160,814 | 40,204 | 89,919 |

95% of the corpus is Gemini Flash, and `apps/agent/src/providers/google.ts:145-158` sends
`systemInstruction` + `tools` + append-only `contents` with **no `cachedContent`**, relying entirely
on implicit caching. Whether implicit caching fires is unknown, because `cachedContentTokenCount`
is captured at `google.ts:175` and then discarded by the gateway (R1). 1.25M uncached tokens per
turn strongly suggests it mostly does not.

**Solution — new priority 1, ahead of tool gating:** *make the static prefix cost once per session
on every provider.* For Google specifically, create explicit `cachedContent` for the
system-instruction + tools block at session start when it clears the model minimum (an Architect
session's ~24.4k-token prefix clears it comfortably), store the cache name and expiry in session
state, and record hit/miss. This is a bounded change to one adapter that addresses the largest
single measured line item. `03-provider-matrix.md` already lists explicit Gemini caching as an
option — it just ranks it as an "evaluate" rather than the headline action, which the usage data
does not support.

I am **not** demoting dynamic tool schemas (`02` lever 1) — 1,945–4,612 tokens re-sent on every one
of ~30 rounds is real. I am saying it is second, and that its target should be stated against the
measured Architect floor of 24.4k, not the phantom 15.5k.

---

## R5 — NEW: `grantSpecialistTools` mutates the tool array mid-session and voids the cache

`04-implementation-design.md` states the right principle — "Do not dynamically remove definitions
inside an active prefix; start a new epoch when necessary" — but does not notice that Zelyq
**already does this today**.

`apps/agent/src/session.ts:2164` pushes new tool definitions into the live `liveTools` array when a
`/agent` mention grants a specialist pass tool. The array is held by reference and read by the
provider on every subsequent request.

On Anthropic the cache prefix is ordered tools → system → messages. Appending one tool changes the
very first cached segment, so a single mid-session `/agent` mention invalidates the system prompt
**and the entire conversation transcript**. Every following request re-pays a full cache write on
the whole prefix. On an Architect session that is ~24.4k static tokens plus the full transcript,
re-written at 1.25×.

**Solution:** include the four specialist pass tools (`design_pass`, `ops_pass`, `qa_pass`,
`cinematic_pass` — 1,047 proxy tokens together) in the pool at session construction for any
non-lean session, exactly as Engineer and Architect mode already do at `session.ts:1422-1425`.
Paying 1,047 tokens once is unconditionally cheaper than one prefix invalidation. Keep
`grantSpecialistTools` only as the lean-child guard it already contains, and add a comment plus a
test asserting `liveTools` is not mutated after the first request.

---

## R6 — NEW: use Anthropic's 1-hour cache TTL

`03-provider-matrix.md` correctly records the 5-minute default lifetime as a *limit*, but the
package never proposes acting on it. Anthropic supports a 1-hour TTL at a higher write multiplier.

Zelyq agent turns routinely run long tool calls between model requests — `run_command` and preview
builds are minutes, and a user reading a plan before replying is longer still. Every gap over five
minutes drops the whole transcript out of cache and re-pays it at full price on the next round.

**Solution:** make TTL a capability-record field, default 5m, and switch to 1h when the session's
observed inter-request gap p90 exceeds ~3 minutes, or unconditionally for Architect Mode (long
interview pauses, expensive prefix). The break-even math already in `05-cost-model.md` extends
directly: with write multiplier `w` and read `r`, the longer TTL wins when it converts a cold
re-write into a read, which at `r = 0.1` needs only one saved miss to pay for itself.

---

## R7 — SHARPEN: F3a is about tool *inputs* as much as tool *results*

F3a is correct and important: `session.ts:2543` and `:3042` cap the **persisted** `ToolCall.result`
at 4,000 characters, while the live provider conversation receives the full `outcome.output` —
verified caps are 60,000 chars for `read_file` (`packages/tools/src/files.ts:42`) and 30,000 for
`run_command` and friends (`packages/tools/src/types.ts:71`). That is right.

What it misses is the mirror image on the input side. `stripHeavyToolInputs` runs only in
`gateway.ts:532`, at persist time. The live in-memory conversation keeps every `write_file` /
`edit_file` body forever. The prior audit's own headline — 68.5% of tool-call bytes are those
bodies — therefore describes the *live* conversation, which is never stripped, not the persisted
one, which already is.

This produces an inversion worth stating plainly: **a resumed Zelyq session is dramatically cheaper
than the live session it resumed from.** The first pass notes stripping is "strong cross-provider
reduction after session rebuild" but does not draw the conclusion that the live path is the
expensive one.

**Solution:** apply the same reduction to the live conversation, one round late. Once a tool
call/result pair is superseded by the next assistant turn, rewrite the assistant's `tool_use` input
to `{ path, bytes, sha256 }` and the `tool_result` to a bounded excerpt plus an artifact handle.
This is exactly the `artifacts.ts` module `04-implementation-design.md` Phase 1 already specifies —
it just needs to be applied to the in-memory `Conversation`, not only at the persistence seam. Note
the interaction with R4/caching: rewriting history invalidates the prefix, so the rewrite must
happen in large batched epochs (the 70%→45% step `02` already proposes), never per round.

---

## R8 — CORRECT: two smaller factual fixes

- **F3, "exposes all 14 core tools regardless of task".** Two errors. `ALL_TOOLS` is 15, not 14
  (`packages/tools/src/index.ts:56-71`). And the three Supabase tools are *already* gated on a
  linked resource at `session.ts:1408-1428`, so an unlinked project sends 12 tools / 1,945 tokens,
  not 15 / 2,487. The finding's direction is right, its baseline is 22% too high.
- **`04`, "Create a Responses API adapter for current models instead of forcing all API-key traffic
  through Chat Completions".** `apps/agent/src/providers/chatgpt-responses.ts` already exists.
  Verify whether it is reachable for API-key traffic or only for subscription/OAuth sessions before
  writing this as new work — the task may be *routing to* an existing adapter, not building one.

---

## Amended priority order

The first pass's stack is kept; the ordering changes on evidence. Targets are stated against
measured Architect numbers.

| New | Old | Lever | Why it moved |
|---:|---:|---|---|
| 0 | 0 | **fix the usage counter** (R1) | nothing below is measurable until this lands |
| 1 | 3 | **prefix caching that actually fires — Gemini explicit `cachedContent` first** (R4, R6) | 95% of measured spend is on the one provider with no explicit cache |
| 2 | 2 | **live artifact-backed history, inputs and results** (R7) | the live path is the expensive one; the persisted path is already fixed |
| 3 | 1 | dynamic tool schemas | real (1,945–4,612 × ~30 rounds) but 4× smaller than the prompt |
| 4 | 5 | fewer rounds / early stop | multiplies everything above; 50-iteration cap is the amplifier |
| 5 | 6 | model routing | unchanged, still gated behind quality |
| 6 | 4 | bounded reasoning/output | **demoted to a safety control** — output is 0.8% of tokens (R3) |
| 7 | 7 | batch/flex/response cache | unchanged |

## What I did not change

- The refusal to promise 90% universally, and the three-label discipline (observed cost / observed
  token / projected). This is the best part of the package and I would defend it as written.
- F1, F2, F4, F7, F8, F9 — all verified against the current checkout, all stand. I confirmed the
  OpenAI-compatible adapter sends no `prompt_cache_key`, no completion cap, and no DeepSeek
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` parsing
  (`providers/openai-compatible.ts:209-268`), and that Google sets no `maxOutputTokens`.
- The provider matrix and the claim-to-source ledger. I did not re-verify the external vendor
  documentation; the ledger's dated-source discipline is the right control for it.
- The release gates and rollback plan in `06`, other than the corpus re-weighting in R3.

## Reproducing every number above

```sh
pnpm --filter @zelyq/tools build && pnpm --filter @zelyq/agent build
node docs/token-usage/measure/static-floor.mjs      # prompt + tool floor by mode
node docs/token-usage/measure/true-usage.mjs        # real per-turn usage from data/zelyq.db
```

Both use a chars/4 proxy for the static floor and provider-reported counts for usage. The proxy
still has to be replaced with real counts in Phase 0 — for Anthropic that is the free
`/v1/messages/count_tokens` endpoint, which needs no inference call and belongs in the
`countTokens()` seam `04-implementation-design.md` already specifies.
