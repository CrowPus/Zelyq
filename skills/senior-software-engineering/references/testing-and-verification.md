# Testing and Verification

## Principle

Tests are evidence about behavior and risk. They are not decoration and coverage percentage is not a substitute for judgment.

SWEBOK v4.0a includes software testing as a major knowledge area and software quality explicitly includes static analysis, dynamic analysis, verification/validation, reviews, audits, and testing.

## Choose test level by failure risk

### Unit
Use for pure logic, domain rules, parsing, calculations, state transitions, and edge boundaries.

### Integration
Use where correctness depends on databases, files, queues, external adapters, framework configuration, serialization, transactions, or real infrastructure behavior.

### Contract
Use for APIs/events consumed by other systems. Verify schemas and compatibility at the boundary.

### End-to-end
Use for critical user journeys and cross-component behavior. Keep focused because E2E suites are slower and more brittle.

### Static verification
Use type checking, linters, security/static analysis, schema validation, dependency checks, and compile/build validation when applicable.

## Risk-based minimum

For a meaningful feature consider:
- happy path;
- invalid input;
- boundaries;
- authorization;
- important state transitions;
- dependency failure;
- regression case;
- retry/concurrency if side effects exist;
- migration compatibility if data changes;
- accessibility/browser behavior for UI;
- performance/load when scaling assumptions are material.

## Boundary-value thinking

For a rule `1 <= quantity <= 100`, test around:
- 0;
- 1;
- 2;
- 99;
- 100;
- 101;

Do not only test representative middle values.

## State-transition testing

For workflows, test invalid transitions as aggressively as valid ones.

Example:
- draft → paid: invalid;
- draft → submitted: valid;
- submitted → paid: valid;
- paid → paid: define idempotent/no-op/error behavior;
- cancelled → paid: invalid.

## Permission matrix

Test roles/tenants explicitly:

| Actor | Own resource | Other user's | Other tenant | Admin-only action |
|---|---|---|---|---|
| anonymous | expected | expected | expected | denied |
| user | expected | denied | denied | denied |
| admin | policy | policy | policy | allowed |

Do not infer authorization quality from route middleware alone.

## Property/invariant tests

When useful, test properties instead of only examples:
- total never negative;
- decoding(encoding(x)) == x;
- retries do not multiply side effects;
- sorting preserves all elements;
- authorization never crosses tenant ownership.

## Failure injection

When the feature has external dependencies, deliberately simulate:
- timeout;
- 429;
- 5xx;
- malformed response;
- database error;
- lost acknowledgement;
- cancellation.

## Test data

Avoid tests that pass only because fixtures are unrealistically clean.

Include:
- Unicode;
- long names;
- empty optional fields;
- old records;
- mixed versions;
- realistic timestamps;
- high cardinality where relevant.

## Determinism

Flaky tests are weak evidence.

Control:
- clock/time;
- randomness;
- network;
- ordering assumptions;
- eventual-consistency waits.

Prefer explicit polling with bounded timeout over arbitrary sleeps.

## Review is verification

For risky code, verification should also include human/agent review of:
- trust boundaries;
- data migration;
- concurrency;
- public API changes;
- failure handling;
- operational impact.

## Completion evidence

Do not say "tested" unless you can say what ran and what behavior it demonstrated.
