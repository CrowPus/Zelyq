# Recipe: Canary Rollout

## Before deploy

Define:

```yaml
canary:
  cohort: 5%
  observation: 15m
  promote_if:
    error_rate_delta: <= 0.2%
    p95_latency_delta: <= 10%
  rollback_if:
    slo_burn: critical
```

Values are examples only.

## Stages

1. deploy canary;
2. verify startup/readiness;
3. wait for sufficient observations;
4. compare to baseline;
5. promote one stage;
6. repeat;
7. stop/rollback on threshold breach.

## Failure

A canary without predetermined health criteria is merely a small deployment.
