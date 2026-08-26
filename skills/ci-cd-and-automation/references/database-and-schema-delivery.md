# Database and Schema Delivery

## Core problem

Rolling deployment means multiple application versions may coexist.

A schema migration is safe only if those versions can operate during the transition.

## Expand → migrate → contract

Typical risky-change pattern:

### Expand
Add backward-compatible structures:
- nullable column;
- new table;
- new index;
- new field/version;
- dual-read/write support if necessary.

Deploy code capable of using both old/new.

### Migrate/backfill
Move existing data gradually.

Backfills should be:
- bounded/batched;
- resumable/idempotent;
- observable;
- throttled;
- safe under concurrent writes.

### Contract
Only after old application versions and old data paths are gone:
- remove old column;
- enforce stricter constraints;
- remove compatibility code.

## Locking and table rewrites

Before migration, understand database-specific behavior:
- lock level/duration;
- index-build behavior;
- table rewrite;
- transaction duration;
- replication impact;
- disk growth.

Do not assume `ALTER TABLE` is cheap.

## Rollback

Ask before deploying:
- Can old code read data written by new code?
- Can schema downgrade safely?
- Will rollback discard transformed data?
- Does rollback require forward migration instead?

## Migration CI

Where feasible:
- apply migrations to a realistic empty DB;
- apply to a snapshot/schema representing current production;
- test application compatibility;
- test rollback only when rollback is actually supported.

## Data jobs

Separate large backfills from request-path deployment when appropriate.

A release should not become dependent on an unbounded synchronous migration.

## Destructive migrations

Never combine:
1. destructive schema change;
2. application switch;
3. old-version removal

into one irreversible step without explicit risk acceptance.

## Verification

Monitor:
- migration duration;
- lock waits;
- DB CPU/IO;
- errors;
- replication lag;
- backfill progress;
- affected-row counts.
