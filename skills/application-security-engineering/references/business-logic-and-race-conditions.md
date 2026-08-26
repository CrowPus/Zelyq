# Business Logic and Race Conditions

## Why scanners miss them

Business logic vulnerabilities often use syntactically valid requests in invalid sequences.

Start from invariants.

Examples:
- one coupon per customer;
- stock cannot become negative;
- payment settles once;
- refund cannot exceed captured amount;
- invite cannot grant a role higher than inviter may grant;
- approval requires distinct actor;
- credits cannot be minted by retry.

## Abuse dimensions

Try reasoning across:
- order;
- repetition;
- omission;
- stale state;
- negative/zero/huge values;
- cross-account substitution;
- partial completion;
- concurrent execution;
- cancellation;
- retry.

## Race conditions

Check read-modify-write sequences:
1. read current state;
2. validate;
3. modify.

Two callers may both pass validation before either commit.

Use durable mechanisms where appropriate:
- database constraints;
- atomic update;
- transaction isolation;
- row/version locks;
- idempotency key;
- compare-and-swap;
- deduplication table.

In-memory process locks are often insufficient in distributed systems.

## Idempotency

For retryable state-changing APIs:
- define operation identity;
- bind key to caller/request semantics;
- store result;
- define expiry;
- reject unsafe key reuse with different payload.

## Queues/jobs

Assume at-least-once delivery unless infrastructure guarantees otherwise.

Consumers should tolerate duplicate delivery for business-critical side effects.

## Validation

Concurrency tests should use test data and bounded parallelism.

Prove the invariant violation; do not generate uncontrolled load.
