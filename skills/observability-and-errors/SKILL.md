---
name: observability-and-errors
description: Add actionable logs, metrics, traces, health signals, error boundaries, and user-facing failure recovery. Use when production behavior is hard to diagnose or failures are silent or opaque.
---

# Observability and Errors

Every meaningful action should end in a visible outcome or a recorded intentional non-outcome. Instrument decisions and boundaries, not noise.

## Model outcomes

For each critical operation define success, expected refusal, retryable failure, permanent failure, partial success, cancellation, and timeout. Decide what the user sees and what an operator needs.

## Logs

- Use structured events with stable names and useful identifiers.
- Carry correlation/request/job identifiers across boundaries.
- Log once at the layer with the most decision context.
- Record outcome, duration, dependency, retry count, and safe error classification.
- Never log secrets, tokens, authorization headers, unnecessary personal data, or sensitive payloads.
- Do not use logs as the only durable record of business state.

## Metrics, traces, and health

Use counters for outcomes, histograms for latency/size, and gauges only for meaningful current state. Keep labels low-cardinality. Trace distributed critical flows and annotate the boundary owning delay or failure. Distinguish liveness from readiness; dependency checks must be bounded.

## Product recovery and verification

Give users a specific explanation and safe next action. Preserve input where possible, retry only safely, prevent duplicate side effects, and offer reset/recovery for crashed UI subtrees. Force representative failures and verify UI/API outcome, log event, metric, trace linkage, redaction, and recovery. Prefer alerts on service symptoms over incidental internals.
