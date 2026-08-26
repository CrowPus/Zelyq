# Database Release Checklist

- [ ] Old app + new schema compatibility checked.
- [ ] New app + old schema compatibility checked where rollout can overlap.
- [ ] Lock/rewrite/replication impact understood.
- [ ] Large backfill is batched, resumable, idempotent, and observable.
- [ ] Destructive contract step delayed until old versions are gone.
- [ ] Rollback implications after data transformation understood.
- [ ] Migration tested against representative schema/data.
- [ ] Monitoring covers migration duration/errors/DB pressure.
