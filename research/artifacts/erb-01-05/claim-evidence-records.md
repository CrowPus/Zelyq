# ERB-01-05 claim–evidence records

| Finding | Evidence | Confidence | Prohibited inference |
| --- | --- | --- | --- |
| Continued effectiveness requires continued fit with a changing environment | S001, S002 | Moderate | every system must grow indefinitely |
| Change can restore fit and also introduce deterioration | S001–S003 | Moderate–Low | complexity or quality always changes monotonically |
| Dependency evolution can break unchanged clients | S004 | Moderate in studied npm scope | semantic-version violations explain every failure |
| Failures can arise from interacting technical and organizational controls | S005 | Moderate for mechanism, Low for prevalence | all accidents resemble Therac-25 or have one root cause |
| Redundancy is unsafe to model as automatically independent | S006 | Moderate for tested assumption | diverse implementations never improve reliability |
| Success is provisional and must be monitored against explicit outcomes | synthesis of S001–S005 | Moderate–Low | monitoring alone prevents failure |

Gate B: **Pass with limitations.** Universal “laws,” single-root-cause language, and permanent-correctness claims were rejected.
