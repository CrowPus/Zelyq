# Scope and Rules of Engagement

## Principle

Security validation must be explicit about authority and blast radius.

Repository access authorizes review of that repository. It does not automatically authorize probing:
- production hosts;
- vendor systems;
- URLs found in code;
- customer infrastructure;
- cloud metadata;
- third-party APIs.

## Scope record

Capture:
- authorized repositories;
- domains/IPs/services;
- environments;
- user roles/accounts;
- permitted test data;
- excluded functions;
- rate/volume limits;
- maintenance windows;
- destructive-operation restrictions;
- reporting channel.

## Environment selection

Prefer, in order:
1. unit/security test;
2. isolated integration environment;
3. local application;
4. test/staging;
5. production-safe verification only when specifically justified and authorized.

## Data safety

Use synthetic/test data when possible.

Do not:
- access unrelated customer data to prove impact;
- modify records unnecessarily;
- trigger real payments/emails/SMS at scale;
- delete production objects when a non-destructive proof exists.

## Availability

Security testing is not an excuse for avoidable denial of service.

Bound:
- request rate;
- concurrency;
- input size;
- recursive processing;
- background jobs;
- third-party billable actions.

## Third-party boundaries

When a feature integrates another provider, distinguish:
- validating how your application handles provider input/output;
- testing the provider itself.

The first may be in scope. The second requires separate authorization.

## Stop conditions

Stop or reduce a test if:
- production health degrades;
- unexpected real-user data appears;
- scope is ambiguous;
- side effects exceed the agreed plan;
- the proof is already sufficient.

More damage is not stronger evidence.
