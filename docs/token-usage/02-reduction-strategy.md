# Reduction strategy

> **Amended 2026-09-02** — see [`07-review-and-amendments.md`](./07-review-and-amendments.md).
> The priority order below is superseded. Measured usage puts output at 0.8% of processed tokens,
> so lever 4 (bounded reasoning/output) is a safety control, not a savings lever, and the
> “85% input / 15% output” arithmetic at the end of this file should be redone at ~96% input.
> Prefix caching that actually fires — Gemini explicit `cachedContent` first — moves to priority 1.

## The ordered reduction stack

The levers below are cumulative but not simply additive. Each must be measured against the same
baseline because reducing history also reduces the number of tokens eligible for a cache discount.

| Priority | Lever | Reduces actual tokens? | Reduces price/token? | Provider scope |
|---:|---|---|---|---|
| 0 | exact telemetry and budgets | no | enables control | all |
| 1 | dynamic tool schema loading | yes | indirectly | all; native deferral where supported |
| 2 | artifact-backed history and token budget | yes | indirectly | all |
| 3 | stable-prefix caching and routing keys | no | yes | capability-specific |
| 4 | bounded reasoning/output | yes | no | capability-specific with portable output cap |
| 5 | fewer rounds via better tool feedback/loop detection | yes | no | all |
| 6 | quality-gated model routing | usually no | yes | providers with multiple capable tiers |
| 7 | batch/flex/response cache | sometimes | yes | eligible asynchronous/idempotent work |

## 1. Dynamic tool schemas

Always send a small core: file navigation/editing, command execution, preview, plan/status, and a
single tool-discovery mechanism. Load connector tools only when connected and explicitly mentioned;
load specialist tools only when a mode/task selects them. Preserve deterministic order and append
new definitions rather than rewriting earlier ones, protecting prefix-cache reuse.

Target: reduce ordinary-session tool-schema tokens by at least 60% from the measured loaded-plugin
baseline, without increasing failed tool calls.

## 2. Artifact-backed history

History should carry decisions and state, not duplicate the filesystem. Replace old large tool
inputs/results with typed references such as path, content hash, line range, exit status, and a
short outcome. Keep the complete live tool pair until the next model response, then make it
eligible for reduction. Never cut between an assistant tool call and its matching result.

Use three bands:

- **pinned:** system/developer policy, latest user goal, unresolved errors, active plan, approvals;
- **recent:** verbatim turns within a token allowance;
- **compacted:** older decisions/actions in a durable structured summary with artifact pointers.

Trigger by estimated/model-counted tokens before the provider limit, not message count. Compact in
large steps (for example from 70% to 45% of the input budget) to avoid invalidating the prefix every
turn. The exact thresholds are benchmark parameters, not hardcoded truths.

Apply the same rule to the live turn. Return a bounded model-facing excerpt plus an artifact handle
for long reads, logs, and command output; retain the complete value out of band for targeted paging.
The current persisted 4k cap does not constrain the in-memory provider conversation.

## 3. Cache-first request construction

Order input from most stable to most dynamic: tools, system instructions, project guide, durable
summary, append-only conversation, new user/tool result. Never place timestamps, attempt counters,
remaining budgets, request IDs, or user-specific volatile text ahead of the reusable prefix.

Provider adapters should:

- expose cache read/write/uncached fields without pretending absent fields are zero;
- send stable per-session routing keys where officially supported;
- use explicit breakpoints only at stable boundaries and respect minimum sizes;
- report cache-cold, write, and read requests separately;
- treat cache misses as expected, not errors.

## 4. Reasoning and output budgets

Choose effort by task class: low for search, formatting, deterministic edits, and test invocation;
medium for ordinary implementation; high only for architecture, ambiguous debugging, security, and
failed lower-effort escalation. Set an output budget for every request. Prefer structured concise
results for internal substeps; the user-facing final response can have a separate budget.

Escalate only after a validator or explicit uncertainty signal fails. Do not rerun a successful
low-effort result on a stronger setting merely for reassurance.

## 5. Round reduction

The cheapest request is the one not made. Preserve parallelism for independent reads, serialize
same-path mutation, return diffs/snippets from writes, and provide command errors with the exact
actionable tail. Detect semantic loops using normalized tool name + target + outcome, not only exact
JSON equality. End early when the task validator passes.

## 6. Model routing

Route by declared task and validated risk, not prompt length alone:

- strong: architecture, security, data migrations, cross-cutting debugging, final review;
- standard: normal feature implementation and multi-file fixes;
- cheap: repository search, summarization, formatting, boilerplate, test/log triage.

Route within the user-selected provider by default. Cross-provider routing changes data-processing
and billing boundaries and requires explicit product policy. Every route needs a fallback and a
quality threshold based on the same eval case.

## 7. Offline and exact-response paths

Use batch/flex only for independent, delay-tolerant jobs such as evals, indexing, nightly review,
or bulk summaries. Never queue an interactive tool-use step whose next action depends on it.

Application response caching can remove provider cost for identical, idempotent requests, but must
include model, prompt/tool fingerprint, project state hash, permissions, provider policy, and
freshness TTL in the key. It is unsafe for state-changing calls, personalized secrets, or requests
whose answer must observe current files.

## Why this can approach 90%

On a prompt-heavy agent workload, suppose the baseline cost share is 85% repeated input and 15%
output. Serving 95% of that input at 0.1× makes input cost `0.85 × (0.05 + 0.95×0.1) = 0.12325` of
baseline. Cutting output by 35% makes output cost `0.15 × 0.65 = 0.0975`; combined cost is 22.1%,
a 77.9% reduction. A 50% cheaper capable model for mechanical steps brings the affected portion
lower; eliminating duplicate rounds or reducing old history can cross 90% on qualifying cases.

This example is a transparent scenario, not a measured Zelyq result. The measurement protocol is
the authority.
