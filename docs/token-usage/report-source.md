# Cutting Zelyq agent token cost by up to 90%

Audience: Zelyq maintainers and reviewing agents  
Date: 2026-09-01  
Scope: all providers currently registered in `apps/agent/src/providers/index.ts`  
Decision: implement a provider-neutral context budgeter plus provider adapters and measured routing

## Direct answer

Zelyq has a credible path to **up to 90% lower inference cost**, but no factual basis for promising
90% on every request or provider. The target is reachable on long, repetitive agent sessions by
stacking four independent controls:

1. remove unnecessary tokens before the request (deferred tools, artifact-backed tool history,
   retrieval, compaction);
2. maximize discounted prefix reuse where providers support it;
3. cap reasoning/output and eliminate retry/churn rounds;
4. route mechanical steps to a cheaper capable model and offline work to batch/flex tiers.

The strongest single verified price lever is repeated-input caching: current official prices show
cache-read rates of 0.1× input for current [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
general models, 0.1× for current [Mistral](https://docs.mistral.ai/inference/pricing) cached input,
0.02×–0.0083× for current [DeepSeek V4](https://api-docs.deepseek.com/quick_start/pricing)
models, and 0.25× for [Grok 4.6](https://docs.x.ai/developers/models/grok-4.6). OpenAI's behavior
is model-dependent; its [current prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
specifies 0.1× cache reads but 1.25× cache writes for GPT-5.6 and later. These are **price
reductions on cached input**, not reductions in context size.

## What the repository already does

Zelyq is not starting from zero:

- Anthropic requests put cache breakpoints on the stable system prompt and the last two message
  boundaries (`providers/anthropic.ts`).
- Anthropic, Gemini, and the OpenAI dialect expose cached-token counts through the provider seam.
- persisted `write_file` and `edit_file` bodies are stripped before history replay, avoiding a
  previously measured 68.5% share of tool-call bytes.
- repeated identical calls and per-path churn have circuit breakers.
- per-child and per-orchestration token ceilings exist.

Those controls reduce waste but do not provide a complete cost system. Full persisted history is
still replayed; non-Anthropic conversations have no local compaction; every ordinary session can
receive the full tool surface; the OpenAI/OpenRouter cache-routing keys are not set; high reasoning
is the default; output ceilings are large; and usage is accumulated as tokens rather than priced
against a versioned provider rate card.

## The recommended architecture

Introduce one `TokenPolicy` computed at session creation and enforced before every provider call.
It owns:

- mode-specific input, output, reasoning, round, and dollar budgets;
- stable-prefix construction and a deterministic prompt/tool fingerprint;
- a provider-neutral history reducer that retains recent prose, active tool-call pairs, decisions,
  errors, and a durable summary while replacing old file bodies with artifact references;
- a two-stage tool catalog: core tools now, connector/specialist schemas only when selected;
- provider capabilities for cache controls, cached-usage fields, batch/flex eligibility, and
  server-side state/compaction;
- a quality-gated router for strong, standard, and cheap work;
- per-request cost accounting from uncached input, cache reads, cache writes, output, and reasoning.

The order matters. Instrument first, then reduce schemas/history, then enable provider cache
controls, then tune reasoning/output, and only then enable automatic model routing. This isolates
regressions and prevents a cheap but worse result from being reported as a win.

## How 90% is established

For each request:

`cost = U·Pu + R·Pr + W·Pw + O·Po + fixed_tool_fees`

where `U` is uncached input, `R` cache-read input, `W` cache-write input, `O` output including
billable reasoning where applicable, and each `P` is the model's effective price. Session cost is
the sum of requests plus retries and subagents.

A release may say “up to 90%” only when at least one predeclared, representative workload has:

- `(baseline_cost - candidate_cost) / baseline_cost >= 0.90`;
- the same provider availability and task definition;
- no material quality regression under deterministic checks plus blinded review;
- at least 30 paired runs or enough pairs for a predeclared confidence interval;
- cache-warm and cache-cold results reported separately;
- failures, retries, latency, and external tool fees included.

Fleet-wide claims must use the production-weighted median/mean, never the best case. “90% fewer
tokens” requires the same calculation on actual processed token counts and cannot be inferred from
cache discounts.

## Expected contribution by workload

| Workload shape | Primary lever | Defensible expectation before benchmarks |
|---|---|---|
| long multi-step session, stable prefix | cache + history reduction | highest chance of approaching 90% cost reduction |
| many unused connector tools | tool deferral/gating | large actual input-token reduction |
| repeated file writes/reads | artifact references + paging/diffs | fewer history tokens and corrective rounds |
| simple mechanical changes | cheaper-model routing + low reasoning | large cost reduction; quality gate required |
| one short, novel prompt | output cap/model selection | modest; 90% usually impossible without changing model |
| identical idempotent request | application response cache | near-100% provider cost reduction where policy permits |

## Material limitations

- Provider prices and cache rules change; the rate card must be versioned and refreshed.
- Generic OpenAI-compatible endpoints cannot be assumed to cache, count tokens accurately, or
  accept vendor-specific fields. Capabilities must be probed or configured.
- Cache hits are not guaranteed and can conflict with aggressive summarization because rewriting
  an early prefix invalidates it.
- Subscription-backed private endpoints may not expose reliable price data; report token volume
  and cache metrics without inventing dollar cost.
- Batch and response caching do not fit interactive, state-changing agent turns without idempotency
  and freshness controls.

## Decision

Approve phases 0–3 in the implementation design immediately. Hold automatic cross-model routing
and public savings claims behind the evaluation gates. The resulting system will cut waste for all
providers and exploit deeper discounts only where official provider capabilities prove them.
