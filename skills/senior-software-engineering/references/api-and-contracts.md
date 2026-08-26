# API and Contract Engineering

## Principle

An API is a long-lived contract, not merely a route that returns JSON.

OpenAPI 3.2.0 is the current published OpenAPI specification as of this skill version and provides a language-agnostic interface description for HTTP APIs.

## Define the contract

Specify when applicable:
- method/path;
- authentication/authorization;
- request schema;
- response schema;
- status codes;
- error format;
- pagination/filter/sort semantics;
- rate limits;
- idempotency behavior;
- version/deprecation behavior;
- examples.

## HTTP semantics

Use methods according to semantics.

RFC 9110 defines GET/HEAD/OPTIONS/TRACE as safe; PUT, DELETE, and safe methods are idempotent by method semantics.

Do not hide destructive actions behind GET.

Do not automatically retry a non-idempotent action unless the application makes the operation safely repeatable or knows the original was not applied.

## Idempotency

For create/charge/provision/send operations that may be retried, consider an idempotency key or domain-specific deduplication mechanism.

A sound design defines:
- key scope;
- retention window;
- request fingerprint/compatibility;
- response replay behavior;
- concurrent requests with the same key;
- failure/timeout behavior.

## Errors

Use meaningful HTTP status semantics and stable machine-readable errors.

RFC 9457 Problem Details is a standard format for HTTP API error details (`application/problem+json`). It is optional, but use it rather than inventing inconsistent formats when it fits.

Do not expose debugging internals in `detail`.

## Validation

Validate:
- path/query/header/body separately;
- type/range/format;
- unknown fields according to contract policy;
- cross-field business rules.

Return useful client errors without revealing internals.

## Pagination

Define:
- stable ordering;
- cursor/offset semantics;
- maximum page size;
- behavior under concurrent inserts/deletes;
- total counts only if cost is acceptable.

Cursor pagination is often safer for large/changing datasets, but choose based on product/query needs.

## Versioning and compatibility

Treat existing consumers as production dependencies.

Prefer backward-compatible changes:
- add optional response fields carefully;
- add optional request fields;
- add new endpoints;
- support deprecation windows.

Breaking changes require explicit version/migration strategy.

Semantic Versioning is appropriate for packages/SDKs with a declared public API: incompatible changes increment major, backward-compatible functionality minor, compatible fixes patch.

## Events/webhooks are contracts too

Define:
- schema/version;
- event ID;
- timestamp semantics;
- ordering guarantees or lack thereof;
- delivery retry policy;
- signature/auth;
- deduplication;
- replay window;
- backwards compatibility.

Consumers should assume at-least-once delivery unless a stronger guarantee is explicitly provided and proven.

## Timeouts and retries

Every network call needs a timeout appropriate to the operation.

Retries should be:
- bounded;
- for transient failures only;
- backoff-aware;
- jittered when many clients can synchronize;
- safe for the operation.

Honor `Retry-After` when appropriate.

## Contract verification

For important APIs:
- lint/validate OpenAPI/schema;
- integration-test serialization and status codes;
- contract-test important consumers/providers;
- test old-client compatibility when changing existing endpoints.

## Sources

- OpenAPI: https://spec.openapis.org/oas/latest.html
- RFC 9110: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9457: https://www.rfc-editor.org/rfc/rfc9457.html
- SemVer: https://semver.org/
