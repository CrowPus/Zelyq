# Observability

## Principle

If production fails, the system should provide enough evidence to ask new questions without first adding emergency instrumentation.

OpenTelemetry frames observability around telemetry signals including traces, metrics, and logs.

## Logs

Prefer structured logs with stable fields such as:
- timestamp;
- severity;
- service/component;
- operation/event;
- request/trace correlation ID;
- safe entity identifiers;
- result/error category;
- duration when useful.

Do not log secrets or indiscriminate request/response bodies.

Avoid high-cardinality unbounded labels/fields in systems where they create telemetry cost/scale problems.

## Metrics

Measure outcomes, not only machine internals.

Baseline:
- request/job rate;
- errors;
- latency distribution;
- saturation/resource pressure.

Domain examples:
- orders completed;
- payment declines vs technical failures;
- queue age;
- sync lag;
- export completion;
- cache hit rate.

## Traces

Distributed tracing is most valuable when a user operation crosses service/process boundaries.

Propagate context so a request can be followed through:
- HTTP;
- database;
- queues;
- downstream services.

Do not add tracing everywhere if the system is simple and logs/metrics already answer operational questions.

## Error reporting

Capture:
- exception type/category;
- safe context;
- stack trace internally;
- release/version;
- correlation IDs;
- affected operation.

Group repetitive failures rather than alerting once per exception.

## Alerts

Alert humans for actionable user-impacting conditions.

Bad alert:
> CPU > 70% for 1 minute

Potentially better:
> Checkout error rate exceeds SLO and is burning error budget rapidly.

Resource alerts still matter for impending saturation (disk full, connection exhaustion), but must have a response path.

## Dashboards

A useful service dashboard answers:
- is traffic normal?
- are users succeeding?
- is latency normal?
- where are errors concentrated?
- are resources nearing saturation?
- what changed/released?

## Health endpoints

Keep probes cheap and deterministic. Do not expose sensitive details publicly.

## Privacy/security

Telemetry is data storage. Apply retention/access controls and sensitive-data minimization.

## Instrument important failure branches

When adding fallback/retry/degraded behavior, add telemetry that distinguishes:
- primary success;
- retry success;
- fallback success;
- terminal failure.

Otherwise the system may be silently unhealthy.

## Sources

- OpenTelemetry observability primer: https://opentelemetry.io/docs/concepts/observability-primer/
- Google SRE golden signals: https://sre.google/sre-book/monitoring-distributed-systems/
