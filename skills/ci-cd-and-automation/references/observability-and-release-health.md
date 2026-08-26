# Observability and Release Health

## Principle

A deployment is incomplete until its effect is observed.

## Release markers

Record deployment identity in observability:
- version;
- commit;
- environment;
- timestamp;
- rollout stage.

This makes regressions correlatable to releases.

## Health signals

Choose symptoms relevant to users:
- request success/error rate;
- latency;
- crash rate;
- job success;
- queue delay;
- checkout/payment success;
- SLO burn;
- saturation/resource exhaustion.

Internal metrics can explain failures but should not be the only promotion criteria.

## Canary evaluation

Compare canary against:
- previous version;
- control cohort;
- historical baseline

while accounting for traffic differences.

Define:
- minimum sample/time;
- allowed regression;
- automatic halt conditions.

## Smoke tests

Post-deploy smoke tests should verify a few high-value capabilities:
- service responds;
- critical dependency reachable;
- one safe business path works.

Do not make smoke tests mutate dangerous production state without isolation/cleanup.

## Logs/traces

CI/CD should surface:
- deployment event;
- failed step;
- environment;
- artifact digest.

Distributed systems benefit from trace correlation for release-caused failures.

## Alerts

Do not create alerts solely because a deployment occurred.

Alert on meaningful degradation. Deployment events should enrich the context.

## Rollout decision

If health is outside predefined tolerance:
1. halt;
2. rollback if safe;
3. verify recovery;
4. investigate.

Avoid expanding rollout because "it might recover."
