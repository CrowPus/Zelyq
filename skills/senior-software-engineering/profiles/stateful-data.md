# Profile: Stateful Data

Activate whenever code creates, mutates, migrates, deletes, aggregates, or reconciles durable data.

## Required lenses

- invariants/constraints;
- transaction boundary;
- concurrency;
- retries/idempotency;
- schema compatibility;
- backfill/recovery;
- delete/cascade semantics;
- cache/search/index consistency;
- audit/history requirements;
- data volume and query plan.

## Senior review

- What is source of truth?
- Which invariant belongs in the database?
- Can two requests race?
- Can old/new app versions use the schema simultaneously?
- Can the backfill resume?
- What proves migration completion?
- What does rollback mean after new data is written?
- Are backups actually restorable for the risk being discussed?

Load `references/data-concurrency-and-migrations.md`.
