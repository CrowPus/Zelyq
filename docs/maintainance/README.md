# Agent maintenance — findings and solutions

> **Verification pass — 2026-09-01, on `feat/figma-to-website` (= `main` after #123, #124).**
> Read against the current tree; every technical claim spot-checked and confirmed. Two items have
> moved since the review's `29e6ed0` baseline:
>
> - **A1 (conversation never cached) — shipped, in PR #124.** `withConversationCacheBreakpoint`
>   in `providers/anthropic.ts` adds a rolling `cache_control` breakpoint on the last message.
>   It is the *single*-tail version, not the two-breakpoint pattern in [01](./01-context-and-cost.md) §1
>   — functionally correct (Anthropic prefix-matches the previous write automatically), the
>   two-breakpoint upgrade is a small refinement. **A4 (cache-token capture) is still open and is
>   now the priority** — without it the usage display and the eval suite will report `tokensIn`
>   dropping ~90% and be measuring the wrong quantity.
> - **F6 (the `max_files_changed` manifest half) — done, on disk, uncommitted.** `scopeRelevant()`
>   in `apps/agent/evals/checks.ts` + `apps/agent/test/eval-scope-count.test.ts`. Needs committing.
>   Naming invented scope directly is still open.
>
> Everything else in the roadmap stands. Tonight's order: A4 (+ the 2-breakpoint upgrade) → C1
> (`max_tokens`) → E1 + C2 (untrusted content + operator `role: system`) → B2/B3/B4 → D1 (`AGENTS.md`).

An engineering review of Zelyq's agent, written to answer one question: **what is standing between
this agent and the bar a Claude Code-class agent holds?**

Zelyq's agent is not a weak agent. The system prompt is better written than most production prompts
in this space, the mode boundaries are enforced structurally rather than by asking nicely, the
specialist honesty gates are a genuinely good idea, and `docs/agent-behaviour.md` is the clearest
account of an agent loop I have read in an open-source project. The gaps below are not "this is
badly built". They are the specific places where the loop, not the prompt, is the thing holding
the agent back — and where a competitor with the same model gets more out of it.

## How this was produced

Read, measured, and verified against this checkout on **2026-08-31**, on branch
`feat/clone-command` (`29e6ed0`).

Nothing here is an impression. Every number in the findings was produced by one of:

- **Reading the source** — `apps/agent/src/session.ts` (3,597 lines), `prompt.ts` (1,096),
  the four providers, `packages/tools/src/*`, `apps/server/src/ws/gateway.ts`,
  `packages/db/src/repositories/messages.ts`.
- **Running the code** — the real tool registry and the real `buildSystemPrompt` were instantiated
  from `dist/` and measured.
- **Querying the real database** — `data/zelyq.db`, 453 messages across live sessions from this
  machine. The context-cost numbers are what Zelyq actually sends today, not a projection.
- **Reading all 35 recorded eval runs** — `apps/agent/evals/results/*.json`.
- **The current Anthropic API contract** — the bundled `claude-api` reference, for what the platform
  offers today (caching breakpoints, context editing, compaction, tool search, task budgets,
  mid-conversation system messages, effort levels).

Baseline health at time of writing: `pnpm --filter @zelyq/agent test` → **325/325 pass**.
`pnpm -r test` → exit 0. Every recommendation below lands on a green tree.

## What is in here

| File | What it is |
| --- | --- |
| [00-findings.md](./00-findings.md) | The audit. 30 findings, each with its evidence and the file:line it lives at. Read this first. |
| [01-context-and-cost.md](./01-context-and-cost.md) | **The biggest lever.** Caching, context editing, compaction. The one file to read if you only read one. |
| [02-tool-surface.md](./02-tool-surface.md) | 92 tools, no file paging, no diffs back, a write race. What the agent's hands can and cannot do. |
| [03-api-alignment.md](./03-api-alignment.md) | Where Zelyq leaves capability on the table that the Messages API already ships. |
| [04-agent-competence.md](./04-agent-competence.md) | Project memory, plan state, budget awareness — the things that make a long build hold together. |
| [05-untrusted-content.md](./05-untrusted-content.md) | Prompt injection. Zelyq now reads cloned websites and third-party issue trackers. It has no boundary. |
| [06-measurement.md](./06-measurement.md) | The eval suite is good, and has never once been pointed at the model Zelyq ships. |
| [08-the-starting-point.md](./08-the-starting-point.md) | The template every project begins from — currently fighting the prompt. Four small files, highest quality-per-effort in the folder. |
| [07-roadmap.md](./07-roadmap.md) | The order to do it in, with what each buys and what it costs to build. |

## How to read the findings

Each finding has three parts:

- **What is true** — the fact, with where to verify it.
- **What it costs** — the observable consequence, in money, in failure, or in capability.
- **Why it is not already fixed** — because most of these are not oversights. They are the
  reasonable version of the design before the product grew into the next problem.

That last part matters. Several of these were *correct* when written. `truncate()` at 30,000
characters was right when the agent only ever met a ten-file template it scaffolded itself; it is
wrong now that "open an existing repository" ships. One cache breakpoint on the system prompt was
right when a turn was four round-trips; it is wrong now that a turn can be fifty.

## What this review does not cover

Stated plainly so a green report is not read as more than it is:

- **The web app.** `apps/web` was read only where it touches the agent stream.
- **Runtime and container isolation.** `SECURITY.md` covers this honestly and I found nothing to
  add; the one security finding here (prompt injection) is a *content* boundary, not a process one.
- **Auth, teams, billing, licensing.** Out of scope.
- **Whether the prompt's wording is optimal.** That is what the eval suite is for, and
  [06-measurement.md](./06-measurement.md) says how to make it able to answer.

## What you need to do

Read [00-findings.md](./00-findings.md), then [07-roadmap.md](./07-roadmap.md). The roadmap puts
five findings in Phase 1 that together account for most of the gap; the rest can wait.

Nothing in this folder changes code. It is a proposal set, for the council.
