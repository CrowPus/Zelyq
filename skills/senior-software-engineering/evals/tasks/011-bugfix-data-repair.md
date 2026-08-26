# Eval 011 — Bugfix With Existing Bad Data

## Prompt
Fix a bug that allowed duplicate active subscriptions.

## Senior behavior
Do not only prevent future duplicates. Determine whether existing data requires reconciliation, protect invariant structurally where possible, add regression/concurrency test, and plan safe cleanup.
