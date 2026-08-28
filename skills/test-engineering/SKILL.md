---
name: test-engineering
description: Design or improve unit, integration, contract, browser, and end-to-end tests around product risk. Use when adding test coverage, fixing flaky tests, or defining a verification strategy.
---

# Test Engineering

Choose the lowest test level that proves behavior through its real owner boundary.

## Build a risk map

Identify critical journeys, authorization boundaries, state transitions, external contracts, irreversible actions, concurrency, and historically fragile code. Allocate depth by consequence and likelihood, not line coverage.

## Select the level

- Unit: pure decisions, parsing, transformations, state machines.
- Integration: router/service/database, framework configuration, persistence, transactions.
- Contract: exact boundary behavior with services.
- Browser: rendering, navigation, forms, focus, accessibility, responsiveness.
- End-to-end: a small number of critical workflows across deployed boundaries.

Avoid re-proving the same behavior at every level.

## Test quality

- Assert observable outcomes and durable state, not private call order unless it is the contract.
- Keep fixtures minimal but realistic; control time, randomness, network, and identity.
- Use semantic selectors and visible states in browser tests.
- Do not replace the code under test with a mock of itself.
- Ensure a regression test fails on the broken implementation.
- Cover relevant empty, malformed, maximum, duplicate, stale, unauthorized, concurrent, retried, cancelled, and dependency-failure cases.

## Flakiness and reporting

Diagnose shared state, leaked resources, nondeterministic ordering, timing assumptions, port collisions, and environment coupling. Wait for observable state rather than sleeping. Report exact commands, counts, limitations, skipped live dependencies, and what each class proves.
