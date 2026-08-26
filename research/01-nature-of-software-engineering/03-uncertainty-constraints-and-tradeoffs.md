# The Engineering Research Book

## Uncertainty, constraints, and tradeoffs

Chapter ID: ERB-01-03

Version: 0.2

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Related chapters: ERB-01-01, ERB-01-02, ERB-01-04, ERB-01-05, ERB-02-05, ERB-02-06

Research artifacts: [ERB-01-03 artifacts](../artifacts/erb-01-03/)

---

## Primary research question

> Which forms of uncertainty and constraint shape software-engineering decisions, and how are tradeoffs made visible?

## Current state

The proposal and protocol were approved and executed against an initial balanced evidence set. Seven complete sources passed Gate A: an original temporal-choice study and replication, two qualitative/multiple-case decision studies, a systematic mapping study of assumptions, an authoritative architecture-tradeoff framework, and one applied avionics evaluation. Three requirements-uncertainty candidates remain access-pending and are not used as evidence. Gate B accepted five bounded findings with explicit limitations.

## Research records

- [Proposal](../artifacts/erb-01-03/proposal.md)
- [Protocol](../artifacts/erb-01-03/protocol.md)
- [Review record](../artifacts/erb-01-03/review-record.md)
- [Search log](../artifacts/erb-01-03/search-log.md)
- [Source inventory](../artifacts/erb-01-03/source-inventory.md)
- [Screening record](../artifacts/erb-01-03/screening-record.md)
- [Evidence table](../artifacts/erb-01-03/evidence-table.md)
- [Analysis notes](../artifacts/erb-01-03/analysis-notes.md)
- [Claim–evidence records](../artifacts/erb-01-03/claim-evidence-records.md)

## Findings

### Uncertainty is not one variable

The reviewed evidence uses uncertainty for different conditions: knowledge accepted without evidence, ambiguity about meaning or intent, uncertainty about delayed value, and uncertainty about how a design affects multiple qualities. These forms call for different responses. A probability estimate cannot by itself repair an ambiguous requirement, surface an implicit assumption, identify a missing stakeholder, or explain disagreement about values.

### Constraints and priorities define what is being traded

A technical alternative is not preferable in isolation. The included studies show decisions changing with time horizon, business criticality and urgency, stakeholder perspective, resource boundary, risk, and quality-attribute priority. These are not external noise around a purely technical decision; they partly define the decision being made.

### Delayed benefits are discounted unevenly

The original and replication questionnaire studies found temporal discounting in software-project choice tasks, alongside substantial differences among participants. The result is bounded to elicited preferences in stylized scenarios. It does not demonstrate how the same participants behave in live projects, whether discounting is irrational, or which mechanism causes it.

### Visibility supports examination, not correctness

The included sources use business-process mappings, task discussions, scenarios, utility trees, sensitivity points, and risk/tradeoff lists to make parts of a decision inspectable. These artifacts can reveal assumptions, alternatives, affected stakeholders, and interactions among qualities. They still inherit selection, language, facilitation, model, and evidence limits. Completing a template or using a named method is not proof that the decision is good.

### Assumptions can outlive their validity

The systematic mapping evidence shows concentrated research attention on making, describing, and evaluating assumptions in requirements and design, with less attention to maintenance. Because systems, use, and environments change, an assumption accepted earlier may no longer hold. The mapping does not establish the general effectiveness of assumption-management interventions.

## Approved findings

1. **Multiple uncertainty forms—Moderate:** The evidence distinguishes incomplete or unproven knowledge, ambiguous interpretation, uncertain future value, and uncertain quality consequences.
2. **Tradeoff construction—Moderate:** Time horizons, stakeholders, qualities, business processes, risks, and resource boundaries partly determine what the alternatives mean and which consequences count.
3. **Temporal choice—Moderate for elicited tasks, Low for live projects:** Temporal discounting recurred across the original and replication studies with substantial individual variation.
4. **Tradeoff visibility—Moderate–Low:** Decision artifacts can expose assumptions, alternatives, stakeholders, and consequences but do not settle value judgments or establish correctness.
5. **Assumption lifecycle—Moderate as a research map, Low for outcome effects:** Assumption research emphasizes early lifecycle activities, while continued validity and maintenance remain thinner.

The full evidence, confidence, and prohibited inferences are recorded in the [claim–evidence records](../artifacts/erb-01-03/claim-evidence-records.md).

## Limitations and open questions

The evidence does not supply a representative prevalence estimate for uncertainty forms or constraints. It is thin for legal, ethical, accessibility, security-specific, operational, maintenance, and ecological constraints. The temporal studies use stated-choice tasks; the group and business-priority studies use small case sets; the assumptions source maps published research rather than intervention outcomes; and the architecture-method evidence lacks a controlled effectiveness comparison.

Open questions include how tradeoff records change actual outcomes, how invalid assumptions are detected over time, when formal analysis is proportionate, how power and authority shape which constraints become visible, and how uncertainty should be communicated without producing false precision.

## Zelyq boundary

This chapter studies software engineering generally. It does not inspect Zelyq, select a design, create a product requirement, or authorize code. Later chapters may use these findings only within their recorded scope.
