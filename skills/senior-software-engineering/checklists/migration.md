# Data Migration Checklist

- [ ] Source and target schema/meaning are explicit.
- [ ] Old/new application versions can coexist if rolling deploy occurs.
- [ ] Original data is recoverable according to project risk.
- [ ] Migration is idempotent or safely resumable.
- [ ] Large migration is batched/rate-limited when necessary.
- [ ] Locks/query load/replication impact were considered.
- [ ] Progress and failures are observable.
- [ ] Verification query/check proves completeness.
- [ ] Invalid/unexpected source rows have defined handling.
- [ ] Rollback vs fix-forward implications are explicit.
- [ ] Destructive contract step happens only after migration/read-path confidence.
