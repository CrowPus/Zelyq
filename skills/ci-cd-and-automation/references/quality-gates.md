# Quality Gates

## Principle

A gate exists to reduce a known risk. It should be deterministic enough that people trust it.

Do not add checks only because "professional CI has them."

## Gate classes

### Source correctness
- formatting;
- lint/static analysis;
- type checking;
- compilation.

### Behavior
- unit tests;
- integration tests;
- contract tests;
- E2E;
- migration tests;
- smoke tests.

### Security/supply chain
- dependency review;
- SAST/code scanning;
- secret detection;
- license policy;
- container/IaC scanning;
- provenance/attestation.

### Product quality
- accessibility;
- bundle/performance budget;
- visual regression;
- API schema compatibility.

### Release health
- post-deploy smoke;
- SLO/metric evaluation;
- canary analysis.

## Order

Optimize for **time to useful feedback**, not a ceremonial order.

Cheap deterministic checks can run immediately and in parallel:
- format/lint;
- typecheck;
- unit tests;
- dependency review.

Build may be prerequisite for:
- package tests;
- browser E2E;
- artifact scanning.

Do not serialize independent jobs.

## Required vs advisory

A check should block merge/release when:
- failure has high signal;
- risk is material;
- team has a remediation path.

Advisory checks are reasonable while a signal is immature. Do not pretend an advisory check is enforcement.

## Flaky checks

Flaky required checks train people to ignore failures.

Fix root causes:
- timing/race;
- global shared state;
- real network dependencies;
- unstable fixtures;
- clock/timezone;
- nondeterministic ordering.

Quarantine only temporarily, with ownership and deadline.

## Change-aware selection

Skipping irrelevant jobs can improve feedback in monorepos, but path filters can be dangerous if dependency relationships are incomplete.

If package A depends on shared package B, a B change must trigger A's relevant validation.

Prefer build-graph-aware change detection when available.

## Coverage

Do not set coverage thresholds without understanding what they incentivize.

Coverage is evidence of execution, not proof of correctness.

Critical paths and regression tests matter more than inflated percentages.

## Security scan severity

Choose fail thresholds based on:
- exploitability;
- production exposure;
- fix availability;
- organization policy.

Avoid both extremes:
- block every low-severity issue and create permanent bypass culture;
- ignore known critical vulnerabilities because "scanner has false positives."

## Quality gate ownership

Every required gate should have:
- clear failure output;
- responsible owner/team;
- documented remediation;
- known timeout/budget;
- a way to distinguish infrastructure failure from product failure.
