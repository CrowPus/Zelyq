# Profile: Application / Service

## Default path

```text
PR validation
  ↓
trusted build on main/tag
  ↓
artifact registry
  ↓
staging
  ↓
smoke/integration
  ↓
production rollout
  ↓
health evaluation
```

## Typical required concerns

- lint/static/types according to stack;
- unit/integration tests;
- build/package;
- security scanning;
- artifact identity;
- deployment concurrency;
- health checks;
- rollback.

Add E2E only for critical cross-system behavior where it has useful signal.

## Service releases

Prefer immutable artifact versions/digests.

Ensure:
- old/new version compatibility;
- graceful shutdown;
- readiness behavior;
- in-flight request/job handling;
- deployment markers in observability.
