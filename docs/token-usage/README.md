# Zelyq token-usage program

Status: implementation design, first pass 2026-09-01, second-pass review 2026-09-02.

> **Read [`07-review-and-amendments.md`](./07-review-and-amendments.md) alongside `01`–`06`.** The
> second pass re-measured the evidence and amends it: the static-floor figures in `01` were taken
> from a stale build and are understated by 30–57%, Zelyq's stored token counters are quadratically
> inflated and cannot be used as a baseline, and the measured workload is 95% Gemini with output at
> 0.8% of processed tokens — which reorders the reduction stack. The architecture and the “up to
> 90%” discipline are unchanged.

This folder is the decision package for reducing Zelyq agent token volume and inference cost. The
headline target is **up to 90% lower cost for eligible workloads**, with no universal guarantee.
The target must be proven per provider, model, mode, and workload by the benchmark gate in
[`06-measurement-and-rollout.md`](./06-measurement-and-rollout.md).

Read in this order:

1. [`report-source.md`](./report-source.md) — canonical executive report and direct answer.
2. [`01-current-state-findings.md`](./01-current-state-findings.md) — repository evidence and gaps.
3. [`02-reduction-strategy.md`](./02-reduction-strategy.md) — the reduction stack and its math.
4. [`03-provider-matrix.md`](./03-provider-matrix.md) — provider-specific capabilities and limits.
5. [`04-implementation-design.md`](./04-implementation-design.md) — code-level implementation path.
6. [`05-cost-model.md`](./05-cost-model.md) — reproducible formulas and 90% qualification rule.
7. [`06-measurement-and-rollout.md`](./06-measurement-and-rollout.md) — experiments, gates, rollback.
8. [`claim-to-source-ledger.md`](./claim-to-source-ledger.md) — provenance and unresolved gaps.
9. [`07-review-and-amendments.md`](./07-review-and-amendments.md) — second-pass review: corrected
   measurements, four new findings, and the amended priority order.
10. [`08-status-after-pr-128.md`](./08-status-after-pr-128.md) — **start here.** What the
    maintenance branch (PR #128) already shipped from this program, and the verified, ordered list
    of what is left, with file:line pointers and fix sketches for the next agent.

Reproducible measurements live in [`measure/`](./measure/):

```sh
pnpm --filter @zelyq/tools build && pnpm --filter @zelyq/agent build
node docs/token-usage/measure/static-floor.mjs   # system prompt + tool JSON floor, by mode
node docs/token-usage/measure/true-usage.mjs     # real per-turn usage from data/zelyq.db
```

Terminology is strict throughout:

- **Token-volume reduction** means fewer input, output, or reasoning tokens processed.
- **Cache savings** means repeated input tokens are billed at a lower rate; cached tokens still
  occupy context and must be reported.
- **Cost reduction** includes caching, model routing, batch/flex service tiers, and token-volume
  reduction.
- **Up to 90%** is a ceiling demonstrated by a qualifying workload, not an expected average.

No production claim should use “90%” until the controlled benchmark and shadow-production gates
pass with quality non-inferiority.
