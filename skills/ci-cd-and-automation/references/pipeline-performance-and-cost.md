# Pipeline Performance and Cost

## Optimize feedback, not vanity

Useful metrics:
- time to first failure;
- critical-path duration;
- p50/p95 PR feedback;
- queue time;
- flaky retry rate;
- compute minutes/cost;
- cache hit rate.

No universal ten-minute limit applies to every project.

## Parallelism

Run independent work in parallel:
- lint;
- types;
- unit tests;
- dependency review.

Do not duplicate expensive build work unnecessarily.

## Caching

Cache:
- dependency download stores;
- compiler/build caches;
- test caches

when safe and beneficial.

Do not cache secrets.

Understand whether untrusted jobs can poison data later consumed by privileged jobs.

## Change-aware CI

In monorepos:
- use dependency graph/affected project calculation;
- ensure shared library changes trigger dependents;
- use path filters only when dependency relationships are simple and correct.

## Cancel superseded work

For PR validation, cancel old runs when a newer commit makes the result obsolete.

Do not blindly cancel production release state transitions that must be serialized/completed.

## Sharding

Shard slow test suites only after:
- eliminating pathological slow tests;
- ensuring shards are deterministic;
- preserving reports.

## Runners

Scale runner size when it improves critical path economically.

Self-hosted runners introduce security and maintenance cost; performance alone is not sufficient reason.

## Reusable workflows

Centralize repeated policy into reusable workflows when multiple repositories need consistent behavior.

Do not create ten layers of indirection that make a pipeline impossible to debug.

## Scheduled work

Move appropriate non-blocking checks to scheduled pipelines:
- deep scans;
- exhaustive compatibility;
- long benchmarks.

But do not remove a critical release gate merely because it is slow—fix or redesign it.
