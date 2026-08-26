# Performance and Capacity

## Principle

Performance requirements are product requirements. Optimize based on user impact and evidence, not aesthetic micro-optimization.

## Establish the budget

Consider:
- expected request rate/concurrency;
- dataset size and growth;
- payload size;
- interactive latency target;
- background throughput;
- memory/CPU limits;
- browser/device targets;
- cost constraints.

Do not assume development-scale data resembles production.

## Web performance

Current commonly used "good" Core Web Vitals thresholds are:
- LCP ≤ 2.5 s;
- INP ≤ 200 ms;
- CLS ≤ 0.1.

Use these as user-experience signals, not the only definition of performance.

Also inspect:
- JS/bundle cost;
- image/font loading;
- caching;
- server response time;
- main-thread work;
- third-party scripts.

## Database performance

Before optimizing queries:
- examine actual query plan;
- measure representative data volume;
- check cardinality/selectivity;
- watch N+1 patterns;
- bound pagination/results;
- avoid loading unused columns/relations.

### Indexes

An index is a tradeoff:
- improves some reads;
- increases storage;
- adds write/update cost;
- can increase maintenance/locking complexity.

Add indexes for measured or clearly understood query patterns, not every column.

## Caching

Cache when stale data is acceptable and invalidation semantics are understood.

Define:
- source of truth;
- TTL;
- invalidation;
- key cardinality;
- cache stampede behavior;
- cache failure behavior;
- authorization sensitivity.

## Payloads

Bound:
- request body;
- upload size;
- API page size;
- export size;
- websocket/message size;
- queue event size.

Compress appropriately, but consider CPU/latency tradeoff.

## Algorithms

Check complexity when inputs can grow.

A nested loop over 20 items is fine; the same logic over 5 million records may be a production incident.

## Background work

Do not block synchronous user requests on work that can safely happen asynchronously, but do not move work to a queue without defining reliability/idempotency/observability.

## Capacity failure

Ask what happens at saturation:
- queue grows without bound?
- connection pool starves?
- API cascades timeouts?
- database disk fills?
- worker memory grows?

Use bounded concurrency, backpressure, quotas, or load shedding where appropriate.

## Performance testing

Use realistic:
- data volume;
- payloads;
- concurrency;
- cold/warm caches;
- dependency latency.

Measure tail latency, not only averages.

## Regression

For performance-sensitive features, preserve a benchmark, load test, query-plan assertion, bundle budget, or monitoring signal that can detect meaningful regression.

## Source

- Core Web Vitals: https://web.dev/articles/defining-core-web-vitals-thresholds
