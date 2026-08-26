# The Engineering Research Book

## Part IV synthesis — AI capabilities and limits

Part ID: ERB-04

Version: 0.1

Status: Reviewed — Part exit criterion passed with limitations

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

---

## Synthesis

As of the observation cutoff, configured AI systems demonstrate genuine but uneven ability to retrieve repository information, produce and modify code, resolve some issue-based tasks, use tools, construct plans, retain selected information, critique outputs, and complete portions of multi-step technical work. These demonstrations establish possibilities under recorded conditions. They do not establish autonomous software-engineering partnership across the lifecycle defined in Parts I–III.

The correct unit of capability is:

```text
model snapshot
  + agent harness and prompts
  + available context and retrieval
  + tools, permissions, and environment
  + memory and state mechanisms
  + verifier and recovery policy
  + task distribution and attempt budget
  + observation date
```

Changing one component can change both success and failure. Statements such as “the model understands the repository” or “the agent can engineer software” are therefore too broad without a defined probe and configuration.

## Demonstrated and not demonstrated

Reviewed benchmarks directly demonstrate bounded task performance: function retrieval, repository question answering, patch production, tool interaction, constraint handling, memory retrieval, and human-calibrated task completion. They do not by themselves demonstrate correct problem selection, stakeholder legitimacy, complete system understanding, secure operation, maintainability, calibrated uncertainty, organizational learning, or durable field reliability.

Capability decreases or becomes harder to observe when relevant context is difficult to select, tasks extend across many dependent steps, constraints accumulate, environment content is untrusted, memory becomes stale or ambiguous, verifiers are incomplete, or plausible errors pass narrow checks. Agentic authority converts informational error into potential state change, disclosure, or supply-chain harm.

## Reliability ladder

Part IV distinguishes:

1. **Plausibility:** an output appears relevant.
2. **Possibility:** at least one run completes a defined task under recorded conditions.
3. **Repeatability:** repeated runs under the same conditions succeed with stated uncertainty.
4. **Robustness:** performance survives relevant variation and adversarial or failure conditions.
5. **Field reliability:** monitored use in the intended environment meets an outcome threshold over time.
6. **Trustworthy conduct:** the system also respects authorization, security, uncertainty, accountability, and recovery requirements.

Evidence at one level cannot silently support the next.

## Evaluation implications

AI-assisted engineering evaluation must use a portfolio mapped to responsibilities. It should include context probes, cross-file consequence predictions, plan perturbations, tool-policy conflicts, memory update and deletion, independent verification, injected faults, prompt-injection and permission tests, rollback, escalation, repeated trials, and operational observation where deployment is in scope.

Benchmark tasks and oracles themselves require audit. Public performance can be affected by contamination, harness optimization, task defects, saturation, and selective reporting. Scores need version, configuration, date, uncertainty, failure distribution, and cost—not only an average.

## Limitations and exit decision

The evidence is changing rapidly and is strongest for public benchmarks rather than long-term production work. Proprietary training data, deployment incidents, user-selection effects, and rare severe failures are incompletely observable. The part therefore does not rank current products or declare a generally capable engineering agent.

Within those boundaries, Part IV meets its exit criterion: it distinguishes demonstrated capability from plausible extrapolation, records observed limitations rather than assumed ones, and separates measured task performance from anecdotal success. All changeable claims carry the August 25, 2026 evidence cutoff.

This synthesis is not a Zelyq design or implementation authorization.
