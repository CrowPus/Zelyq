# Claim-to-source ledger

Access date for web sources: 2026-09-01. Repository sources are the current workspace unless a
historical measurement is explicitly identified.

| Claim | Source and date | Confidence / access note |
|---|---|---|
| Zelyq supports nine provider IDs and most use the OpenAI dialect | `apps/agent/src/providers/index.ts`, current checkout | high, direct code |
| default turn ceiling is 50 iterations | `apps/agent/src/config.ts`, current checkout | high, direct code |
| Anthropic adapter uses system + last-two-message breakpoints | `apps/agent/src/providers/anthropic.ts`, current checkout | high, direct code |
| cached usage is mapped for Anthropic, Google, OpenAI dialect | provider adapters and `providers/types.ts`, current checkout | high, direct code |
| persisted heavy write/edit bodies are stripped | `apps/server/src/ws/gateway.ts`, `packages/core/src/models.ts` | high, direct code |
| prior audit found 68.5% tool bytes in write/edit inputs and ~291k-token largest session | `docs/maintainance/00-findings.md`, measurement dated 2026-08-31 | medium-high; token total partly estimated at 3.7 chars/token and predates current changes |
| prior loaded tool surface was 92 tools/~9,645 schema tokens | `docs/maintainance/00-findings.md` and `02-tool-surface.md`, 2026-08-31 | medium-high; rerun exact tokenizer baseline |
| current prompt/tool proxy sizes: base 1,718+2,262, Engineer 3,392, Architect 11,084+4,399 tokens | compiled `buildSystemPrompt()` / `toolDefinitions()`, chars/4 audit on 2026-09-01 | high for bytes, medium for token proxy; replace with provider count |
| live tool outputs can reach ~60k read/~30k shell chars and bypass the persisted 4k cap | `packages/tools/src/files.ts`, `shell.ts`, `types.ts`; `apps/agent/src/session.ts` | high, direct code |
| gateway/database persist only input/output totals, not cache categories or request attempts | `apps/server/src/ws/gateway.ts`; DB schemas/repositories | high, direct code |
| Anthropic cache hierarchy, breakpoint count, pricing, minimums, TTL, invalidators | [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), accessed 2026-09-01 | high, official; model-specific and mutable |
| Gemini implicit/explicit caching and minimums | [Google context caching](https://ai.google.dev/gemini-api/docs/caching), updated 2026-08-13 | high, official |
| Gemini Batch/Flex are 50% lower for eligible workloads | [Google optimization](https://ai.google.dev/gemini-api/docs/optimization), updated 2026-04-28 | high, official; availability/model constraints apply |
| OpenAI caching differs by model generation; GPT-5.6+ read 0.1×/write 1.25× and uses cache keys | [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), accessed 2026-09-01 | high, official; use model table rather than generalizing |
| OpenAI Batch is 50% discounted with 24h window | [OpenAI Batch reference](https://platform.openai.com/docs/api-reference/batch/object?api-mode=responses), accessed 2026-09-01 | high, official |
| Grok 4.6 is $2 input/$0.50 cached/$6 output per MTok below stated long-context threshold | [xAI Grok 4.6](https://docs.x.ai/developers/models/grok-4.6), accessed 2026-09-01 | high, official; rates mutable |
| xAI exposes cached-token fields and recommends conversation/cache keys | [xAI prompt caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing), updated 2026-05-10 | high, official |
| DeepSeek V4 hit/miss prices and models | [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing), accessed 2026-09-01 | high, official, current authority |
| DeepSeek caching is automatic and exact-prefix, with hit/miss usage fields | [DeepSeek context caching](https://www.deepseek.com/en/news/context-caching/), 2024-08-02 | medium-high; official behavior, but price on article is superseded |
| current Mistral standard cached input is 0.1× for listed flagship models | [Mistral pricing](https://docs.mistral.ai/inference/pricing), accessed 2026-09-01 | high for prices; live usage-field semantics still need contract test |
| Mistral Batch gives 50% discount | [Mistral Batch](https://docs.mistral.ai/studio/batch-processing), accessed 2026-09-01 | high, official |
| Groq cache discount is 50%, automatic, two-hour expiry, limited models | [Groq prompt caching](https://console.groq.com/docs/prompt-caching), accessed 2026-09-01 | high, official; supported list can change |
| Groq Batch is 50% and does not stack with cache discount | [Groq Batch](https://console.groq.com/docs/batch), accessed 2026-09-01 | high, official |
| OpenRouter `session_id` enables sticky provider routing and reports cache usage | [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching), accessed 2026-09-01 | high, first-party aggregator docs |
| OpenRouter exact response-cache hits have zero billable usage | [OpenRouter response caching](https://openrouter.ai/docs/guides/features/response-caching), accessed 2026-09-01 | high, beta; retention/idempotency limits apply |
| Stored token counters are cumulative running totals, not per-turn deltas | `apps/agent/src/session.ts`, `apps/server/src/ws/gateway.ts`, `packages/db/src/repositories/sessions.ts`; measured against `data/zelyq.db` on 2026-09-02 | high, direct code plus historical reconstruction in `docs/token-usage/measure/true-usage.mjs` |
| Real post-rebuild static prefix floor is ~24.4k for Architect production-shape prefixes | `session.ts` and the rebuilt prompt/tool measurement run dated 2026-09-02 | high for code path; medium for the chars/4 proxy used before exact provider counting |
| Zelyq's measured workload is ~95% Gemini and output is ~0.8% of processed tokens | `docs/token-usage/measure/true-usage.mjs` reconstruction from `data/zelyq.db`, 2026-09-02 | high, measured against the historical corpus; the prior 85%/15% assumption is superseded |

## Implementation status and amended priority

| Phase | Status | Evidence | Remaining work |
|---|---|---|---|
| P0 — fix usage accounting | not shipped | direct code proof that the stored counter is cumulative and inflated; historical reconstruction exists but not yet in production | emit `deltaIn` / `deltaOut` from `session.ts`, persist deltas through the gateway, add repository test |
| P1 — static floor and prompt/tool audit | measured and corrected | rebuilt system prompt + tool JSON numbers show 24.4k Architect floor and 30–57% higher prompt totals than the stale dist baseline | keep `static-floor.mjs` reproducible in CI and replace chars/4 proxy with provider token counts |
| P2 — cache the static prefix once per session | design | measured workload is 95% Gemini, and Google is not using explicit `cachedContent` today | create explicit Gemini `cachedContent` at session start, record cache lifecycle, add hit/miss telemetry |
| P3 — history compaction for live conversation | design | live tool inputs/results are the expensive path; persisted history is already stripped | batch rewrite in-memory tool-use bodies to artifact handles and bounded excerpts, not per round |
| P4 — model routing, safety caps, and batch/flex | design | provider matrix and cost model are valid, but output is a safety lever, not the primary savings lever | re-weight corpus to tail-heavy load and gate 90% claims only after benchmark + shadow-production verification |

## Open evidence gaps that implementation must close

- Run live contract tests for every currently selectable model: usage shape, cache behavior,
  reasoning control, output cap, tool calls, and token-count accuracy.
- Confirm Mistral's cache activation/routing semantics, not only the published price column.
- Determine whether each custom endpoint supports caching through explicit operator configuration;
  no universal claim is possible.
- Replace the stale static-floor baseline with the rebuilt production-shape numbers and keep the
  measurement reproducible in CI.
- Reconcile calculated costs against provider billing exports before public reporting.
- Produce a production-safe counter migration plan that excludes pre-migration rows from any
  baseline and captures cache read/create usage fields explicitly.
