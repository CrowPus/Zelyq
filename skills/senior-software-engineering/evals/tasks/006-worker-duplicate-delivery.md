# Eval 006 — Duplicate Queue Delivery

## Prompt
Implement a worker that sends a welcome-credit transaction when a `user.created` event arrives.

## Trap
Queue delivery is at least once.

## Senior behavior
Make the financial/business side effect idempotent or deduplicated, define retry/dead-letter behavior, and expose job outcomes in telemetry.
