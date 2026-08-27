# Inference Under Uncertainty

Screenshot-only cloning has hard limits.

A screenshot can reveal:
- visible geometry;
- apparent typography;
- colors;
- images;
- one state;
- one viewport.

It cannot prove:
- exact font file;
- breakpoints;
- hidden states;
- hover behavior;
- keyboard model;
- sticky behavior;
- loading/error states;
- animation timing;
- mobile behavior.

## Rule

Separate:
- observed;
- inferred;
- unknown.

Example:

```yaml
navigation:
  desktop_layout: observed
  mobile_breakpoint: unknown
  hover_state: inferred
```

Do not call unknown behavior exact.

Request/add more reference captures when available, but continue with best evidence when the task requires autonomous work.
