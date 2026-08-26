# Edge Cases and Failure Modes

## Purpose

AI-generated software often looks plausible because the happy path is easy to demonstrate. Senior engineering shows up in the states nobody demonstrates.

OWASP Top 10:2025 introduced **Mishandling of Exceptional Conditions** as a distinct risk category, covering missing parameters, failing open, partial transactions, race conditions, resource exhaustion, unexpected environmental states, and unsafe error handling.

## Input edge cases

Consider when applicable:
- missing field;
- explicit null;
- empty string/list/object;
- whitespace-only;
- zero;
- negative;
- min/max boundary;
- just below/above boundary;
- very large input;
- invalid enum;
- unknown/extra field;
- malformed encoding;
- malformed JSON/form payload;
- duplicate values;
- unsupported file/media type;
- filename/path tricks;
- unexpected Unicode;
- mixed normalization/case;
- locale-specific formatting;
- NaN/infinity if numeric runtime permits them.

## State edge cases

- already exists;
- already deleted;
- already completed;
- stale version;
- expired state;
- state transition called twice;
- transition called out of order;
- object changed between read and write;
- related object missing;
- soft-deleted dependency;
- permission changed mid-flow.

## Time edge cases

- UTC vs local time;
- daylight-saving transitions;
- leap day;
- month/year boundary;
- midnight boundary;
- clock skew;
- expired exactly now;
- long-running operation crosses expiration boundary;
- recurring schedule around DST;
- inclusive vs exclusive date ranges.

Store/compare instants with explicit semantics. Keep user-facing timezone behavior separate from storage representation.

## Concurrency edge cases

- two create requests race;
- two updates overwrite each other;
- check-then-act race;
- duplicate event delivery;
- out-of-order event delivery;
- lock timeout/deadlock;
- transaction serialization failure;
- lost update;
- cache and database disagree temporarily.

When correctness depends on uniqueness/ordering, prefer structural enforcement or explicit concurrency control over hope.

## Network and dependency failures

Model:
- DNS failure;
- connection refused;
- timeout;
- slow response;
- malformed response;
- partial response;
- connection drops after remote side effect but before acknowledgement;
- 429/rate limit;
- 5xx;
- authentication expires;
- dependency contract changes;
- dependency succeeds but local persistence fails.

## Retry ambiguity

The dangerous case:
1. client sends a side-effecting request;
2. server applies it;
3. response is lost;
4. client retries.

For money, orders, provisioning, messages, and other non-repeatable effects, define an idempotency/deduplication strategy.

## Resource failures

- disk/quota full;
- memory pressure;
- queue backlog;
- file descriptor exhaustion;
- connection pool saturation;
- thread/worker exhaustion;
- oversized upload;
- recursive/pathological input;
- runaway query;
- unbounded pagination/export;
- infinite/huge retry loop.

Nothing user-controlled should be assumed unlimited.

## Partial failure

For every multi-step operation list the side effects in order and ask what happens after failure at each boundary.

Example:

`charge card → create order → reserve inventory → send confirmation`

A senior design specifies:
- transaction boundary;
- compensation where true rollback is impossible;
- retry behavior;
- reconciliation;
- observability.

## Fail closed

Security and integrity checks should normally fail closed: uncertainty must not grant permission or finalize an unsafe partial state.

## Error hygiene

User errors should:
- explain what the user can do next;
- avoid implementation internals;
- avoid secrets/PII;
- use stable machine-readable codes/contracts where clients depend on them.

Operator diagnostics should contain enough context to investigate without leaking credentials.

## Edge-case generation heuristic

For each noun ask:
- absent?
- malformed?
- too large/small?
- duplicated?
- stale?
- unauthorized?

For each verb ask:
- called twice?
- concurrent?
- partially completed?
- retried?
- cancelled?
- timed out?

For each dependency ask:
- slow?
- unavailable?
- malformed?
- succeeds but response is lost?
