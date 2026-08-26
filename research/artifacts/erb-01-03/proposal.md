# The Engineering Research Book

## ERB-01-03 research proposal

Proposal version: 0.1

Status: Approved for protocol design

Prepared and approved: 2026-08-25

Chapter: [ERB-01-03 — Uncertainty, constraints, and tradeoffs](../../01-nature-of-software-engineering/03-uncertainty-constraints-and-tradeoffs.md)

---

## Primary research question

> Which forms of uncertainty and constraint shape software-engineering decisions, and how are tradeoffs made visible?

## Supporting questions

1. What do software-engineering sources mean by uncertainty, risk, ambiguity, assumption, ignorance, variability, and constraint?
2. Where do these conditions arise across requirements, design, construction, verification, deployment, operation, maintenance, and evolution?
3. Which constraints are technical, economic, temporal, organizational, legal, ethical, environmental, cognitive, or evidential?
4. How do engineers identify alternatives, affected qualities and stakeholders, opportunity costs, reversibility, and deferred consequences?
5. Which artifacts or practices make tradeoffs and uncertainty inspectable, and what do they fail to represent?
6. How do time pressure, sunk cost, temporal discounting, incentives, authority, experience, and group interaction affect decisions?
7. Which empirical evidence connects explicit uncertainty or tradeoff treatment to decision quality or outcomes?
8. Where are formal models disproportionate, misleading, or unsupported by the available information?

## Purpose and expected contribution

Software engineering decisions are made before complete knowledge is available and under constraints that cannot all be optimized simultaneously. The chapter will produce a bounded vocabulary, lifecycle map, constraint map, tradeoff-record map, evidence synthesis, and set of confidence-rated findings. It will separate observed decision behavior from normative methods and will not assume that making a tradeoff visible makes the decision correct.

## Included scope

- requirements, architectural, implementation, testing, release, operation, maintenance, and evolution decisions;
- epistemic uncertainty, variability, ambiguity, incomplete information, assumptions, forecast error, and unknowns;
- resource, schedule, compatibility, quality, security, safety, legal, organizational, and environmental constraints;
- quality-attribute and stakeholder tradeoffs;
- reversibility, option value, lock-in, technical debt, and intertemporal choice;
- individual and group decision processes;
- decision records, models, prototypes, experiments, scenarios, sensitivity analysis, and other uncertainty-reduction mechanisms;
- empirical studies, experiments, case studies, observational research, replications, systematic reviews, and clearly bounded normative frameworks; and
- null results, criticism, failure cases, and evidence that formal tradeoff methods are not used or do not improve outcomes.

## Excluded scope

- a general theory of human decision-making without a material software-engineering connection;
- detailed requirements elicitation, which belongs to ERB-02-03;
- complete architecture-decision practice, which belongs to ERB-02-05;
- complete risk-management practice, which belongs to ERB-02-06;
- hindsight narratives that do not preserve information available when the decision was made;
- equating uncertainty with measurable probability;
- treating schedule, cost, or stakeholder preference as objective constants;
- AI capability evaluation; and
- any Zelyq design, requirement, architecture, workflow, or code decision.

## Research mode

The chapter combines structured evidence synthesis, conceptual analysis, and decision-mechanism synthesis. It is non-exhaustive unless the completed search record supports a stronger description.

## Bias and integrity controls

- Record the information and alternatives available at decision time to reduce hindsight bias.
- Separate normative frameworks from observations of actual practice.
- Preserve null, contradictory, and replication evidence.
- Do not count related studies or framework restatements as independent votes.
- Appraise construct validity for uncertainty, decision quality, technical debt, and outcome measures.
- Search for ordinary decisions as well as high-profile failures.
- Record inaccessible sources and do not infer their contents from abstracts.
- Disclose material AI involvement under the book methodology.

## Approval decision

Decision: **Approved for protocol design and execution preparation.**

Basis: the question is necessary to Part I, bounded away from later practice chapters, researchable using mixed evidence, and explicitly independent of Zelyq.

This approval does not approve a finding or authorize engineering or code.
