# ERB-04-06 analysis notes

## Synthesis

- **Verification is claim-relative:** Syntax, type checks, tests, static analysis, security analysis, differential behavior, review, and operational observation answer different questions. Passing available tests does not establish requirements, security, maintainability, or absence of regressions.
- **The verifier can be wrong:** The 2026 SWE-bench audit found material task specification or test issues among audited inconsistent cases. Evaluation must validate or triangulate the oracle rather than treating executable output as infallible.
- **Self-critique is not independent evidence:** The same model can repeat its assumptions, accept a false premise, or overcorrect. Intrinsic correction sometimes improves bounded tasks, but external observations and independently derived checks provide stronger discrimination.
- **Recovery requires state and consequence control:** A capable recovery identifies failure, stops unsafe propagation, preserves evidence, restores or rolls back state, revises the causal model, retries within bounds, and escalates when uncertainty or authority requires it.

## Sensitivity and update triggers

Removing first-party sources weakens artifact-specific claims but leaves the construct boundaries; removing benchmark scores does not change any approved mechanism finding. A chapter review is triggered by a benchmark version change, material audit, new task contamination evidence, changed model/harness, or replicated evidence that reverses a central limitation. No claim assigns a volatile current frontier rank.

Gaps include proprietary training overlap, production incident rates, longitudinal organizational use, rare high-consequence failures, accessibility, energy cost, and comparisons with well-supported human teams.

