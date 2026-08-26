# Profile: API Service

Activate for HTTP/RPC service boundaries.

## Required lenses

- explicit contract/schema;
- auth/authz at resource boundary;
- HTTP/status semantics;
- idempotency/retry safety;
- pagination/limits;
- timeouts;
- rate/resource limits;
- error contract;
- backward compatibility;
- structured logs/metrics/traces;
- dependency failure;
- health/readiness;
- deployment overlap.

## API edge cases

- missing auth;
- expired auth;
- wrong tenant/resource owner;
- malformed body;
- unsupported media type;
- unknown field policy;
- duplicate request;
- request replay;
- page-size abuse;
- concurrent update;
- dependency timeout;
- 429 handling;
- old client payload;
- new server with old worker/client.

## Contract ownership

If external/internal consumers depend on the API, update machine-readable schema and verify compatibility.

Load `references/api-and-contracts.md`, security, reliability, and observability.
