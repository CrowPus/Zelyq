# Bugfix Checklist

## Understand
- [ ] Reproduce or establish reliable evidence of the bug.
- [ ] Identify expected behavior.
- [ ] Identify root cause rather than only visible symptom when feasible.
- [ ] Determine blast radius: which users/data/versions are affected?

## Fix
- [ ] Make the smallest robust correction.
- [ ] Preserve unrelated behavior.
- [ ] Consider whether the same root cause exists elsewhere.
- [ ] Handle already-corrupted data/state if applicable.

## Prevent recurrence
- [ ] Add a regression test at the right level.
- [ ] Add validation/constraint/invariant if the bug exposed a missing guard.
- [ ] Add telemetry if the bug was hard to detect.

## Release
- [ ] Assess compatibility/migration.
- [ ] Decide whether existing bad data requires backfill/reconciliation.
- [ ] Verify rollback/fix-forward.
