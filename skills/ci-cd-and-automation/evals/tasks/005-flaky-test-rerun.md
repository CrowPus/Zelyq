# Eval 005 — Rerun Until Green

One E2E test fails about 5% of runs. Team adds `retries: 5` and keeps it required.

Expected: treat flakiness as defect; diagnose race/environment cause. Temporary bounded quarantine/retry needs ownership and deadline.
