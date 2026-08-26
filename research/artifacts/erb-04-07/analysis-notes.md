# ERB-04-07 analysis notes

## Synthesis

- **Engineering hallucination is unsupported commitment:** Relevant forms include invented APIs or packages, false repository claims, fabricated test results, incorrect causal explanations, nonexistent permissions, and confidence not warranted by evidence.
- **Errors may be executable and plausible:** Generated code can compile or pass narrow tests while containing security weaknesses, semantic misalignment, or misuse. Fluency and local validity reduce observability to users who lack relevant expertise.
- **Sampling and model plurality do not guarantee independence:** Repeated outputs can vary, but variation is not calibrated uncertainty. Models sharing data, architectures, prompts, tools, or evaluation patterns may converge on the same wrong answer.
- **Agentic errors enlarge the consequence path:** A false statement becomes more consequential when it drives tool calls, dependency installation, credential access, or deployment. Detection must occur before irreversible or high-impact action where possible.

## Sensitivity and update triggers

Removing first-party sources weakens artifact-specific claims but leaves the construct boundaries; removing benchmark scores does not change any approved mechanism finding. A chapter review is triggered by a benchmark version change, material audit, new task contamination evidence, changed model/harness, or replicated evidence that reverses a central limitation. No claim assigns a volatile current frontier rank.

Gaps include proprietary training overlap, production incident rates, longitudinal organizational use, rare high-consequence failures, accessibility, energy cost, and comparisons with well-supported human teams.

