# 3. Support SQLite and PostgreSQL, with enforced parity

- **Status:** Accepted
- **Date:** 2026-08-22

## Context

Requiring PostgreSQL to try the project is a real barrier — "run a database" is where a lot of people
stop. Supporting only SQLite pushes that barrier onto anyone deploying for a team.

Supporting both usually means one dialect is exercised daily and the other breaks quietly, because
nobody runs it locally.

## Decision

Support both through Drizzle. Maintain a schema module per dialect, and enforce that they stay
identical with `test/schema-parity.test.ts`, which compares column names, nullability, defaults, and
primary keys on every table.

Repositories are written once against the SQLite-typed client; the PostgreSQL client is presented
under that type at exactly one documented cast in `client.ts`. Repositories may use only portable
Drizzle operations.

Two schema choices exist purely for parity: timestamps are ISO-8601 strings, and structured values
are JSON in text columns.

## Consequences

**Good**

- `pnpm dev` needs no database process. `DATABASE_URL=postgres://…` is the only change to scale up.
- Drift fails CI on the dialect you do *not* run locally, which is the one that would otherwise break
  in production.
- Migrations are generated per dialect by drizzle-kit and applied on boot.

**Costs**

- Every schema change is two edits.
- No native timestamp or JSONB types, so no date arithmetic or JSON indexing in SQL. If a query ever
  needs those, it goes behind a `dialect` check in `packages/db` rather than into a repository.
- The single cast is a real hole in the type system. It is contained to one file and one line, and
  the parity test is what makes it safe.
