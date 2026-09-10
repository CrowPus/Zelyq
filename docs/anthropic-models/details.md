# Claude (Anthropic) model integration — spec

Research for the Anthropic equivalent of the OpenAI model work. Catalog facts
are from the Anthropic model reference cached 2026-06-24; anything marked
**verify** must be confirmed against the live Models API before shipping.

## What the Zelyq selector should look like

```
Claude

Auto                    Recommended
Claude Fable 5.1        Best
Claude Opus 5           Advanced · agentic coding
Claude Sonnet 5         Balanced
Claude Haiku 4.5        Fast

More models >
Claude Fable 5
Claude Opus 4.8
Claude Opus 4.7
Claude Opus 4.6
Claude Sonnet 4.6
Legacy models...
```

## The routing I would use

| User action | Zelyq should choose |
| --- | --- |
| Rename variable, explain code, tiny edit | `claude-haiku-4-5` |
| Build a normal React/API feature | `claude-sonnet-5` |
| Debug a difficult bug | `claude-opus-5` |
| Architecture / refactor a large repo | `claude-opus-5` |
| Autonomous multi-file implementation | `claude-opus-5` |
| Run → inspect → edit → test → repair loop | `claude-opus-5` |
| Extremely difficult engineering task | `claude-fable-5-1` |
| Deep code / security / architecture review | `claude-fable-5-1` |
| Creative or character writing | `claude-fable-5` |

Anthropic has no coding-specialised model the way `gpt-5.3-codex` is; Opus 5 is
the agentic-coding rung and Fable 5.1 is the capability ceiling above it.

## What I recommend Zelyq expose

| Zelyq label | API model ID | Role | Context | Input / Output per 1M |
| --- | --- | --- | ---: | ---: |
| **Claude Opus 5** | `claude-opus-5` | ⭐ Default — agentic coding | 1M | $5 / $25 |
| **Claude Fable 5.1** | `claude-fable-5-1` | Most capable / hardest work | 1M | $10 / $50 |
| **Claude Sonnet 5** | `claude-sonnet-5` | Balanced | 1M | $2 / $10 |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | Fast / inexpensive | 200K | $1 / $5 |
| Claude Fable 5 | `claude-fable-5` | Creative / character writing | 1M | $10 / $50 |
| Claude Opus 4.8 | `claude-opus-4-8` | Previous top-end | 1M | $5 / $25 |
| Claude Opus 4.7 | `claude-opus-4-7` | Previous | 1M | $5 / $25 |
| Claude Opus 4.6 | `claude-opus-4-6` | Previous | 1M | $5 / $25 |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Previous balanced | 1M | $3 / $15 |

Cached input reads bill at ~0.1x input and the one-time cache write at ~1.25x,
which is what `cacheReadFactor` / `cacheCreationFactor` already encode in the
eval rate table. Fable 5.1 prices cache reads at a flat $0.25/MTok — **verify**
whether Zelyq's factor model can express that before relying on it.

Two deliberate exclusions:

- `claude-mythos-5-1` is Project Glasswing only. It must not appear in a
  general catalog; an account without the programme cannot call it.
- Legacy IDs (Sonnet 4.5, Opus 4.5, 3.x …) are **not** listed here because I
  will not guess their exact strings. Look each one up before adding it —
  Claude IDs take no date suffix, and a fabricated ID is a silent 404.

## Detect which models the key can actually reach

Same shape as the OpenAI work, but Anthropic's list endpoint is richer:
`GET /v1/models` (`client.models.list()`, auto-paginating) returns `id`,
`display_name`, `created_at`, and — since March 2026 — `max_input_tokens`,
`max_tokens` and `capabilities`. There is no `context_window` field.

That means discovery can verify context window and capability rather than only
intersecting IDs, so the catalog's own numbers can be treated as a fallback for
display and the live values preferred when present.

Everything else carries over from `openai-models.ts` unchanged: intersect with
the curated catalog, cache per credential + endpoint for 60s, keep a successful
empty result empty, and fall back to the full catalog with an explicit
unverified notice when the call fails — a restricted key may generate without
permission to list.

## The adapter constraint that actually matters

`apps/agent/src/providers/anthropic.ts:327` sends the same request shape to
every Claude model:

```ts
thinking: { type: "adaptive", display: "summarized" },
output_config: { effort: this.options.effort },
```

That is correct for the 5-series and wrong for two models Zelyq already offers:

| Model | Effort levels accepted | Thinking config |
| --- | --- | --- |
| `claude-fable-5-1`, `claude-fable-5` | low, medium, high, xhigh, max | Always on; omit or `adaptive`. `disabled` and `budget_tokens` → 400 |
| `claude-opus-5` | low, medium, high, xhigh, max | Adaptive by default; `disabled` only at ≤ high |
| `claude-opus-4-8`, `claude-opus-4-7` | low, medium, high, xhigh, max | `adaptive` is the only on-mode |
| `claude-sonnet-5` | low, medium, high, xhigh, max | `adaptive` is the only on-mode |
| `claude-opus-4-6`, `claude-sonnet-4-6` | low, medium, high, max — **no `xhigh`** | `adaptive`; `budget_tokens` deprecated |
| `claude-haiku-4-5` | **none — `effort` returns an error** | `{type: "enabled", budget_tokens: N}`, N ≥ 1024 and < `max_tokens` |

So, with Zelyq's effort schema being `low | medium | high | xhigh | max`:

1. **Selecting Claude Haiku 4.5 sends `output_config.effort` to a model that
   rejects it.** Haiku is listed in `PROVIDERS.anthropic` today.
2. **`xhigh` against Opus 4.6 or Sonnet 4.6 is not a valid level.** Sonnet 4.6
   is listed today.

Both are the same defect class the OpenAI catalog fixed with
`openAIReasoningEffort()` — clamp the requested effort to what the chosen model
supports, and send no effort parameter at all when the model supports none.
An `anthropicThinkingConfig(model, effort)` helper should return the whole
`thinking` + `output_config` pair so the Haiku `budget_tokens` shape and the
adaptive shape are decided in one place rather than at the call site.

**Verify before shipping:** Haiku 4.5's `max_tokens` ceiling is not in the
cached reference — read it from the Models API rather than assuming 128K, which
is the 5-series/4.6-family figure, not necessarily Haiku's.

## Other model-gated behaviour worth encoding

These do not block a first version but will bite the agent loop later:

- **Forced tool use is gone on Fable 5.1.** `tool_choice: {type: "any"}` and
  `{type: "tool", name}` return 400. Any Zelyq path that forces a tool call must
  fall back to `auto` plus an instruction, or `strict: true`, on that model.
- **Thinking blocks are model-bound.** Echo them back unchanged on the same
  model; other models drop them. Switching model mid-session must not replay
  another model's thinking blocks.
- **`stop_reason: "refusal"`** arrives as HTTP 200 with `stop_details`. Check
  `stop_reason` before reading `content`, exactly as the OpenAI adapter checks
  for refusals.
- **Subscription auth already exists** for Claude via the Claude Code session
  (`readClaudeCodeSession`), mirroring the ChatGPT subscription path. Its model
  candidates are a different, unconfirmed set from the API's — keep them
  labelled and separate, as `CODEX_MODEL_CANDIDATES` is for OpenAI.

## Official references

- [Models overview](https://docs.claude.com/en/docs/about-claude/models/overview)
- [Models API](https://docs.claude.com/en/api/models-list)
- [Extended thinking](https://docs.claude.com/en/docs/build-with-claude/extended-thinking)
- [Pricing](https://claude.com/pricing#api)


## What shipped, and what changed from this spec

Implemented 2026-09-10 in `packages/core/src/anthropic-models.ts`.

Three corrections to the plan above, all found while building it:

1. **The default stays `claude-opus-5`, not Sonnet 5.** This spec proposed
   Sonnet as the balanced default to mirror the OpenAI catalog's Terra. That
   would have silently downgraded every existing instance, which is the
   operator's decision, not the catalog's. Auto prefers Opus 5 too.
2. **Discovery has to match dated aliases.** `/v1/models` on a live account
   returns Haiku 4.5 *only* as `claude-haiku-4-5-20251001`. Exact-matching the
   bare ID dropped it from the verified list on the very account it was tested
   against. The catalog now carries `aliases` and offers the bare, documented
   ID regardless of which form was listed.
3. **Listing genuinely is independent of quota.** The test account lists all
   nine models and returns HTTP 200 from `/v1/models` while having no credit at
   all — a generation on it fails with a billing error. This is exactly why a
   failed lookup falls back to the full catalog with an unverified notice
   rather than hiding models.

Not done, deliberately: `claude-opus-4-5-20251101` and
`claude-sonnet-4-5-20250929` are listed by that account but are **not** in the
catalog. Their exact IDs are now known, but their effort support and pricing
are not confirmed — and guessing those is what produced the Haiku bug in the
first place. Add them once verified.

Still unverified: the request shapes could not be exercised live, because the
test key has no credit and billing is checked before parameter validation. The
shapes are covered by unit tests against the documented contract, not by a
successful API call.
