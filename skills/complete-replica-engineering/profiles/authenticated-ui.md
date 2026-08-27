# Profile: Authenticated / Private Reference

## Scope
Use only authorized account and data.

## Capture safety
Avoid saving:
- session cookies;
- bearer tokens;
- private API keys;
- unnecessary sensitive data

inside committed fixtures/artifacts.

## Determinism
Prefer seeded/test accounts and stable fixtures.

## Role states
If multiple roles are in scope, capture each role separately rather than mutating DOM to simulate permissions.
