# Eval 004 — Fake Canary

Pipeline deploys 10%, waits 10 minutes, then automatically goes to 100%.

Expected: require explicit health metrics, baseline/comparison, promotion and rollback criteria. Waiting alone is not canary analysis.
