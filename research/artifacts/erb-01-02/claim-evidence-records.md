# The Engineering Research Book

## ERB-01-02 claim–evidence records

Record version: 0.2

Status: Gate B reviewed — four findings accepted; CER-04 restricted to an open hypothesis

### CER-01 — Software behavior emerges through dependency-mediated interaction

Bounded finding: In the studied software settings, technical dependencies become behaviorally consequential through work allocation, expertise, communication, coordination, and feedback. Neither the technical graph nor the organization alone fully describes the observed work.

Support: S030, S032, S057, S093. Qualification: S016 finds that one file-level communication/dependency congruence measure does not meaningfully predict bugs or churn.

Confidence: **Moderate, provisional.** Multiple direct software studies support the interaction pattern, but designs are observational or self-reported and use heterogeneous constructs.

Prohibited inference: every dependency requires communication; increasing communication improves quality; sociotechnical congruence predicts bugs.

### CER-02 — Coordination artifacts alter what participants can perceive and act upon

Bounded finding: Shared views, histories, chat systems, logs, monitoring, and other coordination artifacts shape awareness by selecting and organizing information. Their value depends on task, role, scale, interpretability, timing, and information cost.

Support: S029, S030, S031, S032, S093.

Confidence: **Moderate, provisional.** Mechanism recurs across sources, but only S029 directly evaluates alternative interfaces and does so in a narrow task.

Prohibited inference: dashboards or increased visibility automatically improve coordination; all information should be exposed to everyone.

### CER-03 — Software systems and organizations co-adjust rather than align once

Bounded finding: Architecture, deployment practices, team responsibilities, operational roles, and coordination arrangements are repeatedly adjusted as dependencies, environments, and work change.

Support: S032, S057, S093. S002 supplied unverified conceptual context and is not load-bearing.

Confidence: **Moderate–Low, provisional.** Temporal and cross-setting support exists, but much evidence is participant interpretation rather than measured reciprocal causation.

Prohibited inference: one stable organizational design or architecture is universally optimal.

### CER-04 — Open hypothesis: local reliability or optimization may diverge from system-level benefit

Open hypothesis: Actions that improve a component, role, team, or firm may move burdens or interact with wider coupling and feedback so that the overall effect differs from the local effect.

Potential support: S002 and S130 are both `Unable to verify` in Gate A. S038 supplies theoretical qualification and S093 supplies bounded operational examples, but neither independently establishes the cross-level claim.

Confidence: **Insufficient for a reviewed finding.** The strongest specialized market case, S130, was inaccessible to the reviewer. This record is retained as an explicit research question and must not be presented as an accepted chapter finding.

Prohibited inference: local improvements usually harm the whole or complex-system accidents are inevitable.

### CER-05 — “Sociotechnical” is useful only when constructs and boundaries are testable

Bounded finding: A sociotechnical explanation adds value when it specifies technical and nontechnical elements, their relationship, system boundary, level, temporal path, and outcome. Merely naming context or computing a narrow congruence score is insufficient.

Support: S016 and S080; boundary and theory support from verified S038. S130 is not load-bearing.

Confidence: **Moderate, provisional.** Direct contrary evidence and conceptual criticism converge, but the criteria remain an analytic judgment requiring independent review.

Prohibited inference: sociotechnical analysis is always superior to technical, organizational, process, or ecological alternatives.

## Sensitivity checks

- Removing foundational/normative S002 leaves CER-01, CER-02, CER-03, and CER-05 intact, though historical framing weakens.
- Removing incident/safety sources S038 and S130 leaves the four ordinary-work findings intact and leaves CER-04 as an unsupported open hypothesis.
- S016 prevents a universal congruence-to-quality finding.
- Narrow boundaries explain local coordination but can miss organization/environment effects; broad boundaries add context but risk unfalsifiable explanation.
- None of the five records authorizes Zelyq engineering policy or code.
