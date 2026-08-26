# The Engineering Research Book

## Predictability, reversibility, and recovery

Chapter ID: ERB-05-05

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-05-05 artifacts](../artifacts/erb-05-05/)

---

## Primary research question

> How do predictable behavior, reversible actions, and recovery mechanisms affect justified reliance?

## Findings

### Predictability is conditional, not identical output

Useful predictability means a bounded distribution of actions, failures, costs, and escalation under stated conditions. Stochastic variation can coexist with reliable outcomes; deterministic repetition can reproduce a systematic error.

### Reversibility is designed before action

A claimed undo needs captured pre-state, bounded side effects, controlled dependencies, retained authority, tested restoration, and a time window. Some disclosures, external messages, migrations, and physical consequences cannot be undone.

### Recovery is a capability, not a retry

Recovery includes detection, containment, evidence preservation, state restoration or compensation, revised diagnosis, bounded retry, communication, and escalation. Repeating the same process may amplify harm.

### Reliance should shrink with irreversibility and uncertainty

As potential consequence grows and rollback weakens, stronger pre-action evidence, narrower authority, independent control, and human decision are justified. This is a risk principle, not a universal numeric formula.

## Approved findings

1. **Predictability concerns outcome distributions under conditions, not identical text — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
2. **Reversibility requires pre-state, side-effect, and restoration evidence — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
3. **Retrying alone is not recovery — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
4. **Irreversible or high-impact action warrants stronger pre-action controls — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.

See the [claim–evidence records](../artifacts/erb-05-05/claim-evidence-records.md).

## Evaluation consequence

A responsible evaluation must observe both correct use and correct refusal or intervention. It must define the responsibility, consequence, model/harness, user expertise, available evidence, authority, timing, workload, controls, and recovery path. Adoption, satisfaction, approval rate, explanation presence, or a nominal human-in-the-loop are not sufficient outcomes.

## Limitations and update condition

This structured review is non-exhaustive. Much direct human evidence uses bounded decision tasks rather than sustained software projects, and legal or organizational contexts differ. Material new meta-analysis, replicated engineering-field evidence, model/harness change, or a new attack/control class requires review.

## Research boundary

This chapter studies justified reliance generally. It does not inspect Zelyq, assign a product role, select an architecture, or authorize code.

