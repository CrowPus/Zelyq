# Solution — measurement

Addresses findings **F1–F6**.

The eval harness in `apps/agent/evals` is the best thing in this repository that nobody outside it
knows about. Its README explains why its own former headline metric (`works`, later `intact`) was
worthless — *"every case starts from a template that already satisfies all three. An agent that
changes nothing scores 100%"* — and replaces it with one that is not. That is a level of
intellectual honesty most eval suites never reach.

So none of this file is about how the harness is built. It is about what it is pointed at.

The reason this matters more than it looks: **most of the other five files in this folder end with
"measure it."** [03-api-alignment.md](./03-api-alignment.md) §5 cannot recommend `xhigh` without a
number — the suite *can* answer that one today, on the right model. [01-context-and-cost.md](./01-context-and-cost.md)
cannot prove the caching change worked without cache-token accounting, which the suite cannot see
yet. Fixing both is the prerequisite for the rest of the review being verifiable rather than
persuasive.

---

## 1. Run it against the model you actually ship

**Fixes F1. Do this tonight — it is one command.**

Of the **35** recorded runs in `apps/agent/evals/results/` (2026-08-22 to 2026-08-26), thirty-three
are `google` / `gemini-3.7-flash` and two are `openai` / `gpt-5.1`.

**Zero are Anthropic.** The shipped default is `anthropic` / `claude-opus-5`.

Every prompt-wording decision on record has been validated against a model most users will never
run. A change that helps Gemini Flash and hurts Opus 5 is currently invisible, and the direction of
that error is the bad one: guidance written to prop up a weaker model is usually
over-prescriptive for a stronger one, and over-prescriptive prompting measurably *reduces* output
quality on the current Claude family.

### What to do

Run the full suite three times and record all three:

```bash
ZELYQ_PROVIDER=anthropic ZELYQ_MODEL=claude-opus-5   pnpm eval
ZELYQ_PROVIDER=anthropic ZELYQ_MODEL=claude-sonnet-5 pnpm eval
ZELYQ_PROVIDER=google    ZELYQ_MODEL=gemini-3.7-flash pnpm eval   # keeps the existing baseline comparable
```

The suite already records `provider` and `model` per run, so `--compare` will do the right thing.
Note the README's own warning and honour it: *"Models are not deterministic. A single case flipping
is noise; the suite-level `done` number moving is signal. Run it twice before believing a small
change."*

### What you will probably find

The last full run (`2026-08-24T01-29-32-629Z.json`, 22 cases, **19 done**, ~10 min wall at
concurrency 3, 1.19M in / 84k out) failed exactly three cases, all on **restraint** checks:

| case | rounds | failed check |
| --- | ---: | --- |
| `landing-page` | 18 (30 in the later partial run) | changed at most 7 files |
| `no-invented-secrets` | 17 | changed at most 8 files; no file over 400 lines |
| `empty-state` | 18 (37 in the later partial run) | changed at most 6 files |

Round counts of 30 and 37 are flailing, and the README says so: *"a case that jumps from 4 rounds to
14 is flailing even if it still passes."* Scope discipline on open-ended work is the agent's known
weakness. It would be genuinely useful to know how much of that is the prompt and how much is the
model — and one run answers it.

---

## 2. Finish the cost axis

**Fixes F4.**

**Correction to an earlier draft:** tokens are already measured. `CaseResult` carries `tokensIn` /
`tokensOut`, the summary prints them, and `--compare` shows a signed delta:

```
   rounds   210 → 187  (-11%)
   tokens   1.9M → 1.2M in  (-37%)
   wall     2217s → 1761s  (-21%)
```

That is a good axis and it was already there. Two pieces are missing.

### Cache tokens — the one that blocks everything else

`TurnResult.usage` drops `cache_read_input_tokens` and `cache_creation_input_tokens` (finding
**A4**), so the harness cannot see them.

This is not cosmetic. On Anthropic, `input_tokens` **excludes** cached tokens. Ship
[01-context-and-cost.md](./01-context-and-cost.md) §1 and this suite will report `tokensIn` falling
by ~90% — while the true request size is completely unchanged. It would look like the biggest win
in the project's history and it would be measuring the wrong quantity.

So: **A4 is a hard prerequisite for measuring the caching work at all.** Widen `TurnResult.usage`,
accumulate the two new fields in `harness.ts` alongside the existing pair, and report the total
prompt size and the cached fraction, not just the uncached remainder.

### A dollar figure

`PROVIDERS` carries `models[].tier` but no rates. Compute:

```
(input × in) + (cache_read × in × 0.1) + (cache_creation × in × 1.25) + (output × out)
```

Once cache tiers are in play at 0.1× and 1.25×, token count and cost stop being proportional — which
is precisely the regime the Group A work moves into. A token delta will no longer answer "did this
get cheaper".

Anchored on the last full run, `claude-opus-5` at $5/$25 per MTok puts a 22-case suite at roughly
**$8–15**.

### Done — 2026-09-01

A4 shipped the cache fields (`TurnResult.usage`, the `usage` event). On top of that:

- `CaseResult` gained `cacheReadTokens` / `cacheCreationTokens`, accumulated in `harness.ts`
  alongside `tokensIn` / `tokensOut`.
- `evals/rates.ts` — a hand-maintained per-model rate table (not in `PROVIDERS`; the eval report is
  its only consumer). `estimateCostUsd`, `totalPromptTokens`, `cachedFraction`, `formatUsd`. A model
  with no entry returns `null` and the report shows `—` rather than a fabricated number.
- The report's `tokens` line now reads the **total** prompt size with a `· NN% cached` note, not the
  uncached remainder. New `cost` line. `--compare` gained a `cost` delta, and its token delta
  switched from `tokensIn` to the total — so shipping conversation caching no longer shows up as a
  spurious ~90% token drop.
- `apps/agent/test/eval-cost.test.ts` — 7 cases. Replayed against the recorded 2026-09-01
  `claude-opus-5` run, the suite figure comes out at $2.94, matching this doc.

The rate table is best-effort and dated by its own comment. `claude-opus-5` is anchored to the
$5/$25 above; the rest of the Claude family follows Anthropic's list ratios; non-Anthropic entries
are estimates for the models the suite has actually run on.

### One caution

Cost must never become the headline. This README's whole argument is that a generous headline metric
corrupts everything downstream, and "cheapest" is generous in exactly the way `intact` was — an
agent that does nothing is free. `done` stays the headline; cost is the tie-breaker between two
changes that both hold `done`.

---

## 3. Measure the modes and the specialists

**Fixes F3.**

**Correction to an earlier draft:** Engineer Mode *is* covered — `run.ts --engineer-mode` runs the
same cases with the mode on, and a proper three-times-paired A/B was run on 2026-08-26.

Start by reading what that A/B returned, because it is the best argument in the repo for §1:

| paired run | mode off | mode on |
| --- | ---: | ---: |
| 20:07 / 20:11 | 6/9 | 7/9 |
| 20:15 / 20:19 | 6/9 | 8/9 |
| 20:23 / 20:28 | 8/9 | 6/9 |

Off: 6, 6, 8. On: 7, 8, 6. The spread **inside** each arm is as large as the difference between
them. Six runs and roughly 8M tokens bought no answer — about the mode this product recommends, on a
model this product does not ship.

Two lessons, and they are the useful part:

- **Nine cases is not enough statistical power** for a difference this size. Either the effect is
  small and needs the full 32-case suite with repeats, or the checks are not measuring what the mode
  actually changes. Before running that A/B again, decide which.
- **Run it on `claude-opus-5` first.** Engineer Mode's four directives are about judgement —
  purpose framing, epistemic labelling, naming the alternative, knowing when to stop and ask. Those
  are exactly the behaviours a weaker model complies with least reliably, which is why `session.ts`
  carries a "weak-model backstop" for the `/agent` version of the same problem. Measuring judgement
  discipline on Gemini Flash measures the model's ceiling, not the mode's value.

### What genuinely has no coverage

32 cases, all `vite-react`. Tag distribution: `restraint` 15, `quality` 9, `specified` 6,
`greenfield` 5, `modify` 4, `bugfix` 3, `large-task` 1.

No case and no flag exercises **Architect Mode, Auto Mode, `design_pass`, `ops_pass`, `qa_pass`,
`cinematic_pass`, `dispatch_task`, the Expo template, or `/clone`.**

All of those have unit tests — `architect-orchestration.test.ts` (621 lines),
`designer-agent.test.ts` (576), `cinematic-agent.test.ts` (499), `engineer-mode.test.ts` (806),
`anti-slop.test.ts` (387), `expo-stack.test.ts`, and the rest; **325 tests green**. Those prove the
plumbing works. They say nothing about whether the agent does the job well, which is the only
question that matters to a user.

### What to add, in priority order

**Sharper Engineer Mode checks.** The flag exists; what it measures does not yet include what the
mode uniquely promises. Add checks for:

- the `Purpose:` marker (`ENGINEER_MODE_PURPOSE_MARKER` — a `reply_matches` check, and a shape check
  only, exactly as `session.ts` already labels its own version)
- verified / inferred / assumed distinguished in the final message
- the 6-new-file checkpoint firing when it should and, importantly, **not** firing on
  correctly-scoped work of four or five files

Without these, an Engineer Mode run is scored on the same criteria as a default run, which is
partly why the A/B above returned nothing.

**The Expo template.** `templates/expo-react-native` shipped in `87b883a` with `web.output: static`
and an Expo-web preview. It has a stack skill force-woven into turn one specifically because
building with `div` instead of `View` produces a screen that renders nothing. That is a check a
machine can decide — `project_matches` on `<View`, and the absence of bare `<div` in `app/` — and it
is exactly the kind of silent failure a unit test cannot catch. The `--template` flag is already
plumbed through; the README says so.

**`/clone`.** Point `capture_reference` at a small fixture site served locally by the harness (never
a live third-party site in CI), and assert the replica builds and the geometry is within tolerance.
`capture-reference.ts` already computes a pixel diff with a `changedRatio` — that is a
machine-decidable check sitting right there, unused by any eval.

**The specialists.** Harder, because "the design got better" is not machine-decidable — and the
README's rule is absolute and correct: *"Every check must be decidable by a machine. If a human has
to judge it, it does not belong here."* But the **honesty gates** are decidable, and they are the
part most worth protecting:

- a pass that changed 0 files returns an error, not a review
- a pass that changed only its own spec file returns an error
- a pass that worked without ever writing its spec returns an error
- the parent relays the review verbatim and does not upgrade a FAIL to a PASS

Those four are the guarantees the specialists' whole credibility rests on. They are checkable, and
right now nothing checks them end to end.

**Architect Mode.** The most valuable and the most awkward — it is interactive by design (five
substantial questions before the package). A scripted-answer harness case is doable and worth it:
assert that every required package file exists and is non-stub, that `topology.json` validates
against the schema in `packages/core/src/topology.ts`, that every requirement traces to a decision
and a build task, and that `report.html` passes `reportHtmlAdvisory`. All machine-decidable.

---

## 4. Make running it routine

**Fixes F2.**

The last full run predates `/agent` dispatch (`ce4429e`), the `/agent` menu (`68a7192`), the
responsive-preview switcher (`9aaf832`), Expo (`87b883a`), and `/clone` (`7621573` and after). Five
shipped features with no behavioural measurement between them.

That is not negligence — the suite costs real money and takes fifteen minutes, and the README says
so plainly. But "run it when someone remembers" always decays to "run it never".

### Make it cheap to be disciplined

- **A `--tag` smoke set on every agent PR.** `pnpm eval --tag restraint --limit 6` is a few dimes
  and catches the failure mode this agent actually has. Cheap enough to be routine.
- **The full suite before any release**, on `claude-opus-5`, with the result committed. The results
  directory is already in the repo, which is the right instinct — it makes the history reviewable.
- **A `promptHash` gate.** Every result file already records one
  (`"promptHash": "20711ed13dfd"`). CI can fail a PR that changes `prompt.ts` with no eval result
  recorded for the new hash. That is a small script and it converts a good intention into a rule.

### The gap the harness names about itself

The README is honest about what it does not measure:

> **Whether it looks good.** `project_matches` can confirm a `<footer>` exists. It cannot tell you
> the page is well designed, and the system prompt asks for exactly that.

That gap is bigger now than when it was written, because `design-md/Agent.md`'s MUST rules were added
since and **a good chunk of them are observable**: a visible `:focus-visible` style, no bare
`outline: none`, `<a>`/`<Link>` for navigation rather than `<div onClick>`, `prefers-reduced-motion`
honoured, explicit `width`/`height` on images, `aria-label` on icon-only buttons, `min-w-0` on
truncating flex children, `tabular-nums` on comparing numbers, `color-scheme` set on a dark theme.

Every one of those is a `project_matches` regex or a DOM assertion. The verifier and the Designer
child are already told to check them against the running preview (`session.ts:407`). The eval
harness can check the same list, mechanically, and turn "does it look designed" from a human
judgement into a partial machine one. Not the whole question — but the observable half of it, which
is more than zero and is currently unmeasured.

## 5. Do not score a case the model never reached

**Fixes F5. Small, and it prevents a whole category of wasted run.**

Three changes to `harness.ts` and `run.ts`.

### Fail the case, do not check it

When the turn ends with a provider-level error, the checks must not run. A pristine template passes
every critical check by construction, which is why an unreachable model currently reports
`intact 5/5 (100%)`.

```ts
// After session.run(), before the check loop:
if (result.error && neverRan(result)) {
  // The model was never reached — 0 rounds, 0 tokens, nothing changed.
  // Scoring a pristine template tells you about the template, not the agent.
  return result;   // errored: distinct from intact / done / clean
}
```

`neverRan` is honest and cheap: `result.rounds === 0 && result.tokensIn === 0`. A case that got
partway and *then* hit a rate limit did produce real work and should still be scored — the
distinction that matters is whether anything ran at all.

### Add a fourth state to the report

`✓ clean`, `◑ done`, `~ intact`, `✗ broken` — and now `⚠ errored`. It must not be `~`, because `~`
means "it still builds", which is a claim about the agent's work, and there was none.

```
 errored  5/5   the model was never reached — this run measures nothing
```

When every case errored, the summary should say that instead of printing a `done 0%` /
`intact 100%` table that invites exactly the wrong reading.

### Abort the suite on a repeated configuration error

Five identical `models/gpt-5.2 is not found` errors is one configuration problem, not five
measurements. After the second case fails with the same provider error code and zero rounds, stop
the run and print the cause:

```
Aborted: 2 cases failed identically before reaching the model.

  internal: models/gpt-5.2 is not found for API version v1beta

  ZELYQ_PROVIDER=google with ZELYQ_MODEL=gpt-5.2 — that model belongs to a
  different provider. Set both, or neither.
```

Better still, **check before scaffolding anything.** `run.ts` already validates that a key exists,
that an OpenAI-dialect provider has a `baseUrl`, and that a custom provider names a model. A
provider/model mismatch is the same class of error and belongs in the same block — one
`models.retrieve` call, or one trivial completion, before the first `npm install` runs.

### Do not save a run that measured nothing

An all-errored run is currently written to `evals/results/` with a real timestamp, where
`--compare` will read it as a catastrophic regression. Either skip the write, or set a
`aborted: true` flag on `SuiteResult` that `compare()` refuses, the same way it already refuses a
stale-format run:

> That run predates the scoring fix… There is no honest conversion between the two.

That refusal is exactly the right instinct and it already exists. This is one more case for it.

---

## 6. Make the restraint checks measure restraint

**Fixes F6. Do this before drawing any conclusion from a restraint failure.**

The check that failed all three Opus 5 cases counts **files changed**. What the `<scope>` section
actually forbids is **building things nobody asked for**. Those coincide on a weak model and come
apart on a strong one.

Evidence, same five cases, same prompt hash, three models:

- `todo-app` (cap 6): gpt-5.2 passed with **1 file**; Opus 5 failed with 7 — a form, an item, a
  list, a types module, a hook. That is a correct decomposition losing to a monolith.
- `pricing-toggle` (cap 7): gpt-5.2 passed with **1 file**; Opus 5 failed with 8, the same shape as
  Gemini's passing 7 plus `index.html` and `index.css`.
- `landing-page` (cap 7): Opus 5 failed with 9, two of which were `Wordmark.tsx` and
  `AnnotatedPage.tsx` — **genuinely invented scope**, correctly caught.

So the check is right one time in three, and the other two are it punishing structure the prompt
explicitly asks for.

### Fixed — 2026-09-01

`scopeRelevant()` in `apps/agent/evals/checks.ts` discounts the manifest and its lockfiles
(`package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`) from
`max_files_changed`. No cap changed. `apps/agent/test/eval-scope-count.test.ts` locks the behaviour
to the real file lists from all three models.

**The first attempt was too broad and is worth recording.** Discounting all "chrome" —
`index.html`, `src/index.css`, `tsconfig.json`, `vite.config.ts` — fixed the two false failures and
also made `landing-page` pass, which is the one case that *should* fail. Editing the entry document
or the global stylesheet is a scope decision; installing something is a side effect. Only the second
kind can be discounted.

Replayed against all fifteen real data points (five cases × three models), the narrowed rule changes
exactly two verdicts, and they are the two that were wrong:

| case | model | cap | before | after |
| --- | --- | ---: | --- | --- |
| `todo-app` | opus-5 | 6 | FAIL (7 files) | **PASS** (6 + manifest) |
| `pricing-toggle` | opus-5 | 7 | FAIL (8 files) | **PASS** (7 + manifest) |
| `landing-page` | opus-5 | 7 | FAIL (9 files) | **FAIL** (8) — correct, `Wordmark.tsx` |
| the other 12 | — | — | unchanged | unchanged |

That moves the 2026-09-01 `claude-opus-5` five-case result from **2/5 to 4/5**, with the one real
scope failure intact.

### Done — name the invention directly — 2026-09-01

`{ kind: "no_unrequested_components", allow: string[], why }` in `evals/types.ts` /
`evals/checks.ts`, with the pure helper `unrequestedComponents(newFiles, allow)` exported for the
unit test. It judges only **newly created** `src/**/<Name>.{tsx,jsx}` (uppercase initial, so
`useTodos.ts` and `types.ts` are never components here). A component passes when **every**
feature-bearing word in its name is covered by an `allow` stem or is a generic layout noun (`Card`,
`Section`, `Grid`, `Header`, …):

```ts
{ kind: "no_unrequested_components", allow: ["Hero", "Feature", "Footer", "CallToAction", "Cta"],
  why: "the request named a hero, feature cards and a footer — nothing else" }
```

So `allow: ["Feature"]` admits `FeatureCard` and `Features`; `allow: ["Todo", "Add"]` admits
`AddTodoForm` but not `TodoFilter`, because `filter` is a feature nobody asked for. `Wordmark.tsx`
and `AnnotatedPage.tsx` fail it; `TodoList.tsx` in a case that asked for a todo list does not.
Machine-decidable, which is this suite's own bar.

Added to the six cases that carry `max_files_changed` and name their surface concretely —
`landing-page`, `todo-app`, `pricing-toggle`, `dashboard-layout`, `contact-form`,
`extract-components`. No cap changed: the file count is now the loose backstop, not the primary
signal. `apps/agent/test/eval-unrequested-components.test.ts` pins the behaviour to the real model
diffs (10 cases), alongside `eval-scope-count.test.ts` for the manifest half.

**Not yet done: the prompt half.** The check measures restraint; it does not improve it. Run
`pnpm eval` on `claude-opus-5` over the five restraint cases (twice — non-deterministic model) to
get a `no_unrequested_components` baseline before touching `<scope>` wording, per §2.2's "do not
change the default on a hunch".

### Until that lands, read a restraint failure by opening it

`CaseResult.filesChanged` is recorded in every result JSON. Before treating a restraint failure as
a regression, look at the list and ask whether the extra files implement something the prompt
named. `--keep` leaves the project on disk for the same purpose. Two of the three failures above
dissolve under thirty seconds of that inspection; the third does not, and is the real finding.

---

---

## What this adds up to

| change | fixes | effort | payoff |
| --- | --- | --- | --- |
| Run the suite on `claude-opus-5` | F1 | **one command** | the first real baseline for the shipped product |
| Cache tokens + a dollar figure **(done)** | F4 | small | makes [01](./01-context-and-cost.md) §1 verifiable at all |
| Engineer-Mode-specific checks (`Purpose:`, checkpoint, labelling) | F3 | small | the existing `--engineer-mode` A/B starts measuring the mode, not the model |
| Expo + `/clone` cases | F3 | medium | two shipped features with zero behavioural coverage |
| Specialist honesty-gate cases | F3 | medium | protects the guarantee the specialists rest on |
| `Agent.md` observable MUSTs as checks | F3 | medium | the observable half of "does it look designed" |
| Smoke set per PR + `promptHash` CI gate | F2 | small | discipline that does not depend on memory |
| Errored cases skip checks; abort on repeated config error | F5 | small | a config typo stops costing a run and a misleading report |
| Manifest discounted from `max_files_changed` **(done)** | F6 | small | two false restraint failures fixed; the real one kept |
| A `no_unrequested_components` check **(done)** | F6 | small | restraint measured directly instead of by proxy |

---

## What you need to do

**Run `pnpm eval` on `claude-opus-5` tonight.** It is one command, it costs a few dollars, and it
will tell you more about where this agent actually stands than the rest of this folder does. Every
recommendation in these six files that says "measure it" is waiting on that number.

Then add the cache-token fields, because without them shipping the caching work will make this
suite report a 90% win that is not real.

**Next:** [07-roadmap.md](./07-roadmap.md)
