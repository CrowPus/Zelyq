# Measurement and rollout

## Corpus

Build a fixed, versioned corpus representing Zelyq's traffic:

- short question/no tools;
- small single-file change;
- multi-file feature;
- debugging with tests/logs;
- long existing-repository session;
- Architect plan plus builders;
- connector-heavy task;
- image/design task;
- resumed session after restart;
- deliberate retry/provider failure.

Record project snapshot, prompt hash, tool catalog hash, model ID/version, provider, effort, and
cache state. Exclude secrets and mutable external data or freeze them in fixtures.

## Experimental design

Use paired A/B runs from the same snapshot. Randomize order where cache state permits. Run cold
cache and warm cache as separate experiments; never warm the candidate but not the baseline. Use at
least 30 pairs for a release claim unless a predeclared power analysis supports fewer.

Metrics:

- uncached input, cache read, cache write, output, reasoning, total processed tokens;
- calculated and provider-invoiced cost where available;
- requests, retries, continuations, tool calls, failed calls, rounds;
- time to first token and completion;
- deterministic task checks, regression tests, file-diff scope, security checks;
- blinded reviewer score for tasks that cannot be fully deterministic.

## Ablation sequence

Measure each cumulative stage:

1. current main baseline;
2. telemetry only;
3. tool gating;
4. artifact history + portable compaction;
5. provider cache controls/routing keys;
6. effort/output policies;
7. loop/early-stop improvements;
8. model routing;
9. batch/flex for eligible jobs.

Also run single-lever ablations when interactions are unclear. A cumulative test alone cannot tell
which change caused a quality failure.

## Release gates

| Gate | Requirement |
|---|---|
| accounting | provider usage reconciles with stored components; no negative/duplicated tokens |
| quality | no material regression; all critical correctness/security checks pass |
| reliability | failure/retry rate no worse than baseline beyond predeclared tolerance |
| context | no invalid tool-pair history; no context overflow in long corpus |
| cache | hit/write/miss visible; cold and warm behavior match provider contract |
| cost | improvement confidence interval and workload weighting published |
| claim | “up to 90%” only after a qualifying representative case reaches ≥90% |

Suggested initial non-inferiority thresholds: all deterministic checks equal or better; blinded
quality mean no more than 0.2 points worse on a 5-point scale; task success no more than 2
percentage points worse. These are proposed product thresholds, not sourced facts, and maintainers
must approve them before the experiment.

## Rollout

1. ship telemetry dark, verify accounting for one week or a representative request volume;
2. enable tool gating for internal sessions, then 5%, 25%, 50%, 100%;
3. enable history policy with automatic fallback to legacy replay on reconstruction error;
4. enable provider cache keys/extensions one provider at a time;
5. canary effort/output policy;
6. shadow model routing, then canary only cheap task classes;
7. publish actual fleet savings only after production weighting.

At every stage, rollback is a feature flag. Trigger rollback on quality-gate failure, context/tool
pair errors, cost increase above 5%, or retry/failure increase above the approved tolerance.

## Dashboards and alerts

Required dimensions: provider, requested/resolved model, mode, task class, cache state, tool family,
and policy version. Alert on cache-hit collapse, schema-token drift, output/reasoning spikes, retry
cost, context-budget pressure, rate-card staleness, and unknown-cost traffic.

## Stop condition for this research

The research stops at an implementation-ready design because all material provider classes have
primary evidence or an explicit capability gap, the largest repository cost drivers have direct
code/data evidence, and further web search is unlikely to change the architecture. Live API
contract tests and paired Zelyq benchmarks remain required implementation work; documentation
cannot substitute for them.
