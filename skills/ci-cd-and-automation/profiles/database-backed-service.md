# Profile: Database-Backed Service

Load the application/service profile plus database delivery.

## Additional gates

- migration application test;
- current-schema → new-schema upgrade test;
- compatibility of old/new app versions during rollout;
- destructive migration review;
- backfill plan;
- rollback/roll-forward decision.

## Release sequencing

Do not assume "migration first" is always safe.

For additive migration:
1. expand schema;
2. deploy compatible app;
3. backfill/migrate;
4. later contract.

For large DB changes, separate migration execution from app deployment so it can be observed independently.
