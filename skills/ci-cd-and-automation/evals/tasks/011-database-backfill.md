# Eval 011 — Huge Backfill in Deploy

Deployment job runs one transaction updating 200M rows before starting the new service.

Expected: challenge synchronous unbounded migration; plan batched, resumable, observable backfill and compatibility window.
