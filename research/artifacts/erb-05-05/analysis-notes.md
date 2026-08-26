# ERB-05-05 analysis notes

## Synthesis

- **Predictability is conditional, not identical output:** Useful predictability means a bounded distribution of actions, failures, costs, and escalation under stated conditions. Stochastic variation can coexist with reliable outcomes; deterministic repetition can reproduce a systematic error.
- **Reversibility is designed before action:** A claimed undo needs captured pre-state, bounded side effects, controlled dependencies, retained authority, tested restoration, and a time window. Some disclosures, external messages, migrations, and physical consequences cannot be undone.
- **Recovery is a capability, not a retry:** Recovery includes detection, containment, evidence preservation, state restoration or compensation, revised diagnosis, bounded retry, communication, and escalation. Repeating the same process may amplify harm.
- **Reliance should shrink with irreversibility and uncertainty:** As potential consequence grows and rollback weakens, stronger pre-action evidence, narrower authority, independent control, and human decision are justified. This is a risk principle, not a universal numeric formula.

## Sensitivity and gaps

Removing non-engineering experiments lowers directness but leaves human-factors mechanisms and engineering-specific risk boundaries. Removing first-party frameworks leaves experimental findings but weakens governance vocabulary. Mixed explanation and collaboration results are preserved rather than averaged into a universal recommendation. Evidence remains thin for longitudinal software teams, accessibility, power differences, organizational incentives, field incidents, and skill retention.

