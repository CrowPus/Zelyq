# The Engineering Research Book

## Allocation of work between humans and AI

Chapter ID: ERB-05-07

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-05-07 artifacts](../artifacts/erb-05-07/)

---

## Primary research question

> How should engineering responsibilities be allocated or shared so that automation supports rather than obscures human judgment and accountability?

## Findings

### Combination does not guarantee synergy

The meta-analysis found human–AI combinations heterogeneous and, on average, not superior to the stronger solo performer, while augmentation relative to humans alone was common. Allocation must be tested rather than justified by complementarity rhetoric.

### Allocate by comparative error and consequence

A useful allocation asks which actor has better evidence and discrimination for the task slice, whether their errors differ, how handoffs preserve context, and who can detect and recover from failure.

### Keep responsibility with corresponding control

A person assigned accountability needs information, competence, time, authority, and feasible intervention. Delegating work while retaining ceremonial sign-off creates an accountability sink.

### Preserve human learning and independent judgment

If AI generates the frame, solution, evidence, and review, apparent efficiency can remove independent challenge and skill practice. Work design should deliberately retain tasks that build system understanding and consequence-aware judgment.

### Allocation must adapt

Capabilities, workload, system state, and consequences change. Allocation should be observable, reversible, monitored, and revisited after failures or material model/harness updates.

## Approved findings

1. **Human–AI combinations do not automatically outperform the stronger member — High across reviewed experiment set:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
2. **Allocation should use comparative errors, evidence, and consequences — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
3. **Accountability requires corresponding information and control — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
4. **Work design should preserve independent judgment and learning — Moderate–Low:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
5. **Allocation requires monitoring and revision as configurations change — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.

See the [claim–evidence records](../artifacts/erb-05-07/claim-evidence-records.md).

## Evaluation consequence

A responsible evaluation must observe both correct use and correct refusal or intervention. It must define the responsibility, consequence, model/harness, user expertise, available evidence, authority, timing, workload, controls, and recovery path. Adoption, satisfaction, approval rate, explanation presence, or a nominal human-in-the-loop are not sufficient outcomes.

## Limitations and update condition

This structured review is non-exhaustive. Much direct human evidence uses bounded decision tasks rather than sustained software projects, and legal or organizational contexts differ. Material new meta-analysis, replicated engineering-field evidence, model/harness change, or a new attack/control class requires review.

## Research boundary

This chapter studies justified reliance generally. It does not inspect Zelyq, assign a product role, select an architecture, or authorize code.

