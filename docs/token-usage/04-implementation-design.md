# Implementation design

This is the concrete path; it is intentionally staged so each saving can be attributed and rolled
back independently.

## Phase 0 — measurement contract

Add these types under the provider seam:

```ts
interface UsageBreakdown {
  uncachedInput: number;
  cacheReadInput?: number;
  cacheWriteInput?: number;
  output: number;
  reasoningOutput?: number;
  requestCount: number;
  retryCount: number;
  estimated: boolean;
}

interface CostBreakdown {
  currency: "USD";
  uncachedInput: number;
  cacheReadInput: number;
  cacheWriteInput: number;
  output: number;
  fixedFees: number;
  total: number;
  rateCardVersion: string;
}
```

Persist one row per provider request, not only a final session total: session, turn, iteration,
attempt, provider, requested and resolved model, prompt/tool/history fingerprints, usage, cache
state, latency, stop reason, error class, and cost. Never store secrets or raw prompt content in
telemetry.

Add a versioned `pricing/*.json` registry maintained from official sources. A missing rate returns
`cost: null`, never zero. Subscription use reports tokens only unless an auditable marginal price
exists.

## Phase 1 — portable token policy

Create `apps/agent/src/token-policy/`:

- `capabilities.ts` — model/provider capability records and conservative defaults;
- `budget.ts` — computes input/output/reasoning/round/dollar budgets by mode;
- `history.ts` — validates tool pairs, selects pinned/recent/compacted bands;
- `artifacts.ts` — replaces old file/shell payloads with hashes and pointers;
- `fingerprint.ts` — deterministic hashes for stable prompt, tools, history prefix, project state;
- `cost.ts` — applies a dated rate card to usage;
- `types.ts` — contracts with no vendor imports.

Extend `ConversationOptions` with the computed policy, session cache key, and stable fingerprints.
Extend the provider interface with an optional `countTokens()`; use an explicit conservative
estimator only when no official/local tokenizer exists, and mark it estimated.

Before each request:

1. reserve output and safety margin from the model window;
2. construct pinned + compacted + newest valid history within the remaining input budget;
3. include complete active tool-call/result pairs;
4. apply the current tool catalog;
5. reject or compact before the provider returns a context-limit error.

Before `addToolResults`, apply a model-facing output budget. Store the full result as an artifact,
send a deterministic excerpt plus handle, and let the model page/fetch more. Preserve complete tool
call/result pairing and never shorten error identity, exit status, changed paths, or validation
outcome.

## Phase 2 — tool catalog

Replace `ALL_TOOLS` exposure with:

- core tools always available;
- connected provider/plugin families enabled at session start;
- explicit `/skill`, `/plugin`, `/agent`, or task-class families appended on demand;
- a compact discovery catalog containing name, one-line purpose, and connection status;
- native deferred-tool search where the selected model supports it.

Keep tool order deterministic. Emit `tool_schema_tokens` and `tools_offered` for every request.
Do not dynamically remove definitions inside an active prefix; start a new epoch when necessary.

## Phase 3 — provider adapters

### Anthropic

Keep current explicit breakpoints and usage capture. Add native context editing/compaction behind a
model capability and beta-version flag, with contract tests ensuring full native response content
is replayed. Compare native compaction with portable compaction; do not enable both simultaneously.

### Google

Keep implicit caching. For sessions whose static prefix clears the documented minimum and expected
reuse repays storage, create explicit cached content and retain its name/expiry in session state.
Otherwise use implicit caching. Do not create explicit caches for short or one-shot turns.

### OpenAI

Create a Responses API adapter for current models instead of forcing all API-key traffic through
Chat Completions. Pass a stable `prompt_cache_key`, use supported cache controls, expose native
compaction/tool search only by model capability, and make storage/retention a deployer policy.

### xAI

Pass the documented stable conversation/cache identifier and validate `cached_tokens` across Chat
Completions and Responses shapes. Enforce long-context price tier accounting.

### DeepSeek

Preserve the exact prefix and parse `prompt_cache_hit_tokens` and
`prompt_cache_miss_tokens` in addition to generic fields. Do not treat an absent generic
`cached_tokens` field as a miss.

### Mistral and Groq

Add live contract tests for usage fields and model eligibility. Groq caching must be marked false
for the current default model unless official model support changes. Batch is a separate offline
execution path.

### OpenRouter

Send a stable opaque `session_id`; record resolved model/provider and cache discount where returned.
Add exact-response caching only to a new explicitly idempotent request class.

### Custom

Expose a settings capability form or probe result. Allow configured tokenizer, window, output cap,
usage paths, cached price, and cache key field. All defaults disable vendor extensions.

## Phase 4 — effort/output/round control

Add task classification with deterministic rules first. Default ordinary tasks to medium, cheap
subtasks to low, and escalate after validator failure. Set per-mode output caps and a final-answer
reserve. Attribute every continuation and retry. Stop when definition-of-done checks pass.

## Phase 5 — routing and offline work

Implement within-provider model routing using existing tiers. Shadow it first: calculate the route
but keep calling the selected model. Then canary cheap tasks, compare paired quality/cost, and
expand only after gates pass. Batch/flex gets a separate queue for evals, indexing, and independent
review; it must not alter the interactive loop.

## Data migrations and API compatibility

Add request-usage storage additively. Keep existing session totals as derived compatibility fields.
Capability and rate-card records are append-only/versioned. A rollback disables the new policy and
provider extensions while retaining telemetry; no conversation data migration should be required.

## Security and privacy

- Cache keys are opaque hashes, never user text or project paths.
- Summaries and artifact pointers inherit the source conversation's access control.
- Explicit/server-side caches are disabled when deployment retention policy forbids them.
- Response caching requires an idempotency classification and project-state hash.
- Telemetry stores counts/fingerprints, not prompts, keys, images, or file bodies.
