---
name: backend-api-engineering
description: Build or modify HTTP APIs, server actions, webhooks, and backend services with stable contracts and correct failure behavior. Use for server-side endpoint work; do not activate for frontend-only API consumption.
---

# Backend API Engineering

Treat the endpoint as a public contract and the service boundary as the owner of business invariants.

## Before editing

Trace router, authentication, validation, service, persistence, external calls, response mapping, callers, and tests. Reuse established error envelopes, middleware, serialization, pagination, and dependency injection.

Define method/path, actor and permission, input normalization, success response, stable errors, idempotency, transaction boundary, limits, timeouts, pagination, and compatibility impact.

## Implementation rules

- Validate untrusted input at the boundary; enforce business invariants in the owning service or database.
- Authorize the requested resource, not only the route.
- Keep handlers thin and policy canonical.
- Use transactions for state that must change atomically.
- Make retryable writes idempotent when duplicate execution is plausible.
- Bound body size, page size, fan-out, file size, and external waits.
- Do not expose stack traces, secrets, database errors, or upstream response bodies.
- Preserve response shapes unless a deliberate versioned break is requested.

## Webhooks and callbacks

Verify authenticity using the provider’s documented raw-body procedure. Record a delivery identifier before side effects, reject replays or process idempotently, acknowledge only after the chosen durability boundary, and tolerate reordered delivery.

## Verification

Cover success, malformed input, missing authentication, forbidden access, missing resources, conflicts, dependency failure, duplicates/retries, and transaction rollback. Prefer real router/service/database integration over assertions on handler internals. Verify the exact wire response and safe diagnostics.
