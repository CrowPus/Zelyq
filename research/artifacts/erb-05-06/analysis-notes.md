# ERB-05-06 analysis notes

## Synthesis

- **Authority must be explicit and least-privileged:** Responsible operation identifies allowed subjects, objects, actions, environments, duration, purpose, and approval/escalation boundaries. Natural-language permission is not sufficient enforcement.
- **Data flow needs provenance and minimization:** Context ingestion, prompts, retrieval, logs, memory, model providers, tools, outputs, and telemetry form a data path. Only necessary data should cross each boundary, with retention, access, deletion, and incident rules.
- **Instructions and data cannot be assumed separable by the model:** Prompt-injection benchmarks show that untrusted content can redirect tool-using systems. Architectural control/data separation, scoped credentials, sandboxing, validation, and egress constraints are necessary defense layers.
- **Responsibility remains human and institutional:** A model cannot absorb legal, moral, or operational accountability by being named an agent. Deployers must assign decision owners, control owners, incident responders, affected-party redress, and public/organizational accountability.
- **Privacy risk exists at input, memory, and model levels:** Sensitive project context can leak through tools, logs, outputs, or retained memory; training data can be extractable in studied models. Absence of an observed leak is not proof of privacy.

## Sensitivity and gaps

Removing non-engineering experiments lowers directness but leaves human-factors mechanisms and engineering-specific risk boundaries. Removing first-party frameworks leaves experimental findings but weakens governance vocabulary. Mixed explanation and collaboration results are preserved rather than averaged into a universal recommendation. Evidence remains thin for longitudinal software teams, accessibility, power differences, organizational incentives, field incidents, and skill retention.

