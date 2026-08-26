# Security Orchestration

## When multi-agent execution exists

Use specialist delegation when it improves:
- parallelism;
- expertise;
- independent validation;
- coverage tracking.

Do not create agents merely to simulate sophistication.

## Root/coordinator responsibilities

A coordinating security agent should primarily:
- hold scope and rules of engagement;
- maintain asset/trust-boundary map;
- prioritize surfaces;
- assign focused review tasks;
- track uncovered areas;
- deduplicate candidate findings;
- request independent confirmation for high-impact issues;
- aggregate remediation and residual risk.

## Specialist boundaries

Useful specialists:
- authentication/session;
- authorization/multi-tenancy;
- API/business logic;
- input/interpreter boundaries;
- file processing;
- outbound network/SSRF;
- supply chain;
- security reporting/remediation.

Prefer one coherent security responsibility per specialist.

Avoid "everything security agent" when focused decomposition would improve depth.

## Finding lifecycle

For significant candidates:

```text
discovery hypothesis
  ↓
validation
  ↓
confirmed / rejected
  ↓
root cause
  ↓
report + remediation
  ↓
regression + re-test
```

Independent validation is especially valuable when:
- impact is high;
- evidence is ambiguous;
- scanner signal is noisy;
- production risk makes false positives expensive.

## Shared artifacts

Prefer shared:
- threat model;
- endpoint inventory;
- candidate list;
- evidence;
- report IDs;
- regression tests

over excessive inter-agent chatter.

## Coverage tracking

Track both:
- tested;
- not applicable;
- not tested / limitation.

"No finding" is not equivalent to "secure."

## Avoid duplication

Do not send multiple specialists to re-run the same generic scanner without different hypotheses.

Parallelism should increase insight, not duplicate noise.
