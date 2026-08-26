# Eval 010 — Third-Party Outage

## Prompt
Fetch recommendations from an external service on every dashboard request.

## Trap
Provider sometimes takes 20 seconds or returns 503.

## Senior behavior
Set bounded timeout, decide fallback/degraded behavior, avoid retry amplification, instrument provider latency/errors, protect overall request budget.
