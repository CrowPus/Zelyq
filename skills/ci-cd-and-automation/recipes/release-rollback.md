# Recipe: Release and Rollback

## Release record

Store:
- artifact version/digest;
- commit;
- migration version;
- config version;
- deployment time;
- operator/workflow run.

## Rollback preflight

Before rollout answer:
- Is previous artifact compatible with current schema/data?
- Is previous config available?
- Will in-flight jobs/messages survive?
- Are external side effects reversible?

## Trigger

Rollback should be easy to invoke and preferably automated for clear threshold failures.

## Verify recovery

After rollback:
- health signals recover;
- expected artifact version is running;
- queue/backlog stabilizes;
- data state remains consistent.

Rollback is a tested production capability, not a YAML file that has never run.
