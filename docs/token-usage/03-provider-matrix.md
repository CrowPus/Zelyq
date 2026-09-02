# Provider capability matrix

Verified against first-party documentation available on 2026-09-01. Prices are volatile; runtime
code must use a dated rate card, and documentation links—not this table—are the update authority.

| Zelyq provider | Verified cost controls | Required Zelyq action | Important limit |
|---|---|---|---|
| Anthropic | explicit/automatic prompt caching; 5m write 1.25× and read 0.1× on current general models; batch 50% in eligible APIs | retain rolling breakpoints; add native context editing/compaction only behind capability flags; measure read/write tokens | model-specific minimums; default cache lifetime 5m; cache changes can be invalidated by tools/system/thinking settings |
| Google Gemini | implicit cache on Gemini 2.5+; explicit cached content; Batch 50%; Flex 50% for eligible traffic | keep prefix stable; evaluate explicit cache for large static project guides; add batch/flex only for offline tasks | cached content still counts toward token limits; explicit cache has storage cost and model minimums |
| OpenAI | automatic/explicit controls vary by generation; cache usage fields; Batch 50%; Flex lower-cost processing | migrate modern models to Responses adapter; send stable cache key; use compaction/tool search where model supports it | behavior differs for GPT-5.6+ vs earlier models; cache writes can cost extra; server-stored state has retention implications |
| xAI | automatic prompt caching and cached usage; Grok 4.6 cached input $0.50 vs $2/M | send stable conversation or prompt-cache key; capture correct usage field | batch availability/discount is model-specific; long-context pricing thresholds apply |
| DeepSeek | automatic prefix disk caching; V4 Flash cache hit $0.0028 vs $0.14/M, Pro $0.003625 vs $0.435/M | preserve exact prefix; parse DeepSeek-specific hit/miss fields as well as OpenAI-style fields | hits are not guaranteed; exact prefix from token 0 is required |
| Mistral | `prompt_cache_key`, 64-token cache blocks, cached input at 0.1× regular input; Batch 50% | send stable cache key; parse cached usage; verify each selected model in a live contract test | no fixed cache TTL found; do not invent one |
| Groq | automatic caching on a limited model set; cached portion 50% cheaper; Batch 50% | expose model capability, preserve prefix, parse cached tokens | Zelyq's default Llama model is not in the currently documented prompt-cache model list; batch and cache discounts do not stack |
| OpenRouter | provider prompt caching, sticky routing via `session_id`, cache accounting; optional exact response cache with free hits | send stable session ID; record actual routed provider/model; optionally use response cache only for safe idempotent calls | backing-provider rules and price apply; manual provider order overrides stickiness; response cache conflicts with account-level ZDR |
| Custom OpenAI-compatible | unknown | require configured/probed capabilities; default to token budgeting only | never assume caching, tokenizer, usage, reasoning, or pricing support |

## Primary documentation

- Anthropic: [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
  documents prefix order, four breakpoints, minimums, invalidators, 5-minute lifetime, and cache
  read/write pricing. [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) is the
  current rate authority.
- Google: [Context caching](https://ai.google.dev/gemini-api/docs/caching) documents implicit and
  explicit caching and minimums; [optimization and inference](https://ai.google.dev/gemini-api/docs/optimization)
  documents Flex and Batch positioning; [pricing](https://ai.google.dev/gemini-api/docs/pricing)
  is the current rate authority.
- OpenAI: [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) documents
  model-generation differences, routing keys, fields, retention, and prompt structure;
  [Batch](https://platform.openai.com/docs/api-reference/batch/object?api-mode=responses) documents
  a 24-hour completion window and 50% discount; [pricing](https://developers.openai.com/api/docs/pricing)
  is the current rate authority.
- xAI: [Prompt-caching usage](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing)
  documents cached fields and routing keys; [Grok 4.6](https://docs.x.ai/developers/models/grok-4.6)
  gives current input/cached/output prices.
- DeepSeek: [Models and pricing](https://api-docs.deepseek.com/quick_start/pricing) gives current V4
  hit/miss/output prices; [context-caching announcement](https://www.deepseek.com/en/news/context-caching/)
  documents automatic exact-prefix behavior and hit/miss fields. The announcement's old price is
  superseded by the pricing page.
- Mistral: [Pricing](https://docs.mistral.ai/inference/pricing) lists standard/cached prices;
  [Batch processing](https://docs.mistral.ai/studio/batch-processing) documents the 50% discount.
- Groq: [Prompt caching](https://console.groq.com/docs/prompt-caching) documents supported models,
  automatic exact-prefix caching, usage fields, two-hour expiry, and 50% cached-token discount;
  [Batch](https://console.groq.com/docs/batch) documents its 50% discount and non-stacking rule.
- OpenRouter: [Prompt caching and sticky routing](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
  documents `session_id` and cache accounting; [response caching](https://openrouter.ai/docs/guides/features/response-caching)
  documents zero-billed exact hits and safety/retention limits.

## Adapter policy

Provider capabilities belong in data, not scattered conditionals. Each model capability record
should state: API dialect/version, input window, safe output maximum, tokenizer/count endpoint,
cache mode/minimum/TTL/key/usage mapping, compaction/state support, batch/flex support, reasoning
control, price-card key, and evidence date. Unknown means disabled, never guessed.
