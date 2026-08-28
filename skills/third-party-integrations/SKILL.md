---
name: third-party-integrations
description: Integrate external APIs, SDKs, SaaS services, OAuth providers, and webhooks using their real contracts. Use when application behavior crosses an external service boundary.
---

# Third-Party Integrations

An integration is a failure boundary and a changing contract, not merely an SDK call.

## Contract discovery

Inspect the installed SDK version and its types/source. When authoritative documentation is available, verify endpoints, authentication, scopes, limits, pagination, webhook semantics, error shapes, and deprecations. Do not infer a vendor contract from memory or a wrapper.

Record credential type and scopes, environment/base URL, wire shapes, limits, timeout/retry/idempotency rules, pagination, webhook guarantees, and relevant privacy impact.

## Implementation

- Keep credentials server-side and out of logs, URLs, browser bundles, and persisted errors.
- Isolate meaningful vendor mapping behind a narrow adapter.
- Set timeouts and cancellation; retry only transient safe operations with bounded backoff and jitter.
- Use provider idempotency keys for retried writes when supported.
- Preserve useful local state during temporary read outages, clearly labeling staleness.
- Normalize errors into actionable product behavior while retaining safe diagnostics.
- Handle pagination completely or expose it deliberately.

## Webhooks and proof

Verify signatures against the raw body, deduplicate, tolerate reordering, and make handlers replay-safe. Test success, auth failure, rate limiting, timeout, malformed response, duplicates, pagination, and outage. Perform sanitized sandbox/live verification when feasible and state when external proof was impossible.
