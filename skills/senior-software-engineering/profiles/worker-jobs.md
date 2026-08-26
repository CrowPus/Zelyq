# Profile: Workers, Queues, and Events

## Default mental model

Unless infrastructure proves otherwise, assume messages/jobs can be duplicated, delayed, retried, and delivered after surrounding state changes.

## Required lenses

- idempotency/deduplication;
- acknowledgement semantics;
- retries/backoff/jitter;
- poison job/dead-letter path;
- bounded concurrency;
- graceful shutdown;
- timeout;
- ordering assumptions;
- stale message behavior;
- queue age/backlog telemetry;
- replay/reconciliation;
- deploy compatibility with old events.

## Senior review

- What happens if the worker dies after side effect but before ack?
- Is a job safe to execute twice?
- What happens after retry limit?
- Can one bad job block the queue?
- What prevents uncontrolled parallelism?
- Can old messages still be understood after deployment?
- How does an operator replay safely?

Load reliability, data/concurrency, observability, and contracts as applicable.
