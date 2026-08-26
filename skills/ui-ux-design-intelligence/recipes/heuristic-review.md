# Recipe: Heuristic Review

## Process

1. Define top 3–5 user tasks.
2. Walk each task screen by screen.
3. Evaluate all ten usability heuristics.
4. Record issue, evidence, severity, recommendation.
5. Separate usability issue from aesthetic preference.

## Issue template

```yaml
issue:
  screen: checkout/payment
  heuristic: error prevention
  observation: destructive "Clear cart" sits beside "Checkout" with equal visual weight
  severity: 3/4
  impact: accidental loss of cart
  recommendation: demote destructive action and add recovery/confirmation
```

## Severity
Consider:
- frequency;
- impact;
- persistence;
- recoverability.

Do not inflate every visual inconsistency into a critical UX defect.
