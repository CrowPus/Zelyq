# The Engineering Research Book

## Research-to-code governance

Version: 1.1

Status: Active

Approved by: Mohamed Sesay, Zelyq founder

Approval date: 2026-08-25

---

## Purpose

This policy defines how research in The Engineering Research Book becomes authorized engineering work in Zelyq.

The governing rule is:

> No code work begins without an accepted reason recorded in the book.

An idea, request, competitor feature, personal preference, or technically possible change is not sufficient authorization. Before implementation begins, the underlying problem, relevant evidence, proposed response, alternatives, risks, and evaluation plan must pass the review appropriate to the change.

The purpose is not to make coding slow for its own sake. It is to ensure that Zelyq spends engineering effort on understood problems, preserves the reasoning behind decisions, and can revise those decisions when evidence changes.

## Two layers of the book

The book contains two connected but distinct layers.

### Research layer

The research layer investigates software engineering, AI, trust, and related questions without being required to support Zelyq's current direction. Its outputs are reviewed findings with explicit scope, evidence, confidence, and limitations.

Research may conclude that evidence is insufficient, that a proposed capability is unsafe or unnecessary, or that several interpretations remain plausible.

### Engineering application layer

The engineering application layer records how Zelyq applies reviewed research to a specific problem and context. Its primary unit is a **Zelyq engineering entry**.

An engineering entry is not a research finding. It is a governed decision record that cites findings, adds project-specific constraints and judgment, compares responses, and defines what—if anything—is authorized for implementation.

Keeping the layers distinct prevents product preferences from being presented as facts while still making the book the required starting point for code.

## Complete traceability chain

Every material engineering change follows this chain:

```text
Observed problem, need, risk, or obligation
                    ↓
Research coverage check
          ┌─────────┴─────────┐
          ↓                   ↓
Evidence sufficient     Evidence insufficient
          ↓                   ↓
Engineering entry       Research proposal
          ↓                   ↓
Application review      Research and findings
          └─────────┬─────────┘
                    ↓
Approved engineering entry
                    ↓
Implementation work
                    ↓
Verification and evaluation
                    ↓
Book update and continuing review
```

The implementation must not become the evidence used to justify itself. Results from an authorized experiment or completed implementation may become new evidence after they are evaluated and recorded.

## What requires an engineering entry

An accepted engineering entry or standing engineering policy is required before work begins on:

- a user-visible feature or behavior change;
- an architectural or data-model change;
- a new AI capability, tool, model integration, or autonomous action;
- a change affecting security, privacy, permissions, safety, or responsibility;
- a new dependency or infrastructure commitment;
- a breaking interface or protocol change;
- a material performance, reliability, accessibility, or operational change;
- a removal or deprecation that affects users or contributors;
- an experiment that changes a shared or production-like environment; or
- any change whose rationale, risk, or expected outcome is not already covered by an accepted standing policy.

Small changes do not escape the requirement for a reason. They may use a lighter record when an approved standing policy already establishes the relevant rationale and acceptance criteria.

## Types of engineering record

### Zelyq engineering entry

A record for one bounded problem and proposed response. It contains the full research-to-implementation chain and receives a stable `ZED` identifier.

### Standing engineering policy

A reviewed policy authorizing a recurring class of low-risk work, such as dependency patching, test maintenance, accessibility corrections, or documentation synchronization. It receives a stable `ZEP` identifier.

A standing policy must define its scope, evidence or obligation, permitted changes, prohibited changes, verification, risk boundary, owner, and review date. Work outside those boundaries requires a Zelyq engineering entry.

### Experiment entry

A time-bounded entry authorizing work whose purpose is to produce evidence rather than deliver a product capability. It receives a `ZEX` identifier and must define isolation, data collection, success and failure criteria, termination, cleanup, and whether any output may be retained.

An experiment does not authorize production adoption. Adoption requires a Zelyq engineering entry that evaluates the experiment's results with the wider body of evidence.

### Emergency record

An emergency record covers action required to contain an active security incident, data-loss risk, legal violation, or material service failure when prior review would unacceptably increase harm.

The reason, authority, scope, and immediate verification must be recorded before action when possible and otherwise as soon as the situation is stable. Emergency work requires retrospective research and engineering review; urgency does not convert a temporary response into a permanent design decision.

## Engineering entry structure

Every Zelyq engineering entry contains the following sections.

### Identity and status

```text
Entry ID:
Title:
Version:
Status:
Owner:
Contributors:
Review roles completed:
Created:
Last reviewed:
Related research findings:
Related entries and policies:
Authorized implementation references:
```

### Problem statement

Describe the observed problem, affected people or systems, current behavior, consequence, and evidence that the problem exists. Do not define the problem as the absence of a preferred feature.

### Research coverage

Identify the research questions and published findings relevant to the problem. Record each finding's scope, confidence, limitations, and date or version fit.

If evidence is insufficient for the proposed decision, the entry stops and opens a research proposal or approved experiment. “No research found” is not approval to proceed.

### Project context and constraints

Record the Zelyq-specific facts that affect application of the research, including users, architecture, security model, operational environment, compatibility, resources, legal or ethical obligations, and reversibility.

Project facts must be verified through appropriate sources such as current code, tests, system documentation, incident evidence, or measured behavior.

### Options considered

Include the meaningful alternatives, including no change, process or documentation changes, narrower interventions, technical approaches, and further research.

For each option, record expected benefits, risks, evidence, uncertainty, cost, reversibility, and effect on users and maintainers.

### Proposed decision

State the selected response and explain why it is better supported than the alternatives within the recorded context. Identify which elements are evidence-based, which are engineering judgment, and which remain assumptions.

### Risk and responsibility review

Address relevant security, privacy, safety, accessibility, reliability, data, authorization, human-oversight, misuse, dependency, and maintenance risks. Assign ownership for controls and unresolved risks.

### Implementation boundary

Define what implementation is authorized and explicitly excluded. Identify affected components at the level needed to prevent scope expansion without renewed review.

Authorization covers the problem and boundary, not every implementation idea that could be associated with the entry.

### Acceptance and evaluation plan

Define observable success, unacceptable outcomes, verification, testing, monitoring, comparison baseline, rollback or recovery, and the evidence that must be collected after implementation.

Acceptance criteria should test whether the change addresses the recorded problem, not only whether the code executes.

### Decision and approvals

Record the decision, dissent, conditions, approval roles, date, and expiration or mandatory review date where applicable.

## Engineering entry statuses

| Status | Meaning | Code work allowed? |
| --- | --- | --- |
| Proposed | The problem and initial scope have been recorded | No |
| Research required | Evidence is insufficient; related research or experiment is needed | Only separately approved research artifacts or experiments |
| Application review | Evidence, options, risks, and proposed decision are under review | No |
| Approved for implementation | Required reviews passed and a bounded implementation is authorized | Yes, within the recorded boundary |
| In implementation | Authorized work is underway | Yes, within the recorded boundary |
| Implemented pending evaluation | Implementation is complete but outcome review is incomplete | Only verification, correction, or approved follow-up work |
| Evaluated | Post-implementation evidence has been assessed and the decision remains accepted, revised, or reversed | According to the recorded outcome |
| Deferred | The problem is recognized, but a stated condition, dependency, or resource prevents a current decision | No |
| Rejected | The proposed response was not authorized | No |
| Superseded | A later entry replaces the decision | Only under the successor entry |

Status changes require a dated record and the review roles defined by this policy. A pull request, branch, prototype, or existing implementation does not create retrospective approval.

## Approval gates

Review depth is proportionate to consequence, but each gate must be passed or explicitly marked not applicable with a reason.

### Gate 1: problem legitimacy

Confirms that the problem is evidenced, belongs within Zelyq's mission, identifies affected people or systems, and is not merely a solution written as a problem.

### Gate 2: research sufficiency

Confirms that relevant research was located, inspected, and applied within its scope and confidence. Missing evidence produces `Research required`, not implementation approval.

### Gate 3: option and design review

Confirms that meaningful alternatives were considered, the selected response follows from the research and project context, and the implementation boundary is coherent.

### Gate 4: consequence review

Confirms that relevant security, privacy, safety, accessibility, reliability, operational, legal, ethical, data, and human-responsibility concerns have qualified review and named owners.

### Gate 5: evaluation readiness

Confirms that success, failure, verification, observation, and rollback can be assessed before implementation creates sunk-cost pressure to accept the result.

### Gate 6: implementation authorization

Confirms the exact work that may begin, its conditions, responsible owner, expiration or review date, and required links from implementation artifacts.

No individual should approve every gate alone for a consequential change they proposed. Conflicts and unavailable expertise must be recorded.

## Proportional review

Rigor is proportional to uncertainty, consequence, irreversibility, reach, and novelty—not to the number of lines of code.

A small authorization error can be more consequential than a large internal refactor. Conversely, a routine change covered by a strong standing policy may need only a short record confirming scope and verification.

The chosen review level and its reason must be visible:

- **Routine:** low consequence, reversible, and covered by an accepted standing policy.
- **Standard:** bounded impact with understood risks and no specialist gate beyond normal engineering review.
- **Consequential:** affects trust, security, privacy, data, permissions, architecture, autonomy, reliability, or a wide user population.
- **Critical:** failure could cause serious harm, irreversible loss, legal exposure, or systemic compromise.

Labeling work routine does not make it routine. The entry must demonstrate that the policy's boundaries are satisfied.

## Code contribution gate

Every code contribution must cite one of:

- a Zelyq engineering entry with status `Approved for implementation` or `In implementation`;
- an accepted standing engineering policy whose scope covers the complete change;
- an active experiment entry for isolated research work; or
- an emergency record with the required authority.

The implementation record must identify:

```text
Authorizing entry or policy:
Authorized scope used:
Implementation references:
Tests and verification:
Deviations from the approved boundary:
Evidence collected:
Unresolved issues:
```

A deviation that changes the problem, user impact, selected option, material risk, data handling, permissions, architecture, or evaluation plan pauses implementation and returns the engineering entry to review.

Reviewers should reject code that lacks a valid book reference, exceeds the approved boundary, or cannot show how its verification relates to the entry's acceptance criteria.

## Implementation does not prove the decision

Merged code demonstrates that an implementation was accepted into a codebase. It does not demonstrate that the original problem was solved, that the decision was correct, or that the system is trustworthy.

After implementation, the entry must record:

- what was actually built;
- deviations and unexpected constraints;
- verification results;
- measured or observed outcomes;
- failures, incidents, and user effects;
- whether acceptance criteria were met;
- whether the evidence changes the original decision; and
- which research questions or findings should be updated.

Unfavorable outcomes must remain visible. A failed implementation can be valuable evidence when its context and limitations are recorded accurately.

## Changes with no new feature

Refactoring, dependency updates, test changes, build changes, removals, and internal maintenance still require a reason. Their justification may be shorter, but it must identify the problem or obligation, applicable standing policy or entry, risks, boundary, and verification.

“Cleanup,” “best practice,” “modernization,” “developer experience,” and “technical debt” are not self-justifying labels. The record must state what is impaired, for whom, under which conditions, and how the proposed work is expected to improve it.

## Rejected and deferred work

Rejected and deferred entries remain in the register with their reasoning. This prevents repeated proposals from restarting without addressing earlier evidence and allows later research to change the decision transparently.

Rejection of an implementation does not reject the underlying problem. Deferral must state what evidence, condition, capacity, or dependency would justify reconsideration.

## Continuing review

An engineering entry must be reviewed when:

- a supporting research finding changes confidence or scope;
- project facts or constraints change materially;
- implementation outcomes contradict expected benefits or risks;
- a security, privacy, reliability, accessibility, or operational incident exposes a missed condition;
- the authorization reaches its review or expiration date; or
- a later entry creates a conflict.

Changes propagate in both directions: research updates can reopen decisions, and evaluated engineering outcomes can generate new research questions. Neither layer silently overwrites the other.

## Governance test

The research-to-code system is working when any contributor or reviewer can answer:

- What verified problem authorizes this work?
- Which research findings support or limit the decision?
- What alternatives were considered?
- Which statements are evidence, engineering judgment, or assumption?
- What risks and responsibilities were reviewed?
- What exact implementation boundary was approved?
- How will success and failure be evaluated?
- What should happen if implementation evidence contradicts the decision?
- Who approved each required gate and when?

If these questions cannot be answered from the book, implementation is not ready to begin.

## Governance approval

Decision: **Approved as the active research-to-code governance policy.**

Approved by: Mohamed Sesay, Zelyq founder, on 2026-08-25.

This approval activates the required decision, authorization, implementation, and evaluation process. It does not approve any Zelyq engineering entry, standing policy, experiment, emergency action, implementation, or code.
