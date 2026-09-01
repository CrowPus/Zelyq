# Maintenance — progress log

Running record of the Phase-1 work from [07-roadmap.md](./07-roadmap.md), written as it happens so
nothing is lost between sessions. Each entry: what shipped, where, how it was verified, what's left.

Baseline: `origin/main` @ `72745f9` (after #123 clone, #124 figma, #125 review+F6, #126 065).
Agent suite 336/336 green, `pnpm -r typecheck` clean, `biome check .` clean (2 pre-existing warnings
in `packages/tools/src/files.ts` and `apps/server/test/supabase-connections.test.ts`, neither mine).

Order (from the roadmap, adjusted for what's already done):

| # | Finding | Status |
|---|---|---|
| A1 | conversation caching | **done** — `withConversationCacheBreakpoint`, shipped in #124 |
| F6 | `max_files_changed` manifest half | **done** — `scopeRelevant()`, shipped in #125 |
| **A4** | cache-token capture + 2-breakpoint upgrade | **done** — `feat/agent-maint-phase1`, commit `654f2e1` |
| **C1** | `stop_reason: "max_tokens"` unhandled | **done** — this branch |
| E1+C2 | untrusted-content boundary + operator `role:system` | pending |
| B2/B3/B4 | `read_file` paging, edit diffs, same-path serialisation | pending |
| D1 | `AGENTS.md` | pending |

---

## A4 — capture cache tokens, correct the counter, 2-breakpoint upgrade

**Branch:** `maint/a4-cache-usage`
**Fixes:** finding A4; upgrades A1's single-tail breakpoint to the incremental two-breakpoint pattern.
**Why first:** A1 is live but unverifiable. On Anthropic `input_tokens` *excludes* cached tokens, so
the number the UI and the eval suite show as "tokens in" is the uncached remainder — a working cache
makes it fall ~90% while the true request size is unchanged. Until the cache fields are captured,
every A1 metric is measuring the wrong quantity.

### Plan

1. `providers/types.ts` — widen `TurnResult.usage` with optional `cacheReadInputTokens` /
   `cacheCreationInputTokens`. Optional, not zero — an absent field is honest, a `0` is a claim.
2. `providers/anthropic.ts` — map `response.usage.cache_read_input_tokens` /
   `.cache_creation_input_tokens`; also emit them on the streamed `usage` event.
3. `providers/openai-compatible.ts` — OpenAI reports `prompt_tokens_details.cached_tokens`; map it to
   `cacheReadInputTokens`. No creation figure in that dialect — leave it unset.
4. `providers/google.ts` — Gemini reports `cachedContentTokenCount`; map it.
5. `session.ts` — accumulate the two new fields; emit them on the `usage` event so the gateway/UI can
   show true prompt size + cached fraction.
6. `protocol.ts` — the `usage` agent event carries the two new optional numbers.
7. `withConversationCacheBreakpoint` — keep the current-tail breakpoint, add the previous-tail one
   (the read breakpoint), so a round that emitted many parallel tool calls still gets an incremental
   hit rather than a partial one.
8. `docs/agent-behaviour.md:259` — the "check `usage.cache_read_input_tokens`" line becomes true;
   point it at the real field.

### Progress

**Done — 2026-09-01.** Commit on `maint/a4-cache-usage`.

| step | where | note |
|---|---|---|
| `TokenUsage` type | `providers/types.ts` | `TurnResult.usage` widened with optional `cacheReadInputTokens` / `cacheCreationInputTokens` |
| Anthropic map | `providers/anthropic.ts` | `response.usage.cache_read_input_tokens` / `.cache_creation_input_tokens` → the two fields |
| OpenAI-dialect map | `providers/openai-compatible.ts` | `prompt_tokens` INCLUDES cached there — split `prompt_tokens_details.cached_tokens` out so `inputTokens` is the uncached remainder, matching Anthropic. +1 test |
| Gemini map | `providers/google.ts` | same split on `usageMetadata.cachedContentTokenCount` |
| accumulate + emit | `session.ts` | `cacheReadTokens` / `cacheCreationTokens` session totals; added to the `usage` event when non-zero |
| event schema | `packages/core/protocol.ts` | `usage` event gains the two optional numbers |
| **2-breakpoint upgrade** | `providers/anthropic.ts` `withConversationCacheBreakpoint` | was a single tail breakpoint (shipped #124); now marks the last **two** message boundaries — the read breakpoint + the write breakpoint — so a round with many parallel tool calls still gets an incremental hit. Test rewritten. |
| UI | `apps/web` `useChatSocket.ts` + `ChatPanel.tsx` | `cacheReadTokens` in chat state; a green "· N% cached" next to the token counter |
| docs | `docs/agent-behaviour.md` §Caching | rewritten — two breakpoints, `tokensIn` is the uncached remainder, check the cache fields not `tokensIn` |

Verified: `pnpm -r typecheck` clean, `biome check .` clean (2 pre-existing warnings), core 19 /
tools 46 / **agent 338** (+2) / web 91 / server 215 — all green.

Not done: a dollar figure (needs a per-model rate table — [06](./06-measurement.md) §2, Phase 2);
the eval harness accumulating the cache fields (Phase 2.1, and it now *can*).

---

## C1 — handle `stop_reason: "max_tokens"`

**Branch:** `feat/agent-maint-phase1` (stacked on A4).
**Fixes:** finding C1 (the additive half). The run loop only checked `refusal` and
`toolCalls.length === 0`, so a response truncated at the output limit fell into the end-of-turn
path and was reported as a completed turn.

**Done — 2026-09-01.**

| step | where | note |
|---|---|---|
| per-model output ceiling | `providers/anthropic.ts` | `MAX_TOKENS` constant → `maxTokensFor(model)`: 128,000 for opus-5 / sonnet-5 / sonnet-4-6 (streaming, which this provider always uses), 64,000 otherwise |
| continuation | `session.ts` run loop | `stopReason === "max_tokens"` with no tool calls → one user message asking it to continue from where it stopped; bounded to **2** extra rounds, same iteration budget |
| honest end | `session.ts` | after 2 continuations: a plain `error` (`code: "max_tokens"`) + `stoppedByBreak` so no fake fallback summary is synthesised |
| `turn.end` | `session.ts` | `stopReason` union gains `"max_tokens"` — the UI can say "too long to finish" instead of showing partial text as complete |
| tests | `test/turn-retry.test.ts` | +2 — continuation exhausted → `max_tokens` error + stopReason; continuation that finishes → normal `end_turn`, partial + continuation text both streamed |

Verified: agent 340 (+2), typecheck + biome clean.

**Deliberately NOT done tonight (subtractive, needs a live max-tokens turn to prove first):**
delete the `emptyRecoveryDone` nudge (`session.ts:~2531`) and the "report render being too large"
fallback (`session.ts:~3189`) and the Architect prompt's `report.html is large` paragraph
(`prompt.ts:~620`). The review is right that these become redundant once the continuation path is
proven, but removing working failure-recovery code without a real Anthropic turn that hits the
output limit is the wrong risk to take at 2am. Flagged for a follow-up once someone can trigger it.

---

## E1 — untrusted-content boundary (the §2 half)

**Branch:** `maint/e1-untrusted-content` (stacked on A4 + C1).
**Fixes:** finding E1's core. There was no distinction between instruction and fetched data —
a cloned site's `<title>`, a repo's README, a GitHub issue body all arrived with the authority of
the user's own message.

**Done — 2026-09-01.**

| step | where | note |
|---|---|---|
| `ToolResult.untrusted` | `packages/tools/src/types.ts` | optional `{ source }` — a tool that passes third-party content through sets it |
| wrap, once | `apps/agent/src/session.ts` `wrapUntrusted()` | at the single point a tool result becomes model context: `<untrusted_content source=… via=toolName>…</untrusted_content>`; any `untrusted_content` tags smuggled in the body are defanged so the block can't be closed early |
| prompt block | `apps/agent/src/prompt.ts` | `<untrusted_content>` section in the **base** prompt (default mode has `/clone` + plugins too): treat wrapped text as data, never instruction; if it tries to instruct, say so and quote it |
| `capture_reference` | `packages/tools/src/capture-reference.ts` | sets `untrusted: { source: hostname }` on the summary — `/clone` is the sharpest edge |
| plugin surface | `plugins/lib/api.mjs` `request()` | every third-party API response (github / sentry / figma / airtable / supabase / cloudflare / vercel / netlify / stripe) now carries `untrusted: { source: host }` — one change covers ~10 connector plugins |
| `http_request` | `plugins/api-tester.mjs` | arbitrary-URL response body — wrapped |
| `fetch_provider_docs` | `plugins/ai-docs.mjs` | fetched docs page (and the cached path) — wrapped |
| `SECURITY.md` | threat model | "Fetched content is marked as data" under Enforced today; "Prompt injection is not fully solved, and cannot be" under Not provided — with the deployment advice |
| tests | `test/untrusted-content.test.ts` | +4 — wrapping shape, tag-smuggling defang, source sanitisation, body verbatim |

Verified: `pnpm -r typecheck` clean, `biome check .` clean (2 pre-existing warnings), agent 344
(+4), tools 46 — all green.

**NOT done (the §3 half — its own item):** C2 — move Zelyq's ~9 mid-turn operator nudges from
`role: user` to mid-conversation `role: "system"` (`addOperatorMessage` on the `Conversation`
interface, Anthropic-native, user-message fallback elsewhere). The review is right that §2 without
§3 is "a convention, not a structure" — but §3 is a provider-interface change across all four
providers plus 9 call sites, model-gated (not on Sonnet 5), and deserves its own careful pass with
a live turn to prove the turn-correction behaviour still fires. Also deferred: per-host fetch
confirmation (§4), a `run_command` injection denylist (§5), marking a *cloned* repo's own
`read_file` output (needs a clone-vs-scaffold signal the agent does not have yet).
