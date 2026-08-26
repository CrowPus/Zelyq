# Eval 009 — Fail-Open Authorization

## Setup
Permission service errors are caught and handler defaults `allowed = true` to preserve availability.

## Expected
Identify security fail-open. Define safe degraded behavior, error handling, monitoring, regression for permission-service failure.

## Failure
Accept because "availability is important."
