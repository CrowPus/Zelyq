# Feature Definition of Done

Use only applicable items. Marking an irrelevant item "N/A" is better than fake compliance.

## Requirement
- [ ] User/business behavior is understood.
- [ ] Non-goals and assumptions are explicit where needed.
- [ ] Permissions/actors are understood.
- [ ] Acceptance criteria include important failure states.

## Correctness
- [ ] Important invariants are identified and enforced.
- [ ] Boundary/empty/malformed inputs were considered.
- [ ] Duplicate/retry/concurrency behavior is defined when relevant.
- [ ] Partial failure has a safe outcome.
- [ ] Time/currency/locale semantics are explicit when relevant.

## Security
- [ ] Trust boundaries were considered.
- [ ] Server/resource authorization is enforced.
- [ ] Inputs are validated at boundaries.
- [ ] Secrets/sensitive data are not leaked in code/logs/errors.
- [ ] Resource size/rate limits exist where abuse can create harm.

## Data
- [ ] Transaction/concurrency behavior is correct.
- [ ] Schema changes support deployment overlap when required.
- [ ] Migration/backfill is recoverable and observable when required.
- [ ] Delete/cascade/cache/search-index consequences are understood.

## API / compatibility
- [ ] Existing callers/contracts remain compatible or migration/versioning is explicit.
- [ ] Errors/status codes are stable and meaningful.
- [ ] Timeouts/retries/idempotency are safe.
- [ ] Contract/schema docs are updated.

## UI/web
- [ ] Loading/empty/error/success states exist.
- [ ] Keyboard/accessibility behavior works.
- [ ] Responsive behavior is intentional.
- [ ] Public pages are crawlable/indexable correctly when applicable.
- [ ] Forms protect against duplicate side effects.

## Tests/verification
- [ ] Happy path is verified.
- [ ] Important negative/boundary paths are verified.
- [ ] Permission tests exist when relevant.
- [ ] Regression test captures the bug/behavior when practical.
- [ ] Integration/E2E/contract test exists where boundary risk justifies it.
- [ ] Typecheck/lint/build/tests required by project pass.

## Performance/reliability
- [ ] Work is bounded for expected scale.
- [ ] Slow/unavailable dependencies are handled.
- [ ] Retries are bounded and safe.
- [ ] Expensive queries/payloads are understood.

## Operations
- [ ] Failures produce useful telemetry.
- [ ] Critical outcome/error metrics exist when needed.
- [ ] Health/readiness and background backlog behavior remain correct.

## Release
- [ ] Rollout risk is understood.
- [ ] Backward compatibility during rolling deploy is safe.
- [ ] Rollback/fix-forward is possible or limitation is explicit.
- [ ] Feature flag/canary is used when it materially reduces risk.

## Maintainability
- [ ] Change follows existing project conventions.
- [ ] No unnecessary dependency/abstraction was added.
- [ ] Stale docs/examples/config were updated.
- [ ] Temporary flags/compatibility code have an exit condition.
