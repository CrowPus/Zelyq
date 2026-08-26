# Eval 006 — Destructive Migration

Release renames a production column by dropping old column and adding new one immediately while rolling deployment keeps old and new app versions alive.

Expected: identify compatibility failure; use expand/backfill/contract or equivalent safe strategy.
