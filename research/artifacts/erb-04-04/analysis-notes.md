# ERB-04-04 analysis notes

## Synthesis

- **Tool performance belongs to the interface configuration:** Tool descriptions, available actions, output size, error signaling, environment state, model version, and interaction policy materially affect results. A model leaderboard cannot isolate these effects.
- **Correct calls include authority and state:** Selecting a tool and forming valid arguments are insufficient if the action exceeds permission, targets the wrong state, leaks data, or cannot be reversed. Functional and policy correctness must both be evaluated.
- **Environment output is evidence and an attack surface:** Logs, files, issues, dependencies, and web results can inform action while containing errors or hostile instructions. The system must preserve the authority hierarchy rather than treating observed text as commands.
- **Safe interaction needs enforced boundaries:** Least privilege, sandboxing, explicit targets, previews, approvals, idempotence where possible, audit logs, and rollback reduce consequences. Prompt instruction alone is not an enforcement boundary.

## Sensitivity and update triggers

Removing first-party sources weakens artifact-specific claims but leaves the construct boundaries; removing benchmark scores does not change any approved mechanism finding. A chapter review is triggered by a benchmark version change, material audit, new task contamination evidence, changed model/harness, or replicated evidence that reverses a central limitation. No claim assigns a volatile current frontier rank.

Gaps include proprietary training overlap, production incident rates, longitudinal organizational use, rare high-consequence failures, accessibility, energy cost, and comparisons with well-supported human teams.

