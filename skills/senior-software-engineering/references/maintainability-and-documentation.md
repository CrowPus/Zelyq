# Maintainability and Documentation

## Principle

A professional change is optimized for the next engineer as well as today's demo.

SWEBOK treats maintainability, modifiability, testability, supportability, program comprehension, technical debt, and maintenance as core engineering concerns.

## Prefer local clarity

Good code should make these questions easy:
- what does this component own?
- what are its inputs/outputs?
- which states are legal?
- where are errors handled?
- which side effects occur?
- what assumptions are important?

## Abstraction test

Create abstraction when it removes meaningful duplication or establishes a real boundary.

Do not create abstractions for hypothetical future use.

Three readable similar lines can be better than a generic framework nobody understands.

## Dependency discipline

Before adding a dependency ask:
- is existing platform/library functionality sufficient?
- does the dependency materially reduce risk/complexity?
- is it maintained?
- what transitive dependency/security cost appears?
- how hard is replacement?
- does it change bundle/runtime footprint?

## Comments

Comment **why**, constraints, hazards, or non-obvious tradeoffs.

Avoid narrating obvious syntax.

Good:
> Keep this query inside the transaction: moving it earlier reintroduces a lost-update race.

Weak:
> Get the user from the database.

## Documentation that must track behavior

Update when relevant:
- README/setup;
- public API docs/OpenAPI;
- configuration/environment variables;
- architecture decision records;
- migration instructions;
- changelog/release notes;
- runbooks;
- operational dashboards/alerts;
- examples.

## Public contracts

Treat these as APIs even if they are not functions:
- URLs;
- CLI flags;
- environment variables;
- event schemas;
- database interfaces shared by services;
- config files;
- file formats;
- error codes;
- webhooks.

Breaking them requires explicit compatibility planning.

## Naming

Names should encode domain meaning, not implementation accident.

Prefer `reservationExpiresAt` over `time2`.

Avoid booleans whose meaning is ambiguous. Prefer enums/state models when there are really more than two states.

## Module boundaries

Keep:
- domain rules independent from transport/UI where practical;
- external providers behind narrow adapters;
- serialization at boundaries;
- persistence details from leaking through every layer.

Do not over-architect small codebases.

## Technical debt

Debt is a tradeoff, not merely "ugly code."

If intentionally accepted, record:
- what was compromised;
- why;
- consequence;
- trigger for revisiting.

## Deletion

Remove dead code, obsolete flags, stale compatibility paths, and unused configuration when it is safe. Unowned legacy paths become hidden test/security surface.

## Supportability

Ask whether someone unfamiliar with the feature can:
- reproduce a failure;
- locate the responsible code;
- understand logs/errors;
- run tests;
- change behavior safely.
