# The Engineering Research Book

## ERB-01-01 Gate B author pre-review

Record version: 0.1

Status: Complete with corrections — not an independent review

Review date: 2026-08-25

---

## Purpose and limitation

This record applies the methodological, evidence, software-engineering domain, and editorial review criteria before the packet is sent to an independent reviewer. The reviewer is the same AI-assisted researcher that prepared the analysis and chapter synthesis. It can identify and correct internal defects, but it cannot satisfy the independence requirement or approve the proposed findings.

Human accountability and an independent Gate B assessment remain required.

## Materials examined

- [Approved protocol](protocol.md), version 0.1
- [Protocol amendment](protocol-amendments.md), version 0.2
- [Evidence table](evidence-table.md), version 1.1
- [Gate A review record](review-record.md), version 0.8 before this pre-review update
- [Analysis notes](analysis-notes.md), version 0.2
- [Claim–evidence records](claim-evidence-records.md), version 0.2 before corrections
- [Chapter draft](../../01-nature-of-software-engineering/01-software-engineering-and-programming.md), version 0.5 before corrections
- [Research methodology](../../00-front-matter/06-research-methodology.md)
- [Evidence standard](../../00-front-matter/07-evidence-standard.md)
- [Contribution guide](../../00-front-matter/08-contribution-guide.md)
- [Editorial style guide](../../STYLE_GUIDE.md)

## Methodological pre-review

Decision: **Pass to independent review with limitations**

Checks completed:

- The synthesis follows the four protocol stages: definition map, responsibility taxonomy, boundary analysis, and outcome evidence map.
- The relevance-adapted extraction format is covered by ratified Amendment A001.
- Normative, historical, observed, self-reported, repository-derived, replication, and meta-analytic evidence remain separated.
- Contrary evidence, plausible alternatives, unavailable sources, and source dependencies remain visible.
- Eight protocol sensitivity checks have a recorded procedure, result, and effect on interpretation.
- The taxonomy is explicitly provisional and non-canonical.
- The analysis does not use source count as a quality score.

Limitations retained for independent review:

- The search supports a structured, bounded synthesis rather than a claim of comprehensive literature coverage.
- The programming construct is not operationalized by an included source.
- No included study directly compares the complete responsibility and outcome profiles of programmers and software engineers.
- The author performed both the initial synthesis and this pre-review.

## Evidence pre-review

Decision: **Pass to independent review after PBR-01 and PBR-02 corrections**

Checks completed:

- Every proposed finding links to a claim–evidence record.
- Every materially used source passed Gate A or is explicitly excluded from evidentiary use.
- S002 is described only as an uninspected underlying source quoted second-hand by S001.
- S013 is not used as evidence and its absence lowers the requirements strand.
- S010/S011 and S014/S015 remain jointly synthesized.
- Self-reported requirements consequences are not converted into causal effects.
- Unstable review associations are not converted into evidence that review has no value.
- Testing qualifications are not converted into evidence that testing has no value.
- The general comparative outcome receives an Insufficient judgment rather than an unsupported null conclusion.

### PBR-01 — Knowledge-need wording

Concern: CER-04 and the proposed-findings summary said that changing software “required” participants to obtain knowledge beyond code. The relevant evidence observes information seeking and records reported difficulties; “required” can imply a stronger necessity claim than these methods establish.

Correction: replace the proposed finding with a source-proportionate statement that participants sought or reported needing rationale, dependency, coordination, and system knowledge beyond the code being modified.

Status: Resolved in claim–evidence records version 0.3 and chapter version 0.6.

### PBR-02 — Citation proximity in synthesis prose

Concern: the activity-breadth and knowledge-coordination paragraphs named S006–S009 without links at the point of material use, even though the sources were linked earlier in the chapter.

Correction: add source-record links to those synthesis paragraphs so readers can move directly from claim to extraction and original-source location.

Status: Resolved in chapter version 0.6.

## Software-engineering domain pre-review

Decision: **Pass to independent domain review with unresolved construct questions**

Checks completed:

- Construction is treated as necessary work, not as an inferior or purely mechanical activity.
- Programming is not silently equated with typing code.
- Responsibility breadth is not assigned exclusively to one occupational title.
- Team-level responsibility is not confused with a requirement that every individual perform every domain.
- Review and testing are discussed through execution, expertise, context, measurement, and outcome evaluation rather than ceremonial process compliance.
- The historical multi-person/multi-version account remains attributed and contested.

Questions reserved for an independent domain reviewer:

- Does the provisional taxonomy omit a responsibility domain that would materially alter the synthesis?
- Does “construction” remain too narrow or too broad for the source communities represented?
- Are operations, security, safety, privacy, and professional accountability too dependent on framework sources to appear in the taxonomy even with the current qualification?
- Does the boundary analysis adequately represent settings where programming itself includes full lifecycle accountability?

## Editorial pre-review

Decision: **Pass to independent editorial review after PBR-03 correction**

Checks completed:

- The chapter leads from the research question through evidence, analysis, proposals, implications, limitations, and approval state.
- Confidence language matches the proposed ratings.
- Source results and book interpretation use distinguishable language.
- The responsibility table is introduced and its non-canonical status is explained.
- The prose avoids promotional claims, occupational hierarchy, and false opposition.
- Research implications and Zelyq engineering authorization remain separate.
- Internal links and Markdown structure were checked mechanically.

### PBR-03 — Overbroad status warning

Concern: the current-state warning said no statement in the chapter should be treated as a research finding. The chapter also contains procedural facts and source reports; the warning should apply specifically to proposed conclusions.

Correction: narrow the warning to proposed conclusions and confidence judgments.

Status: Resolved in chapter version 0.6.

## Confidence pre-review

| Record | Proposed confidence | Pre-review assessment |
| --- | --- | --- |
| CER-01 | High | Proportionate only because the claim is restricted to the documented content of two frameworks |
| CER-02 | Moderate | Proportionate to cross-method descriptive convergence and contextual limitations |
| CER-03 | Low | Required by missing programming definition, missing comparison, and viable alternatives |
| CER-04 | Moderate | Proportionate after removing necessity language and retaining setting limits |
| CER-05 | Low | Required by single-family self-report evidence and missing S013 corroboration |
| CER-06 | Moderate | Proportionate for instability in the paired analyses, not review effectiveness generally |
| CER-07 | Low | Required by heterogeneous constructs and inability to infer general testing effects |
| CER-08 | Insufficient | Required because no included design answers the complete comparative outcome question |

## Pre-review conclusion

The Gate B packet is internally ready for independent review after three corrections. This pre-review does not accept a finding, complete a required review role, authorize publication, or create a Zelyq engineering implication.

## AI involvement

System: OpenAI Codex; model version not exposed in the session interface.

Task: apply the book's four review criteria to the Gate B packet, identify internal objections, and correct bounded wording and citation defects.

Human verification required: independently assess the source-to-finding reasoning, confidence ratings, domain completeness, and editorial presentation before ratification.
