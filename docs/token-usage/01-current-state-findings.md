# Current-state findings

> **Amended 2026-09-02** — see [`07-review-and-amendments.md`](./07-review-and-amendments.md).
> The static-floor numbers below (base 1,718 / Engineer 3,392 / Architect 11,084 / ~15.5k floor)
> were measured against a stale `dist/` and omit the catalogs and skill bodies a real session
> sends. Rebuilt production figures: base 2,793, Engineer 10,903, Architect 19,765, and an
> Architect static floor of **~24,400** tokens. `ALL_TOOLS` is 15, not 14, and the three Supabase
> tools are already gated on a linked resource. F5 is also incomplete: the stored token counters
> are themselves wrong (R1), so the baselines cited here cannot be used as-is.

## Provider and request architecture

Zelyq registers Anthropic, Google, OpenAI, xAI, DeepSeek, Mistral, Groq, OpenRouter, and custom
OpenAI-compatible endpoints. Anthropic and Google have native adapters; most other providers share
the Chat Completions-compatible adapter. A `Conversation` holds native, append-only history and
sends a model request on every agent iteration.

The default maximum is 50 model iterations per user turn. Large agent turns therefore pay for a
growing prompt repeatedly. Retries can repeat an unstreamed request up to the configured retry
ceiling. Multi-agent modes have token ceilings, but a ceiling prevents runaway spend; it does not
make successful work efficient.

## Verified strengths already present

| Control | Repository evidence | Assessment |
|---|---|---|
| Anthropic prefix caching | `apps/agent/src/providers/anthropic.ts` marks system and last two message boundaries | good incremental pattern; needs cold/warm proof by model |
| Cached-token telemetry | provider usage type plus Anthropic/Google/OpenAI-dialect mappings | useful foundation; not yet complete cost accounting |
| Heavy persisted input stripping | `stripHeavyToolInputs` before message persistence | strong cross-provider reduction after session rebuild |
| Tool result cap | persisted results are capped in the agent loop | reduces replay size, but fixed character caps are not token budgets |
| Loop guards | identical-call and path-churn limits | prevents worst runaway loops, after some waste has occurred |
| Budget ceilings | child, orchestration, and auto-mode caps | safety control, not optimization |
| Paging/diff feedback | current file tools support bounded reads and edit feedback | reduces verification round-trips |

## Remaining high-impact gaps

### Measured static request floor

A deterministic build-time proxy (UTF-8 characters divided by four, not a provider tokenizer)
measured the base system prompt at about 1,718 tokens, Engineer at 3,392, and Architect at 11,084.
Tool JSON measured about 2,262 tokens for the base 14 tools and 4,399 for 19 Architect tools. An
empty-history Architect request therefore starts near **15.5k estimated tokens** before the user
message or optional skills/project guides. Ten cache-cold rounds would transmit about 155k static
tokens. Phase 0 must replace this proxy with provider counts, but the byte measurements are directly
reproducible from compiled `buildSystemPrompt()` and `toolDefinitions()`.

### F1 — history is not token-budgeted

The gateway loads persisted session messages and the provider reconstructs them. There is no shared
token-aware selection policy that keeps the newest valid message boundary, a durable summary, and
high-value decisions while dropping stale material. Message count is not a safe proxy: one image or
file body can dominate hundreds of prose messages.

### F2 — no portable compaction

Non-Anthropic adapters append history monotonically. Anthropic caching lowers repeated-input price
but does not stop the context from filling. A local compactor is required for every provider;
native compaction may be an adapter enhancement, never the only backstop.

### F3 — tool schemas are globally expensive

The current top-level base exposes all 14 core tools regardless of task (about 2,262 proxy tokens),
and Architect exposes 19 (about 4,399). An earlier plugin-loaded audit measured 92 tools and about
9,645 schema tokens. Sending unused schemas costs input and worsens tool selection.
Connection-aware gating and deferred discovery address both.

### F3a — live tool results are much larger than persisted results

Persistence caps a tool result at 4,000 characters, but the live conversation receives the full
`outcome.output` before that capped record is written. Current maximums allow a `read_file` result
near 60k characters (about 15k proxy tokens) and ordinary shell output near 30k (about 7.5k). That
full result remains in the native in-memory conversation on every later round. A model-facing
result budget plus out-of-band artifact handle is therefore P0, not cleanup work.

### F4 — cache routing is incomplete outside Anthropic

The OpenAI-dialect adapter relies on automatic caching but does not send OpenAI
`prompt_cache_key`, xAI conversation/cache keys, or OpenRouter `session_id`. OpenRouter explicitly
documents sticky routing by `session_id`; without it, a request can move between backing providers
and lose a warm cache.

### F5 — accounting is tokens, not money

The session records uncached input and output totals and can expose cache totals, but it does not
calculate model-versioned cost, distinguish estimated from invoice-confirmed cost, or attach a
price-card version. More critically, the gateway currently copies only `tokensIn` and `tokensOut`
from usage events into persisted messages; cache read/write fields are not stored in the database.
Child use and failed attempts are not fully reconciled into a request ledger. The same visible token
count can therefore omit much of the logical prompt and differ by orders of magnitude in price.

### F6 — high reasoning and large outputs are defaults

The configured default effort is `high`. Anthropic permits very large output ceilings, and the
OpenAI-compatible adapter does not set a portable completion cap. Output and reasoning commonly
cost more than input; a maximum is not free when unused, but loose controls allow verbose or
runaway completions and make budgets hard to enforce.

### F7 — model tiers exist but routing is advisory

The provider registry already labels models `strong`, `standard`, and `cheap`. Automatic routing is
not implemented. Mechanical discovery, formatting, tests, and summaries therefore can run on the
same expensive model as architecture and security decisions.

### F8 — retry cost is not separately attributed

Transient retries are justified for reliability but invisible as a cost category. The system
needs `attempt`, request fingerprint, retry reason, and tokens/cost per attempt so a provider fault
or an empty-completion loop cannot hide inside normal session usage.

### F9 — provider capability assumptions are too broad

“OpenAI-compatible” is not a standard. Cache fields, reasoning controls, tool behavior, tokenizer,
and batch support vary. Unknown endpoints must default to conservative behavior and expose a
capability probe/configuration surface.

## Baseline evidence already available

The earlier repository maintenance audit measured a largest live session near 291k estimated
tokens and found 4,708,086 characters in `write_file`/`edit_file` inputs—68.5% of tool-call bytes.
It also measured a five-case Gemini run at 1.445M input tokens across 97 rounds, with tokens per
round increasing as history grew. These measurements are valuable discovery evidence, but they are
not the new release baseline: they used character/token approximations and predate some shipped
mitigations. Phase 0 must rerun the corpus using provider-reported usage.
