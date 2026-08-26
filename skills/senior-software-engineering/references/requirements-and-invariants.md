# Requirements and Invariants

## Purpose

Senior engineers do not start from implementation details. They establish what must be true, what must not change, and how success will be observed.

## Requirement classes

Consider:
- functional behavior;
- non-functional behavior such as latency, availability, scalability, security, accessibility, compatibility, and operability;
- constraints from existing architecture, contracts, regulation, deployment, or data;
- explicit non-goals;
- derived requirements created by the design.

SWEBOK v4.0a treats requirements, non-functional requirements, constraints, analysis, validation, traceability, and conflict resolution as foundational software-engineering activities.

## Acceptance criteria

Write criteria in observable terms.

Weak:
> Handle bad input gracefully.

Stronger:
> Requests with a missing `email` field return a stable validation error without creating a user record or logging sensitive input.

Acceptance criteria should include important failure states, not only success states.

## Invariants

An invariant is something that must remain true across operations and states.

Examples:
- uniqueness;
- ownership/tenant isolation;
- balances reconcile;
- one resource has one active primary state;
- a state transition cannot skip required intermediate states;
- deleted data does not reappear through caches;
- a job can be delivered twice without applying a business side effect twice;
- a public API does not silently change meaning.

## Protect invariants at the strongest useful layer

Choose the right layer:
- database constraints for structural truth;
- authorization policy for access truth;
- domain logic for business state transitions;
- API validation for boundary contracts;
- tests for regression evidence.

Avoid relying only on UI validation or comments for critical invariants.

## Traceability

For risky work, be able to trace:

`requirement → design decision → implementation → verification`

This does not require heavy paperwork. It can be issue acceptance criteria, a short design note, a schema constraint, and focused tests.

## Assumptions

Record assumptions when ambiguity is safe enough to proceed.

Do not guess when ambiguity affects:
- security;
- money;
- destructive data operations;
- legal/privacy obligations;
- public contract compatibility;
- irreversible actions.

## Requirement review prompts

- Who is allowed to do this?
- What happens to existing users/data?
- What happens when input is absent, duplicated, stale, or malicious?
- Which old behavior must remain?
- What is the latency/load expectation?
- What is the failure contract?
- What does recovery look like?
- What evidence proves completion?
