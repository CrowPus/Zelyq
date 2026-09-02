# Status after the maintenance branch (PR #128)

Date: 2026-09-02. Written for the next agent to pick up the token-usage program.

The maintenance branch `maint/phase1` (PR #128, on top of Phase 1 #127) shipped several items that
overlap this program. This file records **what is now done**, **what those changes did NOT do**, and
the **verified, ordered list of what is left** — every item re-checked against the current checkout
with file:line pointers.

Everything below was verified on the merged `maint/phase1` tree, commit `751aacc`.

---

## Already shipped by #127 + #128 — do not redo

| This program's finding | Shipped as | Where |
|---|---|---|
| **F1** — history not token-budgeted | newest-N, token-bounded window; forward-trimmed to a `user` boundary | `packages/db/src/repositories/messages.ts` — `historyWindow(rows, maxTokens)`, `estimateRowTokens`; default `limit 400 / maxTokens 180_000` |
| **F2** — no honest exhaustion signal | `context_exhausted` product-state error instead of a raw 400 | `apps/agent/src/providers/index.ts` — `isContextLengthError`; `session.ts` catch block |
| **F3** — 92 tools every session | connection-aware gating: a default top-level session gets ~25 tools, not ~98 | `apps/agent/src/tool-relevance.ts`; `session.ts` `gateToolsForDefaultMode(ALL_TOOLS)` in the `defaultMode` branch |
| **F5** (part) — no cost figure; cache fields discarded on the eval path | eval report gains total prompt size, `% cached`, a `$` line, cost delta in `--compare`; cache tokens captured on the `usage` event and in `packages/core/src/protocol.ts` | `apps/agent/evals/rates.ts`; `session.ts:2529-2530` accumulates `cacheReadTokens` / `cacheCreationTokens` |
| **F6** (part) — unbounded output on Anthropic | per-model `max_tokens` (128K Opus/Sonnet, 64K else) | `apps/agent/src/providers/anthropic.ts` — `maxTokensFor(model)` |
| A2 (persisted side) | `stripHeavyToolInputs` on the assistant message before it is stored | `apps/server/src/ws/gateway.ts:533` |
| Anthropic context editing | `ZELYQ_CONTEXT_EDITING=1` → `context-management-2025-06-27` + `clear_tool_uses_20250919`, live-verified on `claude-opus-5` | `anthropic.ts` — `extraBetaHeader` / `extraRequestBody` |
| Anthropic refusal fallback (C5) | `ZELYQ_REFUSAL_FALLBACK=1` → `server-side-fallback-2026-07-01`, live-verified | same |
| C3 — Haiku token-cap collision | a `cheap`-tier subagent's token cap clamped to 150K | `session.ts` — `modelTierFor` + `CHEAP_TIER_TOKEN_CAP` |

**Not shipped and confirmed still true:** `compact_20260112` (API rejects the tag as of 2026-09-02),
`output_config.task_budget` (API: "Extra inputs are not permitted"). Both are one-line adds when
Anthropic turns them on.

---

## What is left — verified, ordered by (value ÷ effort)

### 1. R1 — the usage counter is double-cumulative. **P0. Small. Everything cost-related is unmeasurable until this lands.**

**Confirmed in the current tree.** `apps/agent/src/session.ts:1345-1346` declares
`private tokensIn = 0` / `private tokensOut = 0`. Grep confirms they are **never reset** — only
`+=` at `session.ts:2527-2528` and read at `1539`, `2534`, `3363`. So they are a
**session-process-lifetime cumulative total**, not a per-turn total.

`session.ts:2531-2540` emits that cumulative total on the `usage` event. `apps/server/src/ws/gateway.ts:513-514`
stores it on the assistant message row as if it were that message's usage. `gateway.ts:535` then
calls `store.sessions.addUsage(sessionId, assistant.tokensIn, ...)`, and
`packages/db/src/repositories/sessions.ts:66-73` does `tokensIn: current.tokensIn + tokensIn` —
**adding a cumulative to a cumulative.**

Result after N turns: `sessions.tokens_in ≈ Σ running totals ≈ N(N+1)/2 × average`. The "227.2k"
in a recent transcript is inflated. `messages.tokens_in` is a monotonic running total, and it
*drops* when the agent process restarts mid-session (in-memory counter resets), so the series is
not even consistently cumulative.

**Fix (contained to three files):**
1. `session.ts` — add `private turnTokensIn = 0` / `turnTokensOut = 0`, reset them at the top of
   `run()`, `+=` them alongside `this.tokensIn` at `2527-2528`, and emit them on the `usage`
   event as `turnTokensIn` / `turnTokensOut`.
2. `packages/core/src/protocol.ts` — add `turnTokensIn` / `turnTokensOut` (optional ints) to the
   `usage` event schema (near `cacheReadTokens`).
3. `gateway.ts` — `assistant.tokensIn = event.turnTokensIn ?? event.tokensIn` (and out); pass the
   same to `addUsage`. Keep emitting the cumulative `tokensIn` for the live UI gauge.
4. Add `cache_read_tokens` / `cache_creation_tokens` columns to `messages` (they are computed at
   `session.ts:2529-2530` and dropped at the gateway). SQLite + pg schema + a migration; the
   `schema-parity.test.ts` will enforce the pair.
5. `packages/db/test/` — a `sessions.addUsage` test: two turns of `{100,50}` → session total
   `{200,100}`, not `{300,150}`. That test would have caught this.
6. Migration marker: stamp pre-fix message rows `usage_schema = 0` (or a `createdAt` cutoff) and
   exclude them from any baseline. No backfill is possible.

`docs/token-usage/measure/true-usage.mjs` already reconstructs correct per-turn deltas from the
broken data and is the only safe way to read history until the fix lands.

### 2. R5 — one `/agent` mention voids the entire Anthropic cache. **Small (~5 lines).**

**Confirmed.** `session.ts:1340` `private readonly liveTools: ToolDefinition[]`, built at
`1453-1454`, passed to the provider at `1496` (`tools: liveTools`) — **held by reference**.
`session.ts:2184` `grantSpecialistTools` does `this.liveTools.push(...toolDefinitions(granted))`
at `2194`, called from `2404` whenever a turn carries `/agent` names.

On Anthropic the cache prefix order is `tools → system → messages`. Appending a tool changes the
first cached segment, so the system prompt **and the whole transcript** re-write at 1.25× on the
next request. On an Architect session that is ~24.4k static tokens plus the full history.

**Fix:** `session.ts:1430-1439` already adds the four pass tools
(`designPassTool, opsPassTool, qaPassTool, cinematicPassTool`) for `architectMode || engineerMode`.
Extend that to **every non-lean session** (drop the mode condition). ~1,047 proxy tokens once is
unconditionally cheaper than one prefix invalidation. `grantSpecialistTools` then stays only as the
lean-child guard it already contains. Add a test asserting `liveTools` is not mutated after the
first `stream()` for a non-lean session.

### 3. R6 — Anthropic's 5-minute cache TTL is shorter than a Zelyq turn. **Small.**

**Confirmed.** `anthropic.ts:263` and `:355` both use `cache_control: { type: "ephemeral" }` with
no `ttl`, i.e. the 5-minute default. `run_command` and preview builds run for minutes between
model requests, and a user reading a plan is longer; every gap over 5 minutes drops the whole
transcript from cache and re-pays it cold.

**Fix:** switch to `{ type: "ephemeral", ttl: "1h" }` and add the `extended-cache-ttl-2025-04-11`
beta header (it is in the SDK's `AnthropicBeta` union — compose it into `extraBetaHeader` the same
way `context-management-2025-06-27` is). Gate it: unconditionally for Architect Mode, otherwise
when the session's observed inter-request gap p90 exceeds ~3 min. The break-even is one saved miss
(`05-cost-model.md`).

### 4. R4 — Gemini has no explicit `cachedContent`, and Gemini is 95% of real usage. **Medium. Biggest single line item.**

**Confirmed.** `apps/agent/src/providers/google.ts:145-158` sends `systemInstruction` + `tools` +
append-only `contents` with **no `cachedContent`**. It reads `cachedContentTokenCount` at
`google.ts:175` — so it *measures* implicit-cache hits but never creates an explicit cache. Per the
review, Gemini Flash turns average ~1.25M uncached input tokens, which means implicit caching mostly
does not fire.

**Fix:** at session start, if the `systemInstruction + tools` block clears the model minimum (an
Architect prefix at ~24.4k tokens does comfortably), call `client.caches.create(...)`, store the
returned cache name + expiry in session state, and pass `cachedContent: <name>` on each request.
Handle expiry (recreate) and record hit/miss. Bounded to `google.ts` + a small piece of session
state. `03-provider-matrix.md` already lists this as an option; the usage data makes it the
headline.

### 5. R7 / F3a — the live in-memory conversation keeps every file body forever. **Medium.**

**Confirmed.** `stripHeavyToolInputs` runs only at `gateway.ts:533` (persist time). Grep shows no
`Conversation` implementation (`providers/anthropic.ts`, `google.ts`, `openai-compatible.ts`,
`chatgpt-responses.ts`) strips its in-memory `messages` array. So a **resumed** session is
dramatically cheaper than the **live** session it resumed from — the live path is the expensive one,
and the 68.5%-of-tool-call-bytes headline from the earlier audit describes the live conversation.

**Fix:** once a tool call/result pair is superseded by the next assistant turn, rewrite the
assistant `tool_use` input to `{ path, bytes, sha256 }` and the `tool_result` to a bounded excerpt
plus an artifact handle — the `artifacts.ts` module `04-implementation-design.md` Phase 1 specifies,
applied to the in-memory `Conversation`, not only at the persistence seam. **Interaction with R6:**
rewriting history invalidates the prefix, so batch it in large epochs (the 70%→45% step in `02`),
never per round.

---

## Not re-verified here (still stand from the first/second pass)

F4 (OpenAI-dialect adapter sends no `prompt_cache_key` / xAI keys / OpenRouter `session_id`), F7
(tier routing is advisory — `modelTierFor` now exists from C3 but nothing routes on it), F8 (retry
cost not attributed), F9 (capability probe surface). The R8 factual corrections (`ALL_TOOLS` is 15;
Supabase tools already gated) are already reflected in the merged tree.

## Reproduce every measurement

```sh
pnpm --filter @zelyq/tools build && pnpm --filter @zelyq/agent build
node docs/token-usage/measure/static-floor.mjs
node docs/token-usage/measure/true-usage.mjs
```
