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

## Session 2026-09-01 (evening) — Phase 2/4 items that need no eval run and no founder call

All on `maint/phase1`, each its own commit, full matrix green. Written up in detail below.

| # | what | commit |
|---|---|---|
| F6 (invention half) | `no_unrequested_components` eval check | `e39d882` |
| F4 | cost axis in the eval report (`evals/rates.ts`) | `366a292` |
| A2 (companion) | `stripHeavyToolInputs` — drop file bodies from persisted history | `c670f9a` |
| G1 + G2 | neutral vite-react template + `@theme` token layer | `aec8d48` |
| F5 | don't score a case the model never reached (`neverRan`) | `097c99c` |
| E1 §5 | `run_command` injection/exfil denylist | `ecd0452` |
| B5 | `find_files` + `glob`/`context_lines` on `search_files` | `ee6aa21` |
| F2 (gate) | prompt-hash CI check (now blocking, `evals/baselines.json`) | `4154d3f`, `25bf362` |
| D3 | one-shot step-budget warning in the run loop | `<this>` |

**Left for the founder** (each noted in its section): the `<scope>` prompt half of F6, G3,
a `<how_to_work>` mention of `find_files`, and F2's per-PR smoke set (needs a CI key). Provider-beta
/ product-call items untouched: C2, C5, D3, 2.2, 2.3, 3.1–3.4, E1 §4.

### The 2026-09-02 `claude-opus-5` run (5 greenfield cases, effort high)

Founder ran `pnpm eval --limit 5`. `2/5 → 1/5 done` vs the pre-D1 baseline (`9661a9962ea3`).
Non-deterministic model, single run — the README says run twice before believing a flip, and every
failure here is `max_files_changed` / `no_unrequested_components` (restraint), not correctness.
`intact 5/5`, `89% cached`, `$2.03`.

Two things the run surfaced, both fixed in `maint/phase1`:

- **`no_unrequested_components` false positive.** `landing-page` flagged `SiteFooter.tsx` — the
  footer the request asked for, with a scoping prefix. `GENERIC_NAME_WORDS` gained `site`, `primary`,
  `global`, `top`/`bottom`/`left`/`right`, `mobile`/`desktop` etc. — words that qualify a requested
  thing and never name a new one. `Wordmark.tsx` is still caught (the real invention). Test added.
- **`--compare` crashed** with `ENOENT` on a repo-root-relative path, because `tsx` runs with cwd at
  `apps/agent`. `readComparePath` now tries the path as given, then repo-root-relative, then the
  results dir by basename. The run itself had already completed and saved — only the compare step
  died.

Also found: **`evals/results/` is gitignored**, so the F2 gate couldn't ever see a result in CI. New
`evals/baselines.json` (committed) — `run.ts` upserts the prompt hash into it after every run;
`check:prompt-hash` reads it. Seeded with the two recorded `claude-opus-5` runs. **The F2 gate is
now blocking** (`continue-on-error` removed) — `18b772c2702f` is a recorded baseline.

Still worth a second run before reading anything into `2/5 → 1/5`: `pnpm eval --limit 5 --compare
apps/agent/evals/results/2026-09-02T06-35-28-946Z.json` (the path fix makes that work now).

### Second run 2026-09-02 06:54 — `1/5 → 1/5`, `fixed none, broke none`

`--compare` worked this time. `done` is **stable at 1/5**, not noise. (The exit code is 1 by design —
`run.ts` exits non-zero unless every case is `done`, so CI fails a red suite; it is not a crash.)
`dashboard-layout` reliably passes; the other four reliably fail, and the split is clear:

| case | consistent failure | kind |
| --- | --- | --- |
| `dashboard-layout` | — (passes) | — |
| `contact-form` | 5 files vs cap 4 — App + ContactForm + FormField + `validateContact.ts` + `index.css`, **all requested, none invented** | restraint, false |
| `todo-app` | 7 files vs cap 6 — clean decomposition, all requested | restraint, false |
| `landing-page` | `Wordmark.tsx` (run 1) / `NoteSpecimen.tsx` (run 2) — **genuine invented scope**, caught by `no_unrequested_components`; also over the 7-file cap even without them | restraint, real |
| `pricing-toggle` | `no match for /<button/` — **real correctness miss**, both runs: the monthly/annual toggle is built as something other than a `<button>`. Plus a hand-rolled `CheckIcon.tsx` (G3) | correctness + G3 |

So after two runs the F6 thesis holds on the strongest model: it decomposes past the caps AND
invents components (`Wordmark`, `NoteSpecimen`, `CheckIcon`, `Icon`). `no_unrequested_components` is
doing its job on the real inventions.

**Calibration done (`maint/phase1`):** `contact-form` cap 4→5 and `todo-app` cap 6→7. Both runs
landed a clean, fully-requested decomposition at exactly those counts, and `no_unrequested_components`
is now the restraint guard — F6's own solution says the file cap becomes "a loose backstop" once it
exists. `landing-page` (7) and `pricing-toggle` (7) unchanged: they fail on real invention / a real
bug, not on the cap. Revert the two if you disagree — it's a judgement call, well inside eval
tuning.

**Not touched (founder's):** the `<scope>` prompt wording — the data now justifies it; `pricing-toggle`'s
non-`<button>` toggle; G3 (the repeated hand-rolled icon files). Run-to-run token/cost variance at a
fixed prompt was ~+22% here (65→70 rounds) — the reason the README says run twice.

---

## D3 — step-budget warning

**Where:** `maint/phase1`. [04-agent-competence.md](./04-agent-competence.md) §3.

`maxIterations` was a `for` loop the model couldn't see — it found the cap by hitting it, and
`synthesizeFallbackSummary` exists only to clean up after that. Now: one `addUserMessage` at 80% of
the cap (`budgetWarningDone`, skipped when `maxIterations < 12`), telling it to land or revert and
write its summary. In a message, not the system prompt — a per-turn counter there would invalidate
the cache every request. Fires after a tool-result like the Engineer-Mode checkpoint nudges already
do. `apps/agent/test/turn-budget-warning.test.ts` (3). Agent suite 372/372.

Dispatched children get the same one-shot for now; the continuous `task-budgets` countdown ([03 §4])
is Anthropic-only and still open.

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

---

## B2 / B3 / B4 — read_file paging, edit/write diffs, same-path serialisation

**Branch:** `maint/b2-b3-b4-tools` (stacked on A4 + C1 + E1). All in `packages/tools/src/files.ts`.

**Done — 2026-09-01.**

| finding | change | note |
|---|---|---|
| **B2** | `read_file` gains `offset` / `limit` (1-indexed, default 2000, max 5000) | `numberedSlice()` — **never elides the middle of source**. Past the window it cuts at the end with `call read_file again with offset: N`. `truncate()`'s head+tail elision is kept for `run_command` / `search_files` / `preview_logs`, not `read_file`. A 60k-char hard cap on one window still cuts at the end, not the middle. |
| **B3** | `edit_file` returns the changed region (±3 lines, numbered); `write_file` over an existing file returns a brief diff | `regionSnippet()` + `briefDiff()` (common head/tail trim, capped at 80 lines each side). The model verifies its own edit in the same round-trip instead of a ~3k-char confirmatory `read_file`. New file → `Created … (N lines).` |
| **B4** | `withPathLock()` — a per-`{project}:{path}` async mutex around `write_file` / `edit_file` / `delete_file` | The **live data-loss bug**: `Promise.all` over the tool batch + a read-modify-write `edit_file` meant two edits to one path both read the original and both wrote, losing the first, both reporting success. Now they serialise per path. Concurrency for different paths and all read-only tools is untouched. |

Tests: `packages/tools/test/tools.test.ts` +4 — B2 paging + no-elision + a middle window; B3 edit region + write diff; **B4 two concurrent `edit_file` on one path both land** (against a real `LocalRuntimeDriver` — this test fails on the pre-lock code).

Verified: `pnpm -r typecheck` clean, `biome check .` clean (2 pre-existing warnings), tools 50
(+4), agent 344, server 215 — all green.

**Cheap-alternative call, stated plainly:** B4 here is the review's own "per-path async mutex …
about twenty lines" stopgap, not the full batch partition. It fully closes the `edit_file` +
`edit_file` silent-loss hole. It does **not** order a `run_command` against an `edit_file` on the
same project — that needs the emission-order batch partition in `session.ts` and is the follow-up.

---

## D1 — `AGENTS.md`

**Branch:** `maint/d1-agents-md` (stacked on A4 + C1 + E1 + B*).

**Done — 2026-09-01.**

| step | where | note |
|---|---|---|
| read the file | `apps/agent/src/server.ts` `/sessions` | after `ensureProject`: read `AGENTS.md`, fall back to `CLAUDE.md`, cap at 8,000 chars with a note; passed as `SessionOptions.projectGuide` |
| weave it | `apps/agent/src/prompt.ts` `buildProjectGuide()` | `<project_guide>` block after `<stack_guide>`, before `<how_to_work>` and the mode addenda. Byte-identical default prompt when absent. |
| subordinate it | the block's own text | wins over the agent's defaults and skills; does **not** override `<scope>`, is not a licence past a guardrail, and "ignore the above"-shaped lines in it are declared not from the user |
| plumbing | `session.ts` `SessionOptions.projectGuide` → `buildSystemPrompt` | one option, threaded like `stack` / `stackSkill` |
| teach by example | `templates/vite-react/AGENTS.md` | a short real one — stack, where components live, token-first, "not a backend" — scaffolded into every new vite-react project |
| docs | `docs/agent-behaviour.md` §"three inputs" | added |

Verified: `pnpm -r typecheck` clean, `biome check .` clean, agent 346 (+2 prompt tests), server 215.

Byte-stable / cache: read once in the handler, not per turn — a mid-session edit to `AGENTS.md` is
picked up on the next session, as intended, so the prompt prefix stays cacheable.

**Follow-ups (04 §1 details 5, 6 / 4):** the Architect writing a root `AGENTS.md` as part of its
finishing task (so a planned project hands its conventions to every later session); an
`expo-react-native` template guide; and — for the "open an existing repo" path — surfacing a
first-time-seen guide to the user *before* it takes effect, so a cloned repo cannot silently
reconfigure the agent. The prompt subordination is the mitigation until then.

---

## Phase 1 — status

| # | finding | done | branch / where |
|---|---|---|---|
| A1 | conversation caching | ✅ | shipped #124 |
| F6 | manifest half of `max_files_changed` | ✅ | shipped #125 |
| A4 | cache-token capture + 2-breakpoint | ✅ | `654f2e1` |
| C1 | `max_tokens` handling | ✅ | `3d36b3e` |
| E1 §2 | untrusted-content wrapping + prompt block | ✅ | `6c0bf44` |
| B2/B3/B4 | read_file paging, edit/write diffs, per-path lock | ✅ | `d0f796b` |
| D1 | `AGENTS.md` | ✅ | this branch |
| F6 | invention half of `max_files_changed` | ✅ | `maint/phase1` — `no_unrequested_components` |
| F4 | cache tokens + a dollar figure in the eval report | ✅ | `maint/phase1` — `evals/rates.ts` |
| A2 | persisted `write_file`/`edit_file` input bodies | ✅ (companion) | `maint/phase1` — `stripHeavyToolInputs` |
| G1 | dark-SaaS default template | ✅ | `maint/phase1` — neutral `App.tsx` |
| G2 | nowhere for a type/spacing scale | ✅ | `maint/phase1` — `@theme` block in `index.css` |
| F5 | provider error scored as agent failure | ✅ (pre-flight probe still open) | `maint/phase1` — `neverRan` |
| E1 §5 | `run_command` injection/exfil denylist | ✅ | `maint/phase1` — `INJECTION_PATTERNS` |
| B5 | no file-finder; `search_files` can't scope | ✅ | `maint/phase1` — `find_files` + `glob`/`context_lines` |
| F2 | prompt changes ship without an eval | ✅ (gate, non-blocking) | `maint/phase1` — `check-prompt-hash.ts` |

---

## F2 — a promptHash gate

**Where:** `maint/phase1`. [06-measurement.md](./06-measurement.md) §4.

**What shipped:**

- `apps/agent/scripts/check-prompt-hash.ts` + `check:prompt-hash` script. No-op unless
  `apps/agent/src/prompt.ts` changed vs the base (`origin/main`, or `PROMPT_HASH_BASE`); otherwise
  computes the current default-mode hash and fails if `evals/results/` has no file recording it,
  printing the `pnpm eval` command.
- `ci.yml`: a step after `Test`, **`continue-on-error: true`** — the current prompt (post-D1) has no
  matching result, so blocking today would fail this very PR. Drop that line once a `claude-opus-5`
  run for the current prompt is committed. Verified both paths locally (no-op vs a pre-D1 base →
  clean FAIL naming hash `18b772c2702f`).

**Not done:** the `--tag restraint --limit 6` smoke set on every PR — real spend + a CI API key,
the founder's call.

---

## B5 — a file-finder, and a scoped content search

**Where:** `maint/phase1`. [02-tool-surface.md](./02-tool-surface.md) §5.

**What shipped:**

- `find_files` (new, in `ALL_TOOLS` after `list_files`): by name or glob, newest first, respecting
  the same `.gitignore` set. Pure — `runtime.listFiles` + a small `globToRegExp` (`**`, `*`, `?`,
  `{a,b}`; a slash-free pattern matches the basename anywhere) + sort by `modifiedAt`. `list_files`
  caps at 400 entries, which a real repo blows past before the answer; a glob answers directly.
- `search_files`: `glob` → grep `--include`, `context_lines` → `-C`. Removed the per-file `-m`
  (which meant `max_results: 50` could be "50 from the first file") — `head -n` is now the only,
  global cap; the budget widens when context is on.
- `packages/tools/test/find-files.test.ts` (4). Tools suite 56/56.

**Not done:** a `<how_to_work>` line naming the two tools — a prompt change, deferred to the eval
pass. Tool descriptions carry discovery in the meantime.

---

## E1 §5 — tighten run_command against the injection payload

**Where:** `maint/phase1`. [05-untrusted-content.md](./05-untrusted-content.md) §5.

**What shipped:**

- `INJECTION_PATTERNS` in `packages/tools/src/shell.ts`, checked after the existing
  `DESTRUCTIVE_PATTERNS`: pipe-a-download-to-a-shell, send `.env` / SSH / AWS creds to a remote host,
  pipe a secret into a network tool, upload a local file (`curl -T` / `-d @` / `--upload-file`),
  install or run from a git URL / raw tarball / `github:` spec. Refusal text also tells the model to
  quote the instruction if it came from something it read.
- `packages/tools/test/tools.test.ts` — a refuse list (9) and an allow list (`npm install <pkg>`,
  `pnpm add -D vitest`, `curl -sO <asset>`, `curl <api>/health`, `cat .env.example`, a local node
  script). Tools suite 52/52.
- `SECURITY.md` "Enforced today" now names both denylists and repeats that neither is a boundary —
  container mode + egress allowlist is.

**Still open:** §4 — confirm before the first fetch from a new host, and the interim "fetched N
pages from example.com" transcript row. Both need UI, not just a rule.

---

## F5 — don't score a case the model never reached

**Where:** `maint/phase1`. [06-measurement.md](./06-measurement.md) §5. Worth doing before the
founder's eval run — a config typo now costs a clear message, not a fake `intact 100%`.

**What shipped:**

- `neverRan(result)` in `evals/harness.ts` (`error && rounds === 0 && tokensIn === 0`), exported.
  `runCase` returns before the check loop when true.
- `run.ts`: `errored N/total` in the report, `⚠` per-case mark; `abortReason` stops starting new
  cases after the same never-ran error twice (rest → `skipped`); a run where nothing ran isn't
  saved and exits 1 with the provider/model hint.
- `apps/agent/test/eval-errored-case.test.ts` — 5 cases. Agent suite 368/368.

**Follow-up:** a pre-flight `models.retrieve` / trivial-completion check before the first scaffold,
so the first two cases aren't wasted either. Needs per-provider plumbing.

---

## G1 + G2 — the starting point

**Where:** `maint/phase1`. [08-the-starting-point.md](./08-the-starting-point.md) §1 / §2.

**Why now:** these need no eval run (they don't touch the prompt — a screenshot is the test) and
G1 is the same template/prompt mismatch behind two of the F6 icon false-failures.

**What shipped:**

- `templates/vite-react/src/App.tsx` — `bg-white text-neutral-900` + `dark:` variants, no accent
  colour, no `font-mono`, no uppercase tracked micro-label. The `<h1>Your app starts here.</h1>`
  copy the e2e suite pins is untouched.
- `templates/vite-react/src/index.css` — a Tailwind v4 `@theme` block: neutral `--color-brand-*`
  ramp, `--font-display` / `--font-body`, `--radius-card` / `--radius-control`, each commented as
  the thing to set. Neutral on purpose; filling it in is the identity decision.

**Verified:** scaffolded the template into a temp dir, `npm install` + `tsc --noEmit` + `vite build`
all clean (CSS 7.24 kB with the generated brand utilities).

**G3 not done:** icons-in-one-file (prompt) and `lucide-react` (dependency) both need the
before/after eval run per this folder's rule. Left for that pass.

---

## A2 — drop persisted file bodies from tool-call history

**Where:** `maint/phase1`, on top of F4. [01-context-and-cost.md](./01-context-and-cost.md) §2 the
"Zelyq-side companion change"; the Anthropic-only live-turn `clear_tool_uses_20250919` is still open.

**Why now:** `write_file` + `edit_file` inputs are ~1.27M tokens / 68.5% of every tool-call byte in
the DB, and every one duplicates a file that is on disk. This half needs no beta header and also
fixes the post-restart history-reconstruction path.

**What shipped:**

- `stripHeavyToolInputs(calls)` in `packages/core/src/models.ts` — replaces `write_file.content`
  and `edit_file.old_text` / `new_text` over 200 chars with `OMITTED_TOOL_INPUT_MARKER`. Other
  fields, other tools, and short values are left alone; pure copy, no mutation.
- `ChatGateway` applies it to `assistant.toolCalls` in the `finally` immediately before
  `store.messages.append`. The `turn.end` broadcast just above still sends the full copy to the live
  client (which doesn't render it anyway — `ToolRow` shows `input.path` and `result`).
- The history rebuilders (`buildAnthropicHistory` + OpenAI/Google) pair the shortened `tool_use`
  input with its unchanged `tool_result` summary; a model needing current bytes calls `read_file`.

**Verified:** `@zelyq/core` typecheck + build clean, 6 new tests (`test/tool-calls.test.ts`);
`@zelyq/server` typecheck clean, 215/215; biome clean.

---

## F4 — cost axis in the eval report

**Where:** `maint/phase1`, on top of F6. [06-measurement.md](./06-measurement.md) §2 / roadmap 2.1.

**Why now:** the founder is about to run `pnpm eval` on `claude-opus-5`. A4 already captured the
cache tokens; without this the report shows them as a ~90% `tokensIn` drop and never converts any
of it to money.

**What shipped:**

- `CaseResult` gained `cacheReadTokens` / `cacheCreationTokens`; `harness.ts` accumulates them off
  the `usage` event next to `tokensIn` / `tokensOut`.
- `evals/rates.ts` — hand-maintained per-model USD rates (deliberately *not* in `PROVIDERS`; the
  report is the only consumer). `estimateCostUsd` prices cache reads at 0.1× and the cache write at
  1.25× the input rate; `totalPromptTokens`, `cachedFraction`, `formatUsd`. No entry → `null` → the
  report prints `—`, never a guessed number.
- `run.ts`: the `tokens` line now reports the **total** prompt size with a `· NN% cached` note; a
  new `cost` line; per-case `$`; `--compare` gained a `cost` delta and its token delta moved from
  `tokensIn` to the total, so the caching work can't read as a phantom 90% saving.
- `apps/agent/test/eval-cost.test.ts` — 7 cases. Replayed against the recorded 2026-09-01
  `claude-opus-5` run the suite figure is $2.94, matching the doc; old result JSONs with no cache
  fields don't `NaN`.

**Verified:** `pnpm --filter @zelyq/agent typecheck` clean, agent suite 363/363, biome clean, and
the $2.94 replay above.

**Still open (Phase 2, needs the eval run):** 2.2 effort tuning, 2.3 mode/specialist coverage,
2.4 context editing.

---

## F6 — name the invented scope directly

**Where:** `maint/phase1`, on top of Phase 1.
**Fixes:** the open half of F6. The manifest half (`scopeRelevant()`) shipped in #125; this is
[06-measurement.md](./06-measurement.md) §6 "Still to do — name the invention directly".

**Why now, out of Phase 2 order:** the founder watched the shipped agent turn "add a counter" into
a multi-counter manager with aggregate analytics, a config drawer and a view switcher — twice. F6's
own evidence already said scope discipline "is a prompt problem, and Phase 1 should not be read as
having addressed it", and it named the fix. `max_files_changed` can't be that fix: it counts files,
so a clean three-file decomposition of the asked-for feature fails the same check that is supposed
to catch three files nobody asked for.

**What shipped:**

- New check `{ kind: "no_unrequested_components", allow: string[], why }` in `evals/types.ts` /
  `evals/checks.ts`. Pure helper `unrequestedComponents(newFiles, allow)` — exported and unit-tested.
- It looks only at **newly created** `src/**/<Name>.{tsx,jsx}` (uppercase initial — so `useTodos.ts`
  and `types.ts` are never components here). A component is allowed when **every** feature-bearing
  word in its name is covered by an `allow` stem or is a generic layout noun (`Card`, `Section`,
  `Grid`, `Header`, …). So `allow: ["Feature"]` admits `FeatureCard` / `Features`; `allow: ["Todo",
  "Add"]` admits `AddTodoForm` but not `TodoFilter`, because `filter` is a feature nobody asked for.
- Added to the six cases that carry `max_files_changed` and name their surface concretely:
  `landing-page`, `todo-app`, `pricing-toggle`, `dashboard-layout`, `contact-form`,
  `extract-components`. `max_files_changed` stays as a loose backstop — no cap changed.
- `apps/agent/test/eval-unrequested-components.test.ts` — 10 cases pinned to the real model diffs
  from the 2026-08-31 / 09-01 runs, the same data `eval-scope-count.test.ts` guards. Replayed:
  `landing-page` still flags `Wordmark.tsx` + `AnnotatedPage.tsx`; the Opus `todo-app` and
  `pricing-toggle` decompositions that only ever failed on file count now pass it.

**Verified:** `pnpm --filter @zelyq/agent typecheck` clean, full agent suite 356/356 (17 in the two
scope suites), biome clean.

**Still open — the prompt half.** `<scope>` in `prompt.ts` is already direct about this ("A vague
request is not permission to fill the gap"; "no toggles that switch between sample data sets"). The
finding is clear that it is not landing on strong models anyway, but the roadmap is equally clear
that prompt tuning is gated on numbers (2.2: "Do not change the default on a hunch"). This check is
the instrument for those numbers — it should be run (`pnpm eval` on `claude-opus-5`, five restraint
cases, twice) before any `<scope>` wording is touched.

**Deferred, each its own item (recorded above where relevant):** C2 (operator nudges → `role:system`),
C1's three workaround deletions, B4's full batch partition (`run_command` vs edit ordering),
the E1 follow-ups (`role:system` structure, per-host fetch confirmation, `run_command` injection
denylist, cloned-`read_file` marking), the D1 follow-ups (Architect writes one, template guide,
first-time surface). Phase 2 (measurement, effort tuning, eval coverage) and Phase 3 (tool-surface
reduction, compaction, task budgets, `update_plan`) are untouched.
