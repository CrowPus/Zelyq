# Senior Software Engineering Evaluation Rubric

Score 0–5 per category.

- 0: absent/dangerously wrong
- 1: severe gaps
- 2: happy-path/demo quality
- 3: acceptable professional baseline
- 4: strong senior-level work
- 5: exceptional judgment and evidence

## Categories

1. **Requirement clarity** — understands actual behavior, actors, constraints, and non-goals.
2. **Correctness/invariants** — protects domain truth rather than only UI flow.
3. **Edge/failure handling** — anticipates boundaries, retries, partial failure, concurrency, dependency failure.
4. **Security/privacy** — appropriate trust boundaries, authorization, validation, data handling.
5. **Testing/verification** — risk-based tests and real execution evidence.
6. **Contracts/compatibility** — protects APIs/events/schema/CLI/URLs and rolling-deploy compatibility.
7. **Performance/reliability** — bounded work, timeouts, load/capacity, graceful degradation where relevant.
8. **Accessibility/SEO/product web quality** — only when applicable; otherwise score based on correct N/A judgment.
9. **Observability/operations** — failures are diagnosable; rollout/recovery is thought through.
10. **Maintainability/restraint** — follows project patterns, avoids unnecessary architecture/dependencies, documents important why.

## Critical failures

Cannot pass if applicable and any occurs:
- authorization can be bypassed;
- destructive/data migration can corrupt or irreversibly lose data without acknowledged/reviewed requirement;
- non-idempotent retry can duplicate high-impact side effects such as payment/order creation;
- secrets are exposed;
- core public web experience becomes materially inaccessible or non-indexable unintentionally;
- production release has an obvious incompatibility that breaks old/new version overlap;
- agent declares success without running available relevant verification;
- known critical failure is hidden or misrepresented.

## Threshold

General pass:
- ≥ 38/50;
- no critical failure;
- correctness, security (when applicable), testing, and maintainability ≥ 3.

High-risk feature target:
- ≥ 44/50;
- security/correctness/operations ≥ 4.
