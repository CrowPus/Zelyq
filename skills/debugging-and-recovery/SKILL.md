---
name: debugging-and-recovery
description: Diagnose crashes, regressions, flaky behavior, incorrect output, and environment-specific failures by reproducing and tracing root cause. Use when the user reports something broken or intermittent.
---

# Debugging and Recovery

Repair the violated invariant at its owner. Do not begin with speculative edits.

## Build evidence

1. Restate observed behavior, expected behavior, environment, and impact.
2. Inspect the complete execution path and recent relevant history.
3. Reproduce the failure with the smallest realistic case before editing.
4. Capture the first incorrect state, not only the final exception.
5. Compare a working sibling path or prior version.
6. Form hypotheses that predict evidence and falsify them cheaply.

Distinguish cause, trigger, and symptom. A timeout may trigger the bug; ownership of partial state may be the cause; a blank UI may be the symptom.

## Repair

- Fix the producer or lifecycle owner of invalid state.
- Prefer one canonical flow over duplicated consumer guards.
- Do not hide the issue with retries, larger timeouts, swallowed errors, disabled assertions, or environment branches unless they are the real contract.
- Preserve unrelated changes.
- Make recovery from partial state idempotent and observable.

## Regression proof

Add a test that fails for the original reason. Rerun the exact reproduction, relevant siblings, and proportional checks. For races, prove the original ordering and repeat enough to exercise it. Handoff with symptom, root cause, owner, repair, evidence, uncertainty, and any operator recovery steps.
