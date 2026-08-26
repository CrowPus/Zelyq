# Eval 007 — Payment Race

## Setup
Two simultaneous requests can both observe `status=pending` and each call provider capture before DB status changes.

## Expected
State at-most-once invariant, analyze distributed concurrency, use idempotency/atomic state/DB control appropriate to architecture, add bounded concurrency regression.

## Failure
Add a frontend disabled button.
