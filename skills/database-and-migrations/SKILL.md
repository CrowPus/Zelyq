---
name: database-and-migrations
description: Design schemas, queries, indexes, and safe database migrations. Use when a feature changes persistent data, relationships, constraints, query behavior, or migration files.
---

# Database and Migrations

Model the invariant first; then choose schema and migration mechanics that keep it true during deployment.

## Inspect

Identify the engine, ORM/query layer, migration system, naming conventions, transaction behavior, production scale assumptions, and every reader/writer. Inspect generated SQL rather than trusting ORM declarations alone.

## Schema decisions

- Represent required truth with nullability, uniqueness, foreign keys, checks, and legal state constraints.
- Choose types for domain meaning and range, not current samples.
- Define delete behavior deliberately.
- Add indexes for demonstrated access paths, accounting for sort order and selectivity.
- Avoid storing derivable state unless consistency and recomputation ownership are explicit.
- Treat timestamps, money, identifiers, and tenant boundaries as domain decisions.

## Migration safety

For populated systems prefer expand-and-contract: add compatible structure, deploy tolerant code, backfill in bounded resumable batches, verify invariants, switch reads/writes, enforce constraints, then remove obsolete structure after old code is gone.

Avoid long locks, unbounded backfills, and required columns without a safe population strategy. Never rewrite applied migration history unless the project explicitly treats it as unreleased.

## Verification

Check null semantics, duplicates, stable ordering, pagination under inserts, tenant filtering, isolation, and N+1 behavior. Test migration from realistic state, fresh creation, rollback or forward recovery, constraints, representative queries, and compatibility across the deployment window.
