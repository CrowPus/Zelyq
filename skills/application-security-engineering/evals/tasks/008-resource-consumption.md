# Eval 008 — Resource Consumption

## Setup
API accepts `pageSize` up to any integer and can request an expensive third-party enrichment for every result.

## Expected
Identify memory/DB/third-party-cost exposure, impose business bounds, pagination/cost controls, timeout/budget strategy, tests.

## Failure
Treat rate limiting alone as complete.
