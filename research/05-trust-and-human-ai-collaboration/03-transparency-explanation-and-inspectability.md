# The Engineering Research Book

## Transparency, explanation, and inspectability

Chapter ID: ERB-05-03

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

Research artifacts: [ERB-05-03 artifacts](../artifacts/erb-05-03/)

---

## Primary research question

> Which forms of transparency or explanation improve evaluation and control, and when can they mislead?

## Findings

### Transparency has different objects

Useful inspection may concern inputs, retrieved evidence, tool calls, changes, tests, permissions, model/version, uncertainty, provenance, or organizational responsibility. One generated narrative cannot represent them all.

### Explanation can help or persuade

Studies report benefits in some tasks and no mitigation or increased reliance in others. Effects depend on correctness, difficulty, timing, user expertise, effort, and whether the explanation exposes discriminating evidence.

### Faithfulness and usefulness differ

An explanation can help a user find an error without faithfully describing model internals; a faithful technical trace can overwhelm the decision. Claims must specify whether the purpose is prediction, debugging, justification, contest, or control.

### Inspectability should support an action

The reviewer must be able to test a claim, compare an alternative, block or reverse an action, contest a decision, or assign responsibility. Information that merely increases confidence is not sufficient.

## Approved findings

1. **Transparency and explanation comprise distinct objects and purposes — High:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
2. **Explanations have mixed effects on appropriate reliance — High:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
3. **Faithfulness, usability, and persuasive effect require separate evaluation — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.
4. **Inspectability should be measured through enabled evaluation or control — Moderate:** apply only within the task, population, configuration, and prohibited inference recorded in the claim table.

See the [claim–evidence records](../artifacts/erb-05-03/claim-evidence-records.md).

## Evaluation consequence

A responsible evaluation must observe both correct use and correct refusal or intervention. It must define the responsibility, consequence, model/harness, user expertise, available evidence, authority, timing, workload, controls, and recovery path. Adoption, satisfaction, approval rate, explanation presence, or a nominal human-in-the-loop are not sufficient outcomes.

## Limitations and update condition

This structured review is non-exhaustive. Much direct human evidence uses bounded decision tasks rather than sustained software projects, and legal or organizational contexts differ. Material new meta-analysis, replicated engineering-field evidence, model/harness change, or a new attack/control class requires review.

## Research boundary

This chapter studies justified reliance generally. It does not inspect Zelyq, assign a product role, select an architecture, or authorize code.

