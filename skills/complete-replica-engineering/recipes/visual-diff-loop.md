# Recipe: Visual Diff Loop

1. capture deterministic reference;
2. capture replica under same contract;
3. generate diff;
4. identify largest changed region;
5. classify root cause;
6. patch;
7. recapture;
8. repeat.

Do not fix five unrelated micro-details per pass.

Prefer the highest-cascade correction first.
