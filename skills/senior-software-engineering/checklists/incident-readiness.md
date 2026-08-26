# Incident Readiness Checklist

For important production capabilities ask:

- [ ] What user-visible symptom indicates failure?
- [ ] Which metric/log/trace identifies it?
- [ ] Is there a correlation/request/job identifier?
- [ ] Is sensitive data excluded from telemetry?
- [ ] Can the feature be disabled or isolated?
- [ ] Can queued/failed work be replayed safely?
- [ ] Can data be reconciled after partial failure?
- [ ] Is there an owner/runbook for uncommon recovery steps?
- [ ] Are saturation signals visible before hard failure?
- [ ] Are alerts actionable rather than noisy?
