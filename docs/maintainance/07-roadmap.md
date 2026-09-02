# Roadmap — what to do, in what order

Thirty findings is too many to act on at once. This is the order I would take them in, and why.

The sequencing is not by severity. It is by **dependency and by what makes the next thing
provable**. Several changes here are only verifiable once an earlier one has shipped, and shipping
them out of order means guessing about whether they worked — which is the failure mode this whole
review is arguing against.

---

## Phase 0 — Tonight, before anything is decided

**One command. Do it before the council meets on any of this.**

```bash
ZELYQ_PROVIDER=anthropic ZELYQ_MODEL=claude-opus-5 pnpm eval
```

The eval suite has never been run against the model Zelyq ships
([06-measurement.md](./06-measurement.md) §1). Of 35 recorded runs, 33 are `gemini-3.7-flash` and 2
are `gpt-5.1`. Zero are Anthropic. Until that number exists, nobody — including this review —
actually knows where the agent stands on the default configuration.

**Done — 2026-09-01.** `2026-09-01T10-54-08-227Z.json`, five cases on `claude-opus-5`: **2/5 done,
5/5 intact, 43/46 checks, $2.94, 254s.** All three failures are the same check
(`max_files_changed`), and **F6** shows two of the three are the check mis-measuring while the
third is a genuine scope failure on the prompt's own worked example.

Measured cost, so the full 32-case suite is **~$19 and ~25 minutes**, not the $8–15 estimated from
Gemini's numbers.

**Still to run:** the full 32 on `claude-opus-5`, and a repeat of the five-case run — the two
restraint flips are single runs on a non-deterministic model, and this suite's own README says to
run twice before believing one.

**F6 both halves now fixed in the suite** (`scopeRelevant()` #125; `no_unrequested_components`
2026-09-01 — see [06](./06-measurement.md) §6). The re-run above now also produces a direct
restraint number, not just a file count. The `<scope>` prompt half stays gated on that number.

---

## Phase 1 — The five that matter most

These five account for most of the gap. Each is independently shippable and each is small.

### 1.1 — Rolling cache breakpoints + cache usage capture

[01](./01-context-and-cost.md) §1 and §4 · fixes **A1**, **A4** · small

**A1 shipped in PR #124** — single rolling breakpoint on the message tail
(`withConversationCacheBreakpoint`). Still to do here, and now the priority:

- **A4 — widen `TurnResult.usage`** to carry `cacheReadInputTokens` / `cacheCreationInputTokens`,
  map them in `anthropic.ts`, accumulate in `session.ts`, and report the true prompt size + cached
  fraction. Without it, A1 makes `tokensIn` fall ~90% while the request is unchanged — a
  spectacular-looking number measuring the wrong thing. **Do this before trusting any A1 metric.**
- **The two-breakpoint upgrade** (previous tail + current tail) — a small refinement over the
  single-tail version; guarantees the incremental hit when a round emitted many parallel tool calls.

On the measured ~291K-token session, a full-budget turn goes from roughly **$73 to roughly $8** in
input tokens.

### 1.2 — Handle `stop_reason: "max_tokens"`

[03](./03-api-alignment.md) §1, §2 · fixes **C1** · small

This is a straight bug. The loop reports a truncated response as a completed turn. Three separate
workarounds already exist for it — a paragraph in the Architect prompt, the `emptyRecoveryDone`
nudge, and a hand-written "the report render was too large" fallback message.

Fix the cause, delete all three, raise `MAX_TOKENS` to a per-model value.

### 1.3 — Untrusted content boundary

[05](./05-untrusted-content.md) §2, §3 · fixes **E1** · small

`ToolResult.untrusted`, `<untrusted_content>` wrapping in `session.ts`, the prompt block, and moving
Zelyq's nine operator nudges from `role: user` to mid-conversation `role: system`.

An afternoon. It is the only security finding in the review, `/clone` just shipped, and in local
mode — the default — the shell it protects runs on the operator's own machine.

Update `SECURITY.md` in the same change. A threat model silent on the risk is the dangerous part.

### 1.4 — `read_file` paging, edit diffs, same-path serialisation

[02](./02-tool-surface.md) §2, §3, §4 · fixes **B2**, **B3**, **B4** · small–medium

Three changes to `packages/tools/src/files.ts` and one to the batch runner:

- `offset` / `limit` on `read_file`, tail truncation instead of middle-elision — the agent currently
  **cannot read the middle of a file over ~30,000 characters** while being told to always read
  before editing.
- Return a diff from `edit_file` and `write_file` — the model can then verify its own edit without a
  3,000-character confirmatory read.
- Serialise mutations that target the same path — `Promise.all` over the batch plus a
  read-modify-write `edit_file` is **silent data loss** today.

§4 is a live bug. §2 is what decides whether the agent is competent on a real repository, which is
the product's own stated direction.

### 1.5 — `AGENTS.md`

[04](./04-agent-competence.md) §1 · fixes **D1** · small

Read `AGENTS.md` from the project root at session construction, weave it in after `<skills>`, cap it,
keep it byte-stable for the cache.

Forty lines. It is the difference between an agent that learns the project and one that meets it
fresh every turn, and it is the feature that makes Architect Mode and default mode stop being two
disconnected products — the Architect writes the file, every later session reads it.

---

## Phase 2 — Measurement, then the tuning it unlocks

Phase 1 is defensible on reasoning alone. Phase 2 is not, and should not be attempted without
numbers.

### 2.1 — Cache tokens and a dollar figure in the eval report — **done 2026-09-01**

[06](./06-measurement.md) §2 · fixes **F4** · small

`CaseResult.cacheReadTokens` / `cacheCreationTokens` (from the A4 fields), `evals/rates.ts` with
`estimateCostUsd`, the report's `tokens` line switched to the total prompt size with a cached-%
note, a new `cost` line, and cost + total-token deltas in `--compare`. `eval-cost.test.ts` (7);
replaying the 2026-09-01 `claude-opus-5` run reproduces the doc's $2.94.

Shipping the caching work without this would have made the suite report `tokensIn` falling ~90%
while the real request size was unchanged — the number now reported is the total, so that trap is
closed.

### 2.2 — Effort tuning

[03](./03-api-alignment.md) §5 · fixes **C4** · small, but gated on 2.1

Anthropic's guidance is `xhigh` for agentic coding on the main loop and `low` for subagents. Both are
one-line changes with real cost and quality consequences in opposite directions.

**Do not change the default on a hunch.** Run the suite at `high` and `xhigh` on `claude-opus-5` and
change it on the number.

### 2.3 — Eval coverage for the modes

[06](./06-measurement.md) §3 · fixes **F3** · medium

Engineer Mode already has a `--engineer-mode` flag and a recorded A/B; what it lacks is checks for
what the mode uniquely promises (the `Purpose:` marker, the epistemic labelling, the checkpoint
behaviour) — which is why that A/B returned pure noise: 6/6/8 off versus 7/8/6 on.

**Partly done 2026-09-02:** `harness.ts` now appends `reply_matches` for `Purpose:` and for
verified/assumed on an acting Engineer-Mode turn (`eval-engineer-checks.test.ts`). Still open: the
checkpoint fires / doesn't-fire pair, and re-running the A/B on `claude-opus-5`. Then Expo / `/clone`
/ specialist-honesty-gate cases.

Then Expo and `/clone`, both shipped in the last two weeks with no behavioural coverage at all. Then
the specialist honesty gates, which are machine-decidable and are the guarantee the specialists'
credibility rests on.

### 2.4 — Context editing

[01](./01-context-and-cost.md) §2 · fixes **A2** · small

**Companion change done — 2026-09-01.** `stripHeavyToolInputs` shrinks the persisted
`write_file` / `edit_file` inputs to a marker before `ChatGateway` stores the message, so every
session rebuilt from history drops the ~1.27M tokens of dead file-body weight — provider-agnostic,
no beta header. **Still open:** the Anthropic-only `clear_tool_uses_20250919` /
`clear_tool_inputs: true` for the *live* turn, which trims the same weight before the window fills
rather than only on rebuild.

Ships after 2.1 so the effect is visible as a step change rather than noise.

---

## Phase 3 — The structural work

Bigger changes that need design decisions, not just implementation.

### 3.1 — Tool-surface reduction

[02](./02-tool-surface.md) §1 · fixes **B1** · medium

92 tools → under 30. Needs a decision first: tool search (`defer_loading`, the platform answer,
Anthropic-only) versus relevance gating at session construction (portable, ships sooner). The
recommendation is both, gating first.

### 3.2 — Compaction and the history window

[01](./01-context-and-cost.md) §3, §5 · fixes **A3**, **A5** · medium

Server-side compaction, an honest exhaustion message when the window is genuinely gone, and a
newest-N token-bounded history window. Removes a hard failure that will hit `cheap`-tier builders on
Haiku 4.5 first — three live sessions on this machine already exceed its 200K window.

### 3.3 — Task budgets and per-model caps

[03](./03-api-alignment.md) §4 · fixes **C3** · medium

Give dispatched children a budget they can see, so they land their work instead of being cut off at
turn 25. Derive the caps from the child's actual model rather than shared constants —
`SUBAGENT_MAX_TOKENS = 200_000` is currently *exactly* Haiku 4.5's entire context window.

### 3.4 — `update_plan`

[04](./04-agent-competence.md) §2 · fixes **D2** · medium

Durable plan state for default and Engineer Mode. Deserves its own proposal — it is a real feature
with a UI surface, and it needs a clean boundary against `build-plan.md` so the two never compete.

---

## Phase 4 — Cleanup

Worth doing, nothing depends on it.

| item | file | fixes |
| --- | --- | --- |
| `find_files` + `glob`/`context_lines` on `search_files` **(done 2026-09-01)** | [02](./02-tool-surface.md) §5 | B5 |
| `additionalProperties: false` on core tools **(done 2026-09-02)**; `strict: true` still open | [02](./02-tool-surface.md) §6 | B6 |
| Server-side refusal fallbacks | [03](./03-api-alignment.md) §6 | C5 |
| One budget warning near the iteration cap **(done 2026-09-02)** | [04](./04-agent-competence.md) §3 | D3 |
| Deepen or drop the eleven thin skills | [04](./04-agent-competence.md) §4 | D4 |
| Per-host fetch confirmation (open); `run_command` injection denylist **(done 2026-09-01)** | [05](./05-untrusted-content.md) §4, §5 | E1 |
| `promptHash` reminder — opt-in local command, **not** a CI gate (a blocking gate forces a paid run) | [06](./06-measurement.md) §4 | F2 |
| Neutral default template; `@theme` tokens in `index.css` **(done 2026-09-01)** | [08](./08-the-starting-point.md) §1, §2 | G1, G2 |
| Icons-in-one-file rule; `lucide-react` in the template **(done 2026-09-02, rides the eval run)** | [08](./08-the-starting-point.md) §3 | G3 |
| Errored eval cases skip checks; abort on repeated config error **(done 2026-09-01; pre-flight probe still open)** | [06](./06-measurement.md) §5 | F5 |

---

## What each phase buys

| phase | effort | what changes for a user |
| --- | --- | --- |
| **0** | 15 minutes | you learn where the agent actually stands |
| **1** | ~1–2 weeks | long turns cost ~10× less; truncated answers stop being reported as done; the agent can work on real files and verifies its own edits; silent data loss closed; fetched content can no longer instruct the agent; a project can finally tell the agent about itself |
| **2** | ~1–2 weeks | every claim above becomes a number; effort is tuned on evidence; the modes are measured for the first time |
| **3** | ~3–4 weeks | the tool surface stops diluting selection; long sessions stop being able to hard-fail; children land their work; multi-turn builds hold together |
| **4** | ongoing | the rough edges |

---

## What I would not do

Stated so the review is not read as "change everything."

- **Do not rewrite the system prompt.** It is better than most production prompts in this space. A
  few paragraphs in it exist to paper over structural problems ("a tool being available is not a
  reason to reach for it", the Architect's report-size coaching) and those should be *deleted* once
  the structural fix lands — but that is subtraction, not a rewrite. And nothing should change in it
  without a before/after eval run.

- **Do not add more skills.** Twenty-two is at the top of what a catalog can carry before the model
  starts skimming it, and eleven of them are a page long. Deepen or drop.

- **Do not add more plugin tools until 3.1 lands.** 92 is already past where selection accuracy
  degrades. Every new tool makes every existing one slightly harder to pick correctly.

- **Do not fork the prompt per provider.** `docs/agent-behaviour.md` states this policy and it is
  right. Every provider-specific recommendation in this folder lives *behind the provider seam* —
  transport-level, in `providers/*.ts` — which is exactly what that seam was built for.

- **Do not touch the mode boundaries or the honesty gates.** The Architect write scope, the
  specialist allowlists, the 6-file checkpoint, the zero-files-changed error. These are the best
  ideas in the codebase and none of the findings touch them.

---

## What you need to do

1. **Tonight:** run `pnpm eval` on `claude-opus-5`. One command.
2. **Take Phase 1 to the council as five separate proposals**, not one — each is independently
   shippable and independently arguable, and bundling them would make a single objection block all
   five.
3. **Ship 1.1 and 1.2 first.** They are the smallest, the safest, and one of them is a straight bug.
4. **Do not start Phase 2.2 (effort tuning) until 2.1 (the cache/cost axis) is in.** Changing the default
   effort without a measurement is exactly the kind of decision this folder exists to prevent.

Nothing in this folder changes code. It is a proposal set.

---

*Reviewed 2026-08-31 · `feat/clone-command` @ `29e6ed0` · agent suite 325/325 green at time of
writing.*
