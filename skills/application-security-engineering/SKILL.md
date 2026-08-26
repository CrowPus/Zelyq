---
name: application-security-engineering
description: Use this skill when designing, building, reviewing, testing, or remediating security-sensitive software. It applies to threat modeling, secure code review, authentication, authorization, sessions, multi-tenancy, APIs, input handling, browser security, file handling, outbound requests/SSRF, business logic, race conditions, cryptography, secrets, logging, exceptional conditions, supply-chain risk, security testing, vulnerability validation, and security regression prevention. It makes the agent behave like a senior application security engineer: establish scope, derive security requirements from assets and trust boundaries, combine code review with proportionate automated and authorized runtime validation, reject scanner-only findings, prove impact safely, fix root cause, add regression coverage, and verify remediation.
metadata:
  author: Zelyq
  version: "1.0.0"
---

# Application Security Engineering

## Mission

Engineer and verify security properties throughout the software lifecycle.

The goal is not "run scanners until something is red."

The goal is:

> Understand what the system must protect, how trust and authority move through it, which failures matter, and whether the implementation actually preserves those properties under normal, malicious, and exceptional conditions.

## Core principles

1. Scope before active testing.
2. Assets and trust boundaries before vulnerability labels.
3. Security requirements before scanners.
4. Threat modeling before expensive validation.
5. Server-side authorization is authoritative.
6. Treat users, files, integrations, queues, stored data, and third-party responses as potentially untrusted at their boundaries.
7. Static findings are hypotheses until context confirms risk.
8. Runtime anomalies are hypotheses until root cause is understood.
9. A finding requires evidence.
10. Severity follows demonstrated impact and environment, not imagined chains.
11. Fix the weakness class, not one payload/path.
12. Add regression protection for confirmed vulnerabilities where practical.
13. Security properties must hold during timeouts, retries, concurrency, and partial failure.
14. Security logging must support detection without leaking secrets.
15. Supply-chain and CI/CD security are part of application security.
16. Prefer established security primitives over custom cryptography/authentication.
17. Use the least-impact validation that proves the security property.
18. Top-10 lists are awareness tools, not complete verification standards.

## Select the review mode

### Design / pre-code
Load:
- `references/security-requirements-and-threat-modeling.md`
- `recipes/threat-model.md`
- applicable profile.

### White-box repository
Load:
- `profiles/white-box-repository.md`
- `references/secure-code-review.md`
- `references/security-testing-and-validation.md`

Combine architecture understanding, manual code review, structural/static analysis, dependency/config review, tests, and local/authorized runtime validation when practical.

### Authorized deployed application
Load:
- `references/scope-and-rules-of-engagement.md`
- `references/attack-surface-mapping.md`
- `references/security-testing-and-validation.md`

Only test explicitly in-scope systems. Prefer controlled accounts/data and low-impact evidence.

### Code + deployed target
Correlate source and runtime:
- code shows where controls should exist;
- runtime shows whether they hold;
- discrepancies are high-value review targets.

## Applicability router

### Web application
Load:
- `profiles/web-application.md`
- `references/frontend-browser-security.md`
- `references/authentication-authorization-session.md`
- `references/input-encoding-and-injection.md`

### API / service
Load:
- `profiles/api-service.md`
- `references/api-security.md`
- `references/exceptional-conditions-and-resource-limits.md`

### Multi-tenant SaaS
Load:
- `profiles/multi-tenant-saas.md`
- `references/multi-tenancy-and-isolation.md`

### Authentication / identity
Load:
- `profiles/authentication-identity.md`
- `references/authentication-authorization-session.md`
- `references/cryptography-secrets-and-data-protection.md`

### File upload / import / document processing
Load:
- `profiles/file-upload-processing.md`
- `references/file-handling.md`

### Webhook / URL fetch / callback / remote resource
Load:
- `references/ssrf-and-outbound-network.md`

### Payments / credits / inventory / quotas / privileged workflow
Load:
- `profiles/high-impact-business-flow.md`
- `references/business-logic-and-race-conditions.md`

### Library / dependency-heavy product
Load:
- `profiles/library-and-supply-chain.md`
- `references/supply-chain-and-dependencies.md`

### High-risk internet-facing system
Load:
- `profiles/high-risk-internet-facing.md`
- applicable ASVS/security references.

### Multi-agent security workflow
When specialist delegation is available and useful, load:
- `references/security-orchestration.md`

## Standards hierarchy

Use the right source for the right question.

- **OWASP ASVS 5.0.0** — primary application-security verification requirements.
- **OWASP Top 10:2025** — web-risk awareness, not a complete test plan.
- **OWASP API Security Top 10:2023** — API-specific risk awareness.
- **OWASP WSTG** — web security testing methodology.
- **OWASP Cheat Sheet Series** — implementation/remediation guidance.
- **OWASP SAMM / NIST SSDF** — security across the SDLC and program maturity.
- **CWE** — root weakness taxonomy.
- **CVSS 4.0** — technical severity communication when useful.

See `references/standards-map.md`.

## Required workflow

### 1. Establish scope
Identify authorized repositories, targets, environments, accounts/roles, exclusions, data restrictions, rate/availability constraints, and allowed validation methods.

Repository access does not automatically authorize probing URLs or third-party systems found in source.

### 2. Build security context
Identify:
- protected assets/data;
- money/value;
- privileged actions;
- identities/roles;
- tenants;
- third-party integrations;
- files;
- queues/jobs;
- external network access;
- secrets/keys.

Use `templates/security-review-plan.md`.

### 3. Map trust and data flow
Find:
- entry points;
- authentication;
- authorization;
- data access;
- interpreter/render boundaries;
- file handling;
- outbound HTTP;
- queues;
- caches;
- admin surfaces.

Do not begin with vulnerability names. Begin with authority and data transitions.

### 4. Define security invariants
Examples:

```text
A user can access only resources permitted by their tenant/role.
A payment settles at most once.
A reset token is single-use and expires.
Untrusted HTML never reaches an executable browser context unsanitized.
A user-controlled URL cannot reach prohibited network destinations.
A failed operation cannot leave partial privileged state.
```

Map important requirements to ASVS 5.0 when useful.

### 5. Threat-model the changed surface
Ask:
- what can be spoofed?
- what can cross authorization boundaries?
- what can be modified or replayed?
- what can be duplicated or reordered?
- what can be exhausted?
- what can fail open?
- what lower-trust system can influence a higher-trust decision?

Load `references/security-requirements-and-threat-modeling.md`.

### 6. Manually review high-risk controls
Prioritize applicable:
- authentication/recovery;
- authorization/tenant isolation;
- session/token lifecycle;
- property binding;
- dangerous interpreters/sinks;
- file handling;
- outbound network access;
- secrets/cryptography;
- business invariants;
- concurrency;
- exception handling;
- security logging.

### 7. Run automated triage
When appropriate and installed, use tools such as:
- SAST/structural analysis;
- secret scanning;
- SCA/dependency scanning;
- filesystem/container/IaC scanning.

`scripts/run-security-baseline` provides an optional local baseline.

Scanner output is not a confirmed vulnerability.

### 8. Trace candidates
For each candidate determine:
1. attacker/user-controlled source;
2. transformations/validation;
3. authentication/authorization context;
4. security-sensitive sink/action;
5. reachability;
6. compensating controls.

Close unsupported hypotheses.

### 9. Validate safely
Preferred order:
1. security/unit test;
2. integration test;
3. local reproduction;
4. test/staging;
5. explicitly authorized production-safe validation only when necessary.

Use synthetic/test data where possible. Do not create unnecessary destructive side effects.

### 10. Independently confirm high-impact findings
Where practical, use:
- separate reviewer/agent;
- alternate test;
- code-path confirmation;
- regression reproducer.

This reduces false positives.

### 11. Report only demonstrated impact
Do not upgrade:
- unauthorized record read → "full database compromise";
- weak auth path → "account takeover";
- suspicious sink → "RCE"

without evidence supporting that outcome.

Load `references/vulnerability-reporting-and-severity.md`.

### 12. Identify and fix root cause
Prefer durable controls:
- centralized authorization;
- scoped data access;
- parameterized interpreter APIs;
- proven encoders/sanitizers;
- explicit DTO/field policies;
- network allowlists + egress controls;
- DB constraints/transactions;
- idempotency;
- safe cryptographic libraries;
- secret management.

Do not block one literal payload.

### 13. Add regression protection
Convert confirmed issues into:
- unit/integration security tests;
- authorization matrices;
- concurrency/idempotency tests;
- static organization-specific rules;
- CI policy;
- monitoring/alerting

where appropriate.

### 14. Re-test
Verify:
- original reproduction is blocked;
- legitimate behavior remains;
- nearby variants are covered;
- control fails safely;
- sensitive information is not leaked.

### 15. Review exceptional conditions
Review:
- missing/malformed input;
- timeouts;
- dependency failures;
- retries;
- duplicate messages;
- partial transactions;
- logging failure;
- storage exhaustion;
- oversized/deep input;
- cancellation/rollback.

Load `references/exceptional-conditions-and-resource-limits.md`.

### 16. Review security observability
Ensure important security events are visible without logging passwords, session secrets, tokens, private keys, or unnecessary sensitive data.

Load `references/error-handling-and-security-logging.md`.

## Final adversarial review

### Authorization
Can a principal change an ID, tenant, role, field, method, or route and cross authority?

### Authentication
Is there a weaker alternate login/recovery/session path?

### Input
Can untrusted data reach HTML, SQL, shell, template, path, URL, parser, or deserializer contexts unsafely?

### Business logic
Can repetition, reordering, stale state, negative values, or concurrency violate an invariant?

### Resources
Can one principal cause unbounded CPU, memory, DB, storage, email/SMS, or third-party spend?

### External trust
Are third-party responses or outbound destinations trusted too much?

### Failure
Can timeout/exception create fail-open or partial privileged state?

### Supply chain
Can dependencies/build inputs alter privileged behavior unexpectedly?

### Detection
Would repeated attacks on important controls be visible?

## Finding contract

A confirmed finding must include:
- specific title;
- affected component;
- preconditions;
- violated security property;
- reproducible evidence;
- demonstrated impact;
- root cause;
- remediation;
- regression test;
- standards mapping where useful;
- severity rationale.

Use `templates/finding.md`.

## Rejection rules

Reject or challenge:
- "Top 10 passed" as proof of security;
- scanner-only findings;
- client-only authorization;
- hidden/disabled UI as access control;
- unsafe broad property binding;
- string-concatenated SQL/shell/template/interpreter input;
- custom password hashing/cryptography when proven primitives fit;
- signature-only token trust without issuer/audience/key-purpose policy;
- file upload trusted only by extension or browser MIME;
- outbound URL filtering based on one regex/one metadata-IP deny;
- high-value actions without replay/idempotency/concurrency reasoning;
- security controls that fail open on exception;
- unbounded expensive operations;
- secrets in source, logs, client bundles, or artifacts;
- raw stack traces/internal errors exposed to untrusted users;
- dependency scanning as the entire supply-chain strategy;
- destructive/high-volume validation when safer proof is available;
- severity based on hypothetical chains;
- payload-specific patches;
- closing runtime findings without re-verification when possible.

## Definition of done

A security review is complete when applicable:
- scope is explicit;
- assets and trust boundaries are mapped;
- security requirements/invariants exist;
- relevant standards/domain risks are considered;
- high-risk flows receive manual review;
- automated findings are triaged;
- candidates are validated or closed;
- severity reflects evidence;
- root cause is documented;
- remediation addresses the weakness class;
- regression coverage exists where practical;
- fix is re-tested;
- logging/detection implications are considered;
- residual risk and validation limits are stated.

Use `checklists/security-review-definition-of-done.md`.

## Context discipline

Load only the references relevant to the current system and threat surface. Breadth matters, but indiscriminate security checklists reduce signal.
