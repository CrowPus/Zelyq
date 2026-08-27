# Recipe: Geometry Diff

Compare the same semantic element in reference and replica.

For each element:

```text
Δx
Δy
Δwidth
Δheight
Δfont-size
Δline-height
Δpadding
Δgap
```

Diagnose ancestors before descendants when many elements share the same shift.

Rule of thumb:
- many siblings wrong → parent;
- text-only wrong → typography;
- one asset wrong → crop/intrinsic sizing;
- everything scaled → viewport/DPR/root sizing.
