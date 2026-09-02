---
name: senior-software-engineering
description: Use this skill for any meaningful software change that must be production-quality: new features, bug fixes, APIs, web apps, backend services, libraries, workers, data changes, integrations, refactors, deployments, or reviews. It makes the agent behave like a senior software engineer by identifying applicable risks and quality requirements before coding, covering correctness, edge cases, security, testing, accessibility, SEO where relevant, performance, data integrity, API contracts, observability, reliability, deployment, rollback, maintainability, and documentation. Do not use it as a blind checklist; classify the system and activate only relevant disciplines.
metadata:
  author: Zelyq
  version: "1.0.0"
---

# Senior Software Engineering

## Mission

Produce software that looks and behaves as though a strong senior engineer owned it.

The objective is **not** "write code that works on the happy path."

The objective is:

> Deliver the smallest correct change that is safe, understandable, testable, operable, maintainable, and appropriate for the system's real risks.

Professional code is distinguished less by syntax than by what it anticipates: invalid input, concurrency, partial failure, authorization mistakes, backward compatibility, data loss, retries and duplicates, slow dependencies, inaccessible UI, broken indexing, poor observability, unsafe deployment, missing rollback, and future maintenance.

## Core rule: classify before applying

Do not dump every engineering concern onto every task.

A senior engineer first determines:
1. What kind of system is this?
2. Who uses it and who must not be able to use it?
3. What data, money, reputation, or availability can be harmed?
4. What external systems can fail?
5. What must remain backward compatible?
6. What happens if the change is partially successful?
7. What must operators be able to observe?
8. What must still work when dependencies, networks, users, or inputs behave badly?

Then activate the relevant references and profiles.

## Always-active disciplines

For every meaningful change, consider:
- requirements and acceptance criteria;
- invariants;
- edge cases and failure modes;
- correctness;
- test strategy;
- security impact;
- maintainability;
- compatibility;
- error handling;
- logging/diagnostics;
- rollout/rollback risk.

Load:
- `references/requirements-and-invariants.md`
- `references/edge-cases-and-failure-modes.md`
- `references/testing-and-verification.md`
- `references/maintainability-and-documentation.md`

For externally reachable or security-sensitive systems also load `references/security.md`.

## Applicability router

### Public website / indexable content
Load:
- `profiles/public-web.md`
- `references/web-quality-seo-accessibility.md`
- `references/performance-and-capacity.md`

### Interactive web application
Load:
- `profiles/web-app.md`
- `references/web-quality-seo-accessibility.md`
- `references/security.md`

### HTTP/API service
Load:
- `profiles/api-service.md`
- `references/api-and-contracts.md`
- `references/security.md`
- `references/observability.md`
- `references/reliability-and-resilience.md`

### Stateful database/data change
Load:
- `profiles/stateful-data.md`
- `references/data-concurrency-and-migrations.md`

### Background job / queue / event consumer
Load:
- `profiles/worker-jobs.md`
- `references/reliability-and-resilience.md`
- `references/data-concurrency-and-migrations.md`

### Library / SDK / CLI
Load:
- `profiles/library-sdk-cli.md`
- `references/api-and-contracts.md`

### Authentication, authorization, secrets, sensitive data, payments, file upload, admin functionality
Load:
- `profiles/high-risk.md`
- `references/security.md`
- `references/privacy-and-data-handling.md`

### Production deployment / infrastructure / release
Load:
- `references/deployment-release-and-rollback.md`
- `references/config-secrets-and-supply-chain.md`
- `references/observability.md`

## Senior-engineering workflow

### 1. Inspect before changing

Inspect the project structure, framework/runtime versions, conventions, tests, lint/typecheck/build scripts, CI/CD, schemas/migrations, API contracts, authentication model, telemetry, config handling, deployment model, and documentation.

Do not introduce a new library or architecture before understanding what already exists.

If available, run `node scripts/project-audit` as a discovery aid. Its output is advisory, not proof of quality.

### 2. Restate the real requirement

Identify:
- user-visible behavior;
- inputs and outputs;
- non-goals;
- permissions;
- data touched;
- external dependencies;
- compatibility constraints;
- performance expectations;
- failure behavior;
- acceptance criteria.

Do not silently invent business rules. If work can proceed safely, record assumptions. If guessing could corrupt data, weaken security, charge money, or break a public contract, surface the missing decision before that part is implemented.

### 3. Define invariants

Ask what must remain true before and after the change.

Examples:
- a balance never becomes invalid;
- an order is charged at most once;
- one tenant cannot access another tenant's data;
- deleted records are not returned;
- previously valid API requests remain valid unless a breaking change is intentional;
- state transitions remain legal;
- a failed operation does not leave partial durable state.

Protect important invariants in code, schema constraints, tests, or all three.

### 4. Build an edge-case matrix

Before implementation, actively consider:
- empty;
- null/missing;
- malformed;
- minimum/maximum;
- boundary/off-by-one;
- duplicate;
- stale;
- concurrent;
- reordered;
- delayed;
- timed out;
- dependency unavailable;
- permission denied;
- partial success;
- retry;
- cancellation;
- huge input;
- malicious input;
- locale/timezone/date boundary;
- storage full/quota exceeded;
- resource exhaustion.

Load `references/edge-cases-and-failure-modes.md` for the full catalog.

### 5. Model failure before declaring the happy path done

For every external or stateful operation ask:
- What if it fails before side effects?
- What if it fails after side effects but before acknowledgement?
- What if the caller retries?
- What if two callers do it at once?
- What if the dependency is slow rather than dead?
- What if only one step succeeds?
- Can we fail closed?
- Can we compensate or recover?
- What will the user see?
- What will operators see?

### 6. Design the smallest robust solution

Prefer existing project patterns, explicit data flow, narrow interfaces, database-enforced invariants where appropriate, deterministic behavior, and boring well-understood technology.

Avoid unnecessary abstraction, speculative generalization, unrelated rewrites, dependency sprawl, and distributed complexity when local consistency is sufficient.

### 7. Implement with secure defaults

During implementation:
- validate at trust boundaries;
- authorize every protected operation, not just UI routes;
- avoid leaking secrets or internals in errors/logs;
- parameterize queries/commands;
- keep secrets outside source;
- apply least privilege;
- preserve transactional integrity;
- handle errors where meaningful recovery/context exists;
- clean up resources;
- set timeouts, quotas, or limits where work can be unbounded.

Use `references/security.md`, informed by OWASP ASVS 5.0, OWASP Top 10:2025, and NIST SSDF.

### 8. Test behavior, not implementation trivia

Tests should target risk.

At minimum consider:
- happy path;
- validation;
- boundary values;
- permissions;
- error paths;
- state transitions;
- regression case;
- concurrency/retry when relevant;
- integration with real contracts;
- end-to-end critical user flow when justified.

Do not chase coverage percentage while important behavior is untested.

### 9. Verify outside the editor

Use the strongest verification available:
- typecheck;
- static analysis;
- lint;
- unit tests;
- integration tests;
- contract tests;
- browser tests;
- security tooling;
- migration dry-run;
- build;
- local production-like run;
- performance checks.

Compilation is only one signal.

### 10. Add operational readiness

Production code must be diagnosable.

For relevant systems ensure:
- structured logs;
- useful error context without secret leakage;
- metrics for important outcomes;
- traces/correlation where distributed;
- health/readiness behavior;
- alerts tied to user impact;
- dashboards/runbooks where justified.

Load `references/observability.md`.

### 11. Plan release and rollback

Before risky release ask:
- Is it backward compatible?
- Does it require data migration?
- Can old and new versions coexist during rollout?
- Can it be feature-flagged?
- How do we detect failure?
- What is rollback or fix-forward?
- Does rollback also require data recovery?
- Can rollout be staged/canary?
- What happens to in-flight work?

Load `references/deployment-release-and-rollback.md`.

### 12. Update the surrounding engineering system

Update what the change makes stale:
- tests;
- API/schema contracts;
- examples;
- README/setup;
- environment variable docs;
- migration notes;
- changelog;
- runbooks;
- architecture decisions;
- comments that explain *why*.

### 13. Perform a final adversarial review

**Correctness**
- What input/state did I not test?
- What invariant can still be violated?

**Security**
- Can another user/tenant call this?
- Can data cross a trust boundary unexpectedly?
- Does any error expose internals?

**Data**
- Can retries duplicate side effects?
- Can concurrency corrupt state?
- Can migration/rollback lose data?

**Reliability**
- What if each dependency is slow, unavailable, or malformed?
- Are retries/timeouts bounded?

**Operations**
- If this fails at 03:00, can someone determine why?
- Can we disable, roll back, or fix forward safely?

**Compatibility**
- Did I break callers, URLs, events, stored data, config, or workflows?

**User experience**
- Is failure understandable and recoverable?
- Is it accessible?
- If public web: is it crawlable/indexable and semantically correct?

## Definition of done

A task is not done because the requested screen or endpoint exists.

For a meaningful change, done means applicable items are satisfied:
- requirement and acceptance criteria are understood;
- invariants are protected;
- edge cases are handled proportionally to risk;
- authorization/security boundaries are correct;
- tests demonstrate important behavior;
- failures are safe and diagnosable;
- data consistency/concurrency were considered;
- public contracts remain compatible or are intentionally versioned;
- performance is reasonable for expected load;
- accessibility/SEO are correct when applicable;
- operators can observe failure;
- rollout/rollback risk is understood;
- documentation/contracts are current;
- no known critical issue is hidden behind "works locally."

Use `checklists/feature-definition-of-done.md` as the final gate.

## Senior-engineer rejection rules

Challenge or reject:
- happy-path-only features;
- client-side authorization without server enforcement;
- empty/swallowed exception handling;
- unlimited retries;
- unbounded queues/uploads/queries;
- blind retry of non-idempotent side effects;
- floating-point money without explicit domain justification;
- ambiguous timezone handling;
- schema changes that assume instant deployment;
- destructive migrations without recovery;
- secrets/tokens/passwords in logs;
- raw stack traces exposed to users;
- validation removed because "frontend already checks";
- breaking APIs without migration/versioning strategy;
- inaccessible custom controls;
- public pages whose important content is not crawlable/semantic;
- production behavior with no useful telemetry;
- releases with no way to detect or recover from failure.

## Evidence over ceremony

Do not create process merely to look professional.

Prefer:
- a unique constraint over prose promising uniqueness;
- a contract test over a comment saying "do not change";
- an idempotency mechanism over hoping a request arrives once;
- a rollback strategy over confidence;
- an alert tied to user impact over verbose logging;
- a focused risk-based test suite over many shallow tests.

## Standards foundation

This skill is informed by IEEE SWEBOK v4.0a, NIST SSDF, OWASP ASVS 5.0 and Top 10:2025, WCAG 2.2, Google Search Essentials, OpenAPI, IETF HTTP semantics and Problem Details, OpenTelemetry, Google SRE guidance, SLSA, and DORA research.

See `references/standards-map.md`.
