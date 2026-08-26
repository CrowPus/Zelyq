# The Engineering Research Book

## ERB-01-03 research protocol

Protocol version: 0.1

Status: Approved for execution

Prepared and approved: 2026-08-25

Proposal: [ERB-01-03 proposal](proposal.md)

---

## Design

Use structured, non-exhaustive evidence synthesis, conceptual comparison, and mechanism-oriented synthesis. The unit of analysis is a software-engineering decision under stated uncertainty and constraint, not a preferred method or the eventual outcome alone.

## Operational record

An included decision account must identify or permit extraction of:

- the decision object and lifecycle stage;
- the decision maker or responsible group;
- information available and missing at the relevant time;
- uncertainty, assumption, variability, ambiguity, or constraint;
- at least two alternatives or an identifiable opportunity cost;
- affected qualities, stakeholders, time horizons, or consequences;
- method or artifact used, if any; and
- evidence appropriate to the claim made.

Normative sources may define concepts or methods but cannot establish actual use or effectiveness. Retrospective reports support reported interpretation unless contemporaneous or behavioral evidence corroborates them.

## Search concepts

Combine software terms with:

- `uncertainty`, ambiguity, ignorance, assumption, incomplete information, variability;
- constraint, tradeoff, decision, alternative, rationale, priority, negotiation;
- requirements, architecture, quality attribute, technical debt, maintenance, operation;
- temporal discounting, reversibility, lock-in, option value, sunk cost;
- empirical, experiment, replication, case study, observation, survey, systematic review; and
- limitation, critique, null result, construct validity, decision quality.

## Initial query families

```text
("software engineering" OR "software development")
AND (uncertainty OR ambiguity OR assumption)
AND (decision OR tradeoff OR constraint)
```

```text
("software architecture" OR requirements)
AND ("design decision" OR tradeoff OR "quality attribute")
AND (empirical OR case OR experiment OR review)
```

```text
("technical debt" OR "intertemporal choice")
AND (decision OR prioritization OR discounting)
AND software
```

```text
(software OR "software-intensive system")
AND (uncertainty OR risk)
AND (taxonomy OR framework OR measurement OR critique)
```

## Source locations

Search ACM Digital Library, IEEE Xplore, arXiv, institutional repositories, Crossref, Google Scholar or equivalent scholarly discovery, relevant SEI material, and backward/forward citations. Prefer complete primary studies and authoritative framework sources. Use secondary syntheses as maps rather than independent confirmation of every cited result.

## Eligibility

Include sources with a material software-engineering decision or decision framework and enough method, context, or conceptual precision to bound use. Exclude sources that merely use “uncertainty,” “risk,” or “tradeoff” rhetorically; optimize an algorithm without an engineering decision; lack inspectable provenance; or address only Zelyq or a preferred AI design.

## Extraction fields

- source identity, version, access path, and license;
- setting, participants, sample, and method;
- decision object, stage, level, and time horizon;
- uncertainty and constraint type;
- alternatives, stakeholders, qualities, and consequences;
- information and assumptions visible at decision time;
- decision method or artifact;
- outcome and how it was measured;
- causal status, limitations, contrary evidence, and permitted use; and
- prohibited inference.

## Appraisal

Appraise provenance, completeness, method fit, construct validity, temporal ordering, comparison quality, outcome validity, confounding, generalizability, and dependence on related sources. Give heightened scrutiny to prescriptive methods supported only by examples and to retrospective success/failure explanations.

## Synthesis plan

Build:

1. an uncertainty vocabulary and lifecycle map;
2. a constraint and stakeholder map;
3. a decision-mechanism and tradeoff-visibility taxonomy;
4. comparisons across requirements, architecture, technical debt, and operation;
5. sensitivity checks that remove normative frameworks, self-reports, and outcome-based hindsight accounts; and
6. claim–evidence records with confidence and prohibited inferences.

## Completion and review gates

Discovery stops after two supplementary rounds add no new central uncertainty class, constraint class, decision mechanism, or material contrary account. Gate A verifies central and contrary evidence plus a deferred-source sample. Gate B reviews every claim boundary, confidence judgment, alternative explanation, and separation from later chapters. Disclosed AI-assisted review may satisfy these gates under the active methodology when model, access, decisions, and limitations are recorded.

No chapter finding, engineering implication, or code authorization exists before the gates pass.
