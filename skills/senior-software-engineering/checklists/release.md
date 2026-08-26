# Release Readiness Checklist

- [ ] Required CI checks passed on the exact revision/artifact.
- [ ] Dependencies/config/secrets required in production exist.
- [ ] Breaking contract changes are intentionally managed.
- [ ] Database changes are rollout-compatible.
- [ ] Backfills/migrations have progress/failure handling.
- [ ] Critical dashboards/alerts can detect regression.
- [ ] Health/readiness behavior is correct.
- [ ] Rollback/fix-forward procedure is understood.
- [ ] Feature flags have safe defaults and owner/removal plan.
- [ ] Staged rollout/canary is used for materially risky changes.
- [ ] Release notes/runbooks/customer docs are updated if necessary.
- [ ] Security/privacy review is complete where required.
- [ ] After deploy, verify user outcomes, errors, latency, saturation, queues, and migrations.
