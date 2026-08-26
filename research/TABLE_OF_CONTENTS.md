# The Engineering Research Book

## Version 1 research plan

Version: 1.0

Status: Reviewed — Version 1 complete

---

## Governing question

> What would an AI system need to understand, do, and demonstrate to earn trust as a software engineering partner?

The question does not assume that such a system is possible, that it should replace engineers, or that any particular product design is correct.

## Purpose of Version 1

Version 1 establishes the conceptual and evidentiary foundation needed to evaluate the governing question. It studies software engineering before defining AI requirements, and it studies AI capabilities before proposing criteria for justified reliance.

The research layer does not produce a product specification. It produces a traceable account of:

- what software-engineering work requires from individuals, teams, and organizations;
- which requirements are relevant to an AI engineering system;
- what current AI systems can and cannot demonstrate under defined conditions;
- what makes human reliance on such a system justified or unjustified; and
- how those claims should be evaluated in realistic engineering work.

The engineering application layer then records how reviewed findings are applied to Zelyq. It is the required decision and authorization layer between research and code. Application entries may authorize, reject, defer, constrain, or require further research for proposed engineering work.

## Scope

Version 1 includes research concerning:

- software engineering as technical, cognitive, and organizational work;
- engineering judgment under uncertainty and constraint;
- collaboration, coordination, maintenance, and knowledge continuity;
- AI capabilities and failure modes relevant to engineering work;
- human oversight, responsibility, security, privacy, and trust calibration; and
- synthesis into research-grounded evaluation criteria.

The unit of concern is software engineering across the lifecycle of a system, not only the production of source code.

## Boundaries

The research agenda does not:

- treat proposed Zelyq features as research conclusions;
- allow Zelyq's current implementation architecture to determine research findings;
- produce a business, market, or go-to-market strategy;
- claim that AI can or should replace software engineers;
- provide exhaustive profiles of individual competitors;
- forecast artificial general intelligence or labor displacement;
- catalogue every software-engineering specialty; or
- treat model benchmarks as substitutes for evidence from engineering contexts.

Deferred work may be proposed later when it is necessary to answer the governing question or apply an established finding. Entering Version 1 requires an approved scope change.

Zelyq-specific engineering decisions are not deferred merely because they are product-facing. They belong in the engineering application layer, where they must cite reviewed research and pass the research-to-code governance process. They do not become research findings by entering the book.

## Research order and dependencies

The sequence is cumulative:

```text
Part I: Nature of software engineering
                    ↓
Part II: Engineering work and judgment
                    ↓
Part III: Teams, projects, and engineering memory
                    ↓
Part IV: AI capabilities and limits
                    ↓
Part V: Trust and human–AI collaboration
                    ↓
Part VI: Synthesis and evaluation
                    ↓
Engineering application: Zelyq decisions and authorization
```

The arrows represent conceptual dependencies, not a requirement that every chapter in one part be published before research in the next part begins. Later findings must identify and respect unresolved dependencies from earlier parts.

Part VI cannot publish final synthesis criteria until the findings it depends on have passed review. A Zelyq engineering entry may use available reviewed findings before all of Version 1 is complete, but it must disclose gaps and cannot proceed when evidence required for the decision is insufficient.

## Cross-cutting lenses

The following concerns should be examined within relevant chapters rather than isolated automatically into separate parts:

- security and abuse resistance;
- privacy and data governance;
- accessibility and inclusion;
- professional and research ethics;
- power, consent, and responsibility;
- organizational size and maturity;
- open-source and commercial settings;
- geographic, cultural, and regulatory context;
- software criticality and consequence of failure; and
- change over time in tools and practices.

A chapter should state which lenses are relevant, which it addresses, and which remain outside its scope.

---

## Front matter

| Sequence | Page | Purpose |
| --- | --- | --- |
| 01 | Cover | Identify the publication, edition, creator, and maintainer |
| 02 | Copyright and license | Define ownership, reuse, contribution, and third-party rights |
| 03 | Preface | Explain the origin and motivation of the research |
| 04 | Why this book exists | Define the knowledge problem, role, boundaries, and meaning of success |
| 05 | How to use this book | Explain navigation, interpretation, status, confidence, and responsible application |
| 06 | Research methodology | Define how questions become reviewed findings |
| 07 | Evidence standard | Define source appraisal, claim support, synthesis, confidence, and citation |
| 08 | Contribution guide | Define proposal, review, acceptance, credit, correction, and maintenance |
| 09 | Book architecture | Define hierarchy, files, chapter anatomy, metadata, status, and change control |
| 10 | Research-to-code governance | Define the mandatory evidence, decision, approval, implementation, and evaluation gates |
| 11 | Glossary | Define stable terms used throughout the publication |

---

## Part I — The nature of software engineering

Central question:

> What is software engineering, and why does it remain difficult even when producing code becomes easier?

Included scope: the objects, objectives, constraints, uncertainty, change, and failure characteristics that distinguish software engineering as a discipline and practice.

| ID | Planned chapter | Primary research question |
| --- | --- | --- |
| ERB-01-01 | Software engineering and programming | Which responsibilities distinguish software engineering from programming, and where does the distinction affect outcomes? |
| ERB-01-02 | Software as a sociotechnical system | How do technical artifacts, people, processes, and organizations interact in the behavior and evolution of software systems? |
| ERB-01-03 | Uncertainty, constraints, and tradeoffs | Which forms of uncertainty and constraint shape software-engineering decisions, and how are tradeoffs made visible? |
| ERB-01-04 | The problem of system understanding | Why do software systems become difficult to understand, and which forms of understanding does engineering work require? |
| ERB-01-05 | Success, degradation, and failure over time | Through which mechanisms do software systems remain effective, degrade, or fail as their environments and requirements change? |
| ERB-01-S | Part I synthesis | Which bounded account follows from the reviewed Part I findings, and which uncertainties must travel forward? |

Exit criterion: the part provides a defensible, bounded account of software engineering that does not depend on a preferred AI or Zelyq design.

## Part II — Engineering work and judgment

Central question:

> What do software engineers actually do, and what distinguishes reliable engineering judgment?

Dependency: Part I's description of the discipline and the forms of uncertainty and system understanding involved.

Included scope: observable engineering activities, cognitive processes, expertise, decision practices, and individual responsibility.

| ID | Planned chapter | Primary research question |
| --- | --- | --- |
| ERB-02-01 | Engineering work beyond coding | Which activities constitute software-engineering work, and how do their purposes and evidence requirements differ? |
| ERB-02-02 | Mental models and system understanding | How do engineers build, test, revise, and communicate mental models of software systems? |
| ERB-02-03 | Problem framing and requirements discovery | How do engineers transform incomplete, conflicting, or changing needs into problems that can be acted upon? |
| ERB-02-04 | Debugging and causal reasoning | Which reasoning strategies help engineers identify causes, reject plausible but incorrect explanations, and verify repairs? |
| ERB-02-05 | Design decisions and tradeoffs | How do engineers generate, compare, document, and revise design alternatives under constraint? |
| ERB-02-06 | Risk and uncertainty management | How do engineers recognize, communicate, reduce, and accept technical risk and uncertainty? |
| ERB-02-07 | Experience and reliable judgment | Which observable practices distinguish more reliable engineering judgment, and under what conditions does experience fail to transfer? |
| ERB-02-S | Part II synthesis | Which observable practices characterize bounded, evidence-responsive engineering judgment? |

Exit criterion: the part identifies observable practices and conditions associated with engineering judgment without reducing expertise to title, tenure, or an idealized job description.

## Part III — Teams, projects, and engineering memory

Central question:

> How do teams coordinate engineering work and preserve understanding as software evolves?

Dependency: Parts I and II's accounts of system evolution, individual work, judgment, and understanding.

Included scope: coordination, shared responsibility, organizational knowledge, maintenance, and project continuity.

| ID | Planned chapter | Primary research question |
| --- | --- | --- |
| ERB-03-01 | Coordination and communication | How do engineering teams coordinate interdependent work, and which communication failures materially affect outcomes? |
| ERB-03-02 | Code review, design review, and shared accountability | What functions do engineering reviews serve, and under which conditions do they improve or impair decisions? |
| ERB-03-03 | Architecture decisions and rationale | How are consequential technical decisions made, challenged, recorded, and revised across a project's lifetime? |
| ERB-03-04 | Tacit knowledge and knowledge loss | Which engineering knowledge remains tacit, how is it transferred, and what happens when it becomes unavailable? |
| ERB-03-05 | Onboarding and transfer of understanding | How do people acquire sufficient understanding to contribute safely and effectively to an existing system? |
| ERB-03-06 | Maintenance, ownership, and technical debt | How do ownership, maintenance practices, and accumulated compromises affect a system's ability to change? |
| ERB-03-07 | Incidents and organizational learning | What do software incidents reveal about technical and organizational understanding, and how is that learning preserved or lost? |
| ERB-03-S | Part III synthesis | Which engineering capabilities and memories emerge collectively, and under which conditions do they persist? |

Exit criterion: the part distinguishes responsibilities and capabilities belonging to individuals from those emerging through teams, process, tools, and organizational context.

## Part IV — AI capabilities and limits

Central question:

> Which parts of engineering work can AI systems perform reliably, and under what conditions do they fail?

Dependency: Parts I–III define the engineering responsibilities and contexts against which AI claims must be evaluated.

Included scope: demonstrated capabilities, enabling conditions, failure modes, evaluation validity, and boundaries relevant to software engineering.

| ID | Planned chapter | Primary research question |
| --- | --- | --- |
| ERB-04-01 | A capability model for AI-assisted engineering | Which distinct capabilities are required to participate in the engineering work identified in Parts I–III? |
| ERB-04-02 | Context acquisition and repository understanding | What can AI systems infer about an unfamiliar software project, what context do they require, and how can understanding be tested? |
| ERB-04-03 | Planning, decomposition, and adaptation | Under which conditions can AI systems form, execute, monitor, and revise plans for multi-step engineering work? |
| ERB-04-04 | Tool use and environment interaction | How reliably can AI systems select and operate development tools while respecting environmental constraints and feedback? |
| ERB-04-05 | Memory and continuity | Which forms of continuity can AI systems maintain across tasks and time, and how do memory mechanisms introduce error or risk? |
| ERB-04-06 | Verification, error detection, and recovery | How effectively can AI systems verify their work, detect incorrect assumptions or actions, and recover from failure? |
| ERB-04-07 | Hallucination, overconfidence, and correlated failure | Which failure modes most affect AI-assisted engineering, what conditions produce them, and how observable are they to users? |
| ERB-04-08 | Evaluation and benchmark validity | To what extent do existing evaluations measure capabilities that matter in real software-engineering work? |
| ERB-04-S | Part IV synthesis | Which AI engineering capabilities are demonstrated, under which configurations, and at which evidence level? |

Exit criterion: the part distinguishes demonstrated from plausible capability, observed limitations from assumed limitations, and measured performance from anecdotal success. Every changeable claim records its observation date and relevant system version.

## Part V — Trust and human–AI collaboration

Central question:

> What makes reliance on an AI engineering system justified rather than merely convenient?

Dependency: Parts I–IV identify the responsibilities at stake, human and organizational context, and demonstrated AI capabilities and limitations.

Included scope: trustworthiness, calibrated reliance, oversight, control, responsibility, security, privacy, and collaborative work allocation.

| ID | Planned chapter | Primary research question |
| --- | --- | --- |
| ERB-05-01 | Trust, trustworthiness, and reliance | How should trust, trustworthiness, reliance, and calibration be distinguished in AI-assisted software engineering? |
| ERB-05-02 | Evidence for justified reliance | What evidence do engineers need to decide whether, when, and how much to rely on an AI system? |
| ERB-05-03 | Transparency, explanation, and inspectability | Which forms of transparency or explanation improve evaluation and control, and when can they mislead? |
| ERB-05-04 | Human oversight and intervention | Which oversight arrangements detect or prevent consequential failures without creating ineffective or merely ceremonial review? |
| ERB-05-05 | Predictability, reversibility, and recovery | How do predictable behavior, reversible actions, and recovery mechanisms affect justified reliance? |
| ERB-05-06 | Security, privacy, and responsibility boundaries | Which security, privacy, authorization, and accountability conditions are necessary for responsible use? |
| ERB-05-07 | Allocation of work between humans and AI | How should engineering responsibilities be allocated or shared so that automation supports rather than obscures human judgment and accountability? |
| ERB-05-S | Part V synthesis | Under which evidence, control, and responsibility conditions is reliance on an AI engineering system justified? |

Exit criterion: the part defines trust as context-dependent, evidence-supported reliance rather than sentiment, familiarity, adoption, or confidence alone.

## Part VI — Synthesis and evaluation

Central question:

> How should a trustworthy AI software engineering partner be evaluated?

Dependency: reviewed findings from Parts I–V. This part must not fill missing foundations with product assumptions.

Included scope: synthesis of established responsibilities, capabilities, limitations, trust conditions, evaluation scenarios, and remaining uncertainty.

| ID | Planned chapter | Primary research question |
| --- | --- | --- |
| ERB-06-01 | Taxonomy of engineering responsibilities | How can the responsibilities identified across the book be organized without erasing their contextual and collective nature? |
| ERB-06-02 | Capability and limitation model | Which AI capabilities and limitations correspond to those responsibilities, and where does the evidence remain insufficient? |
| ERB-06-03 | Criteria for trustworthy behavior | Which observable properties would justify reliance on an AI system for defined engineering responsibilities and risk levels? |
| ERB-06-04 | Evaluation scenarios | Which scenarios represent consequential software-engineering work more faithfully than isolated implementation tasks? |
| ERB-06-05 | Measures and evidence requirements | Which measures and evidence would distinguish capability, reliability, uncertainty management, and recovery from superficial task completion? |
| ERB-06-06 | Limits and open research agenda | Which conclusions can Version 1 defend, where do they not generalize, and which questions require further research? |
| ERB-06-S | Version 1 synthesis | What must an AI system demonstrate to earn bounded reliance as a software-engineering partner? |

Exit criterion: every synthesis claim and evaluation criterion traces to reviewed findings in earlier parts, states its scope and confidence, and does not become a product specification.

---

## Engineering application layer — Zelyq decisions

Central question:

> Given the reviewed research and Zelyq's verified context, what engineering work is justified, within which boundaries, and how will its outcome be evaluated?

This layer is part of the book's governance but not a seventh research domain. It contains project-specific application records rather than general research chapters.

Its records include:

- a register of proposed, approved, rejected, implemented, evaluated, and superseded decisions;
- Zelyq engineering entries for bounded problems and proposed responses;
- standing engineering policies for recurring low-risk work;
- experiment entries for work intended to produce evidence;
- emergency records for urgent containment followed by retrospective review; and
- post-implementation evaluations that can reopen decisions or generate research questions.

No code work begins unless it is covered by a valid record under [Research-to-code governance](00-front-matter/10-research-to-code-governance.md). The authoritative index of those records is the [Zelyq engineering application register](07-zelyq-engineering/REGISTER.md).

The application layer must preserve four distinctions:

1. A research finding describes what the evidence supports.
2. A design implication identifies possible consequences of that finding.
3. An engineering entry applies findings and implications to Zelyq's context through accountable judgment.
4. An implementation realizes only the boundary authorized by an approved entry.

Exit criterion for an individual entry: the problem is evidenced, research coverage is adequate, alternatives and consequences are reviewed, the implementation boundary and evaluation plan are explicit, and all required approval gates have passed.

---

## Chapter status in Version 1

All forty planned research chapters have completed the documented workflow and are published with reviewed findings and limitations. Their chapter files and corresponding directories under `artifacts/` are the authoritative records of scope, protocol, search, screening, evidence, analysis, claim traceability, and review.

Completion of research does not authorize implementation. Product decisions must be recorded separately under [Research-to-code governance](00-front-matter/10-research-to-code-governance.md), and the engineering register currently authorizes no code work.

## Version 1 completion criteria

Version 1 is complete when:

- every included chapter has a precise research question and documented scope;
- the required research record and artifacts are available or restrictions are explained;
- material findings satisfy the evidence standard;
- contradictory evidence, alternative interpretations, and important limitations are represented;
- terminology and dependencies remain consistent across parts;
- synthesis claims trace to reviewed findings;
- evaluation criteria state their intended contexts and failure consequences;
- every authorized engineering entry traces to reviewed findings or an accepted standing policy;
- every engineering entry distinguishes evidence, judgment, and assumption;
- implementation and post-implementation evidence can be traced back to the authorizing entry;
- unresolved issues capable of invalidating a central conclusion are resolved or explicitly prevent that conclusion; and
- the full publication passes methodological, domain, evidence, editorial, accessibility, licensing, and governance review.

Completeness does not require certainty or agreement on every open question. It requires an inspectable account of what the evidence supports, what it does not support, and why.

## Approval and change control

Version 1 passed the completion audit recorded in [PUBLICATION_AUDIT.md](PUBLICATION_AUDIT.md). The research remains open to correction and continuing review.

After approval, changes to the governing question, Version 1 boundaries, part structure, or completion criteria require a documented scope or structural change under the book architecture. Refining a proposed chapter question may follow the contribution workflow when the change remains within the approved purpose of its part.
