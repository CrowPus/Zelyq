# Data, Concurrency, and Migrations

## Principle

Data correctness must survive concurrency, retries, deployment overlap, failure, and time.

## Model ownership and constraints

Use the database to enforce structural invariants when appropriate:
- primary keys;
- foreign keys;
- unique constraints;
- non-null constraints;
- check constraints;
- transaction boundaries.

Application checks alone are race-prone for many invariants.

## Transactions

Define which state changes must commit atomically.

Do not keep transactions open across slow external network calls unless the architecture explicitly requires and supports it.

When one transaction cannot span all systems, design compensation/reconciliation rather than pretending distributed side effects are atomic.

## Isolation and concurrency

Understand the actual database isolation semantics.

For example, PostgreSQL documents that stronger isolation levels can produce serialization failures and applications must be prepared to retry the entire transaction.

Choose among patterns such as:
- atomic update;
- unique constraint;
- compare-and-swap/version column;
- row locking;
- serializable transaction;
- advisory/distributed lock only when justified.

Do not use locks without defining timeout/deadlock/recovery behavior.

## Lost updates

Dangerous pattern:

`read balance → compute new balance → write balance`

Two requests can race.

Prefer atomic database operations or explicit concurrency control where correctness matters.

## Idempotent side effects

For jobs, webhooks, payments, imports, and provisioning:
- define stable operation/event ID;
- store processed/dedup state where needed;
- make side effects repeat-safe;
- distinguish retryable from terminal errors.

## Money

Do not use binary floating-point for monetary values unless the domain and representation explicitly justify it.

Prefer integer minor units or a decimal type with explicit currency/rounding rules.

Define:
- currency;
- precision;
- rounding mode;
- tax/discount order;
- exchange-rate timestamp/source when relevant.

## Time

Define whether a field means:
- instant;
- local date;
- local wall-clock time;
- duration;
- recurrence.

Do not convert all domain time concepts into UTC timestamps blindly. Birthdays and local recurring schedules are not instants.

## Schema migration: expand → migrate → contract

For zero/low-downtime systems prefer compatibility across overlapping app versions.

Typical pattern:
1. **expand** — add backward-compatible schema;
2. deploy code that can work with old/new representation;
3. backfill/migrate data safely;
4. verify;
5. switch reads/writes;
6. **contract** — remove obsolete schema later.

Avoid rename/drop/type-change operations that require every process to update simultaneously.

## Backfills

Large backfills need:
- batching;
- rate limiting;
- resume/checkpoint;
- idempotency;
- progress metrics;
- production load awareness;
- verification query;
- failure recovery.

Do not run an unbounded full-table application loop as a migration without considering locks, WAL/replication, and production load.

## Migration rollback

Code rollback and data rollback are different.

Before destructive changes define:
- backup/recovery point;
- whether down migration is safe;
- whether rollback would discard newly written data;
- fix-forward alternative.

## Deletes

Clarify:
- hard vs soft delete;
- cascading behavior;
- audit/legal retention needs;
- related files/search indexes/caches;
- restore behavior;
- uniqueness semantics for soft-deleted rows.

## Caches

Caches introduce consistency states.

Define:
- source of truth;
- TTL;
- invalidation strategy;
- stale tolerance;
- stampede protection when necessary;
- cache failure behavior.

Never rely on a cache for an authorization/security invariant unless the consistency model is explicitly safe.

## Sources

- PostgreSQL transaction isolation: https://www.postgresql.org/docs/current/transaction-iso.html
