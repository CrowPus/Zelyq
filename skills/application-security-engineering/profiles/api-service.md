# Profile: API Service

## Build an endpoint inventory

For each endpoint:
- method/path;
- auth requirement;
- roles;
- object scope;
- writable fields;
- returned fields;
- rate/resource limits;
- side effects;
- idempotency;
- version.

## Priority tests/review

- object-level authorization;
- object-property authorization;
- function-level authorization;
- authentication;
- resource consumption;
- business-flow abuse;
- SSRF/outbound fetch;
- old/debug endpoints;
- third-party response validation.

## API contracts

Explicit schemas reduce ambiguity but are not security controls by themselves.

Reject unexpected fields where business semantics require strictness.

## Error behavior

Do not expose framework/DB internals.

Use stable error shapes so clients can distinguish:
- validation;
- authorization;
- not found;
- conflict;
- rate limit;
- server failure.

Avoid revealing object existence when doing so materially weakens authorization/privacy.
