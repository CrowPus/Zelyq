# Cost model and the 90% claim

> **Amended 2026-09-02** — see [`07-review-and-amendments.md`](./07-review-and-amendments.md).
> The scenario table's output-reduction column assumes output is 15–20% of cost. Measured on 199
> real Zelyq turns it is 0.8% of processed tokens (~4% of spend at a 5× output multiplier). Redo
> the table with an input share of ~96% before it is used to justify any target.

## Per-request model

For request `i`:

```text
Ci = Ui·Pui + Ri·Pri + Wi·Pwi + Oi·Poi + Fi
Ti = Ui + Ri + Wi + Oi
```

`U` is uncached input, `R` cache-read input, `W` cache-write input, `O` billable output (including
reasoning when billed as output), and `F` fixed tool/search fees. Do not double count: some APIs'
headline prompt total includes cached tokens while others report uncached input separately.

Session totals include every iteration, retry, continuation, and child:

```text
Csession = sum(Ci)
Tsession = sum(Ti)
cost_reduction = 1 - Ccandidate / Cbaseline
token_reduction = 1 - Tcandidate / Tbaseline
cache_hit_rate = sum(Ri) / sum(Ui + Ri + Wi)
```

## Break-even for paid cache writes

For a stable prefix of `S` tokens, cache-write multiplier `w`, read multiplier `r`, and `n`
subsequent reads:

```text
uncached cost units = (n + 1)·S
cached cost units   = w·S + n·r·S
cache wins when n > (w - 1) / (1 - r)
```

At Anthropic's common 5-minute `w=1.25`, `r=0.1`, one later read is already cheaper overall:
`1.25 + 0.1 = 1.35` versus `2.0`. This ignores TTL expiry and minimum-prefix rules, which the
runtime must check.

## Scenarios, not forecasts

| Scenario | Input share | Cache hit | Cache read rate | Output reduction | Result before routing |
|---|---:|---:|---:|---:|---:|
| short/novel | 50% | 0% | — | 20% | 10% cost reduction |
| repeated moderate | 70% | 80% | 0.5× | 25% | 35.5% cost reduction |
| long agent | 85% | 95% | 0.1× | 35% | 77.9% cost reduction |
| cache + 70% actual input trim | 85% | 95% of remaining | 0.1× | 35% | 86.6% cost reduction |

The last scenario still does not reach 90% without cheaper routing, fewer rounds, a deeper cache
discount, or greater output reduction. This is why no single optimization supports the claim.

## Qualification rules

Use three separate labels:

- **Observed cost reduction:** paired invoice-equivalent calculation using provider-reported usage
  and a versioned official rate card.
- **Observed token reduction:** paired actual processed tokens; cached tokens remain included.
- **Projected reduction:** scenario calculation with every assumption shown.

Never average percentages across requests. Sum baseline and candidate cost first, then calculate
the ratio. Report p50/p95 session cost, quality, latency, retry rate, and cache-cold/warm results.

## Example provider cache ceilings

If an entire input were a cache read and output/fixed costs were zero, a 0.1× cached-input price
has a theoretical 90% input-cost reduction, 0.25× has 75%, and 0.5× has 50%. Real total savings
are lower because prefixes are not fully cached and outputs remain full price. DeepSeek's current
V4 Flash price ratio is `0.0028 / 0.14 = 0.02` (98% lower for hit tokens) and V4 Pro is about
`0.003625 / 0.435 = 0.00833` (about 99.17% lower for hit tokens), but neither ratio guarantees
that a request hits the cache or that total request cost falls by that amount.
