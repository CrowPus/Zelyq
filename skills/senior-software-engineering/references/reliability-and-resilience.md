# Reliability and Resilience

## Principle

Reliability means the system performs the behavior users expect, not merely that a process is "up."

## Dependency calls

Every external call should have an explicit failure policy.

Consider:
- connection/request timeout;
- bounded retries;
- retryable status/error classes;
- exponential backoff;
- jitter;
- circuit breaking only when it solves a real cascade problem;
- concurrency limit;
- fallback/degraded behavior;
- idempotency.

Do not stack retries across multiple layers without calculating worst-case amplification and latency.

## Timeouts

No external network call should wait forever.

Timeouts should reflect:
- user request budget;
- downstream SLO;
- operation type;
- retry count.

A timeout must result in a defined state. "We don't know whether the remote side effect happened" is a real state that must be handled.

## Retries

Retry only failures likely to be transient.

Do not retry:
- validation failures;
- permission denials;
- most deterministic business errors.

For side-effecting operations, establish repeat safety first.

## Backoff and jitter

When many workers/clients can retry together, use jitter to avoid synchronized retry storms.

## Rate limiting and quotas

Protect finite resources from:
- brute force;
- accidental loops;
- abusive integrations;
- expensive endpoints;
- unbounded tenant usage.

Decide whether limits are per user, tenant, token, IP, resource, or global.

## Queues and workers

Assume messages can be:
- duplicated;
- delayed;
- out of order;
- retried;
- poison messages;
- delivered after the originating record changed.

Define:
- acknowledgement point;
- retry count/backoff;
- dead-letter/failed-job path;
- idempotency;
- ordering requirement;
- concurrency;
- visibility timeout/lease semantics;
- replay procedure.

## Graceful shutdown

Services/workers should handle termination intentionally:
- stop accepting new work;
- finish or safely return in-flight work;
- close connections;
- flush required telemetry within bounded time.

The Twelve-Factor App calls this disposability: fast startup and graceful shutdown.

## Health and readiness

Distinguish:
- process alive;
- ready to receive work;
- dependency degraded.

Do not make readiness depend on every optional downstream dependency if that causes unnecessary outage propagation.

## SLO thinking

For user-facing systems define useful indicators/objectives for behavior that matters.

Google SRE's four golden signals are:
- latency;
- traffic;
- errors;
- saturation.

Use them as a baseline, then add domain outcomes such as payment success, jobs completed, or search freshness.

## Degradation

Ask whether partial service is better than total failure.

Examples:
- cached read if safe;
- hide recommendations if recommendation provider fails;
- queue email for later;
- disable optional enrichment.

Never degrade by bypassing security/integrity checks.

## Recovery

Design for:
- restart;
- reprocessing;
- reconciliation;
- restoring data;
- rebuilding derived indexes/caches;
- replaying events safely.

## Chaos/failure testing

For high-risk systems deliberately test dependency latency/failure and operational recovery rather than assuming it.

## Sources

- Google SRE monitoring: https://sre.google/sre-book/monitoring-distributed-systems/
- Twelve-Factor App: https://12factor.net/
