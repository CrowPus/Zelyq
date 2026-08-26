# Recipe: Race Condition Review

## Find read-check-write sequences

Example:
1. read balance;
2. if sufficient;
3. debit.

Ask what happens if two operations run between steps 1 and 3.

## Determine concurrency boundary

- one process?
- multiple instances?
- queue consumers?
- database?
- external provider?

## Choose durable control

Depending on architecture:
- transaction isolation;
- atomic conditional update;
- unique constraint;
- idempotency key;
- version/compare-and-swap;
- row lock.

## Test

Run a bounded number of concurrent test operations against isolated test data.

Assert the invariant, not timing.

A reliable regression test should fail on the vulnerable implementation even if thread scheduling varies.
