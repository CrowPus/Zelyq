# The Engineering Research Book

## Why this book exists

---

## The problem this book addresses

Building an AI system that participates responsibly in software engineering requires knowledge from several areas. Software-engineering research examines development practices and outcomes. Human-computer interaction studies how people use and understand tools. Organizational research considers coordination, expertise, and knowledge transfer. Artificial-intelligence research investigates model capabilities and limitations. Security, operations, architecture, and developer-experience work add further perspectives.

These bodies of knowledge were not created to answer one shared product question. Their concepts, methods, units of analysis, and standards of evidence differ. Useful findings also appear outside academic literature—in technical standards, source repositories, engineering reports, incident reviews, and practitioner studies.

Zelyq needs a disciplined way to examine this material together. Without one, product decisions could depend on whichever source, benchmark, anecdote, or competitor happens to be most visible at the time. The problem is therefore not an assumed absence of knowledge. It is the need to identify, evaluate, connect, and preserve the knowledge relevant to a specific question:

> What would an AI system need to understand, do, and demonstrate to earn trust as a software engineering partner?

## Why a research book

A research book provides continuity across questions that cannot be answered by one experiment or discipline. It can preserve definitions, evidence, disagreement, limitations, and relationships between findings while allowing each chapter to investigate a bounded question.

The format also creates a durable path from research to engineering decisions:

```text
Research question
        ↓
Evidence and analysis
        ↓
Bounded finding
        ↓
Design implication
        ↓
Zelyq engineering entry
        ↓
Review and authorization
        ↓
Implementation and evaluation
```

This path is not automatic. Evidence may support several implications, qualify an existing direction, or justify no product change. The reasoning between each stage must remain visible, and implementation may begin only after an engineering entry passes the required gates.

## Why documentation is not sufficient

Documentation and research have different responsibilities.

Documentation explains a system: what exists, how it behaves, and how people can use or maintain it. Research investigates questions whose answers remain uncertain. It compares evidence, evaluates competing explanations, and states what can and cannot be concluded.

Zelyq needs both. Product documentation should describe Zelyq accurately. This book should investigate the engineering problems and evidence that may eventually inform Zelyq. Treating one as the other would either burden documentation with unresolved inquiry or allow product assumptions to appear as research findings.

## Why code generation is not the whole question

Producing code is one activity within software engineering. An AI system may generate a plausible implementation without demonstrating that it understands the surrounding system, has identified the correct problem, has considered operational and organizational constraints, or can recognize and recover from its own errors.

The relevant question is therefore broader than whether AI can produce code. The research must examine the responsibilities involved in engineering work and determine which capabilities, safeguards, evidence, and human roles are required in different contexts.

This framing does not predetermine that an AI system can or should perform every engineering responsibility. Identifying boundaries where automation is unreliable or inappropriate is part of the research objective.

## Why the project is open source

The credibility of the book depends on inspectability. Readers should be able to review its sources, follow its reasoning, identify omissions, challenge interpretations, and propose corrections. Version history should show how conclusions change when evidence improves.

Open participation also broadens the settings and experiences represented in the research. It does not, by itself, guarantee quality or consensus. Contributions remain subject to common methodological, evidentiary, editorial, and review standards.

The book's open-source license permits reuse and adaptation beyond Zelyq. Its findings should be available to researchers, practitioners, educators, and other projects, provided the work is attributed and changes are identified.

## Relationship to Zelyq

Zelyq supplies the motivating problem and an environment in which some implications may be applied and tested. It does not determine the research conclusions.

The book may inform:

- which engineering problems deserve attention;
- which capabilities require evaluation;
- which risks and constraints a design must address;
- what evidence would justify reliance on a system; and
- when a proposed feature lacks adequate research support.

The research layer does not serve as Zelyq's product specification, roadmap, architecture, or marketing case. The book's separate engineering application layer records project decisions, their constraints, and their authorization only after they have been traced to reviewed research. This separation prevents product preference from becoming a research finding while ensuring that code does not begin outside the book.

The governing relationship is defined in [Research-to-code governance](10-research-to-code-governance.md).

## What the book must preserve

For the research to remain useful over time, it must preserve more than conclusions. It should record:

- the question and scope of each investigation;
- how evidence was found and selected;
- the context and limitations of that evidence;
- important disagreement and alternative explanations;
- the reasoning used to reach a finding;
- confidence in the finding;
- unresolved questions; and
- revisions that materially change interpretation.

This record allows future contributors to reassess a finding without reconstructing private conversations or treating earlier conclusions as permanent.

## Boundaries

The book is not intended to:

- defend a predetermined vision of Zelyq;
- demonstrate that AI can replace software engineers;
- catalogue every topic in software engineering or artificial intelligence;
- treat popularity, adoption, or benchmark performance as sufficient evidence of trustworthiness;
- convert every finding into a feature; or
- remain unchanged when stronger evidence becomes available.

Its Version 1 scope is defined in the [Research Plan](../TABLE_OF_CONTENTS.md).

## What success means

The book succeeds when it improves the quality and traceability of reasoning about AI-assisted software engineering.

For Zelyq, that means engineering work begins from an accepted book entry that identifies the problem, research, uncertainties, alternatives, decision, risks, implementation boundary, and evaluation. For readers outside Zelyq, it means the questions, methods, evidence, and conclusions remain useful and assessable without accepting Zelyq's project-specific choices.

Success is not measured by the number of pages, contributors, citations, or features produced. Those quantities may grow without improving understanding. The meaningful test is whether the book helps people make better-supported claims, identify uncertainty earlier, and evaluate engineering systems more responsibly.
