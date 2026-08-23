# The Engineering Research Book

## Preface

---

Software is expressed through code, but software engineering includes much more than producing it. Engineers interpret incomplete requirements, investigate unfamiliar systems, weigh alternatives, coordinate with other people, anticipate failure, review changes, respond to incidents, and maintain systems whose original assumptions may no longer hold.

Tools that generate code can assist with part of that work. Their ability to produce an implementation, however, does not by itself demonstrate that they understand a project, recognize its constraints, make defensible tradeoffs, or know when their conclusions are uncertain. Those are separate capabilities, and their importance depends on what software engineering actually requires.

This distinction motivated The Engineering Research Book.

Zelyq began with an ambition: to explore whether an artificial intelligence system could become a trusted software engineering partner rather than only a code-generation tool. The ambition immediately raised questions that product development alone could not answer. What does an experienced engineer contribute beyond implementation? How is understanding developed and preserved? How do teams judge risk? What makes reliance on a collaborator or tool justified? Which of these responsibilities can current AI systems perform reliably, and where is human judgment essential?

The project does not yet have defensible answers to all of these questions. This book exists because the answers should not be invented during feature design.

Its purpose is to build an open, inspectable body of research from which engineering decisions can later be derived. It begins by studying software engineering, engineers, teams, projects, and organizational memory. It then examines AI capabilities and limitations, followed by trust and human–AI collaboration. Only after those foundations are established does it attempt to define implications or evaluation criteria for an AI engineering system.

That order matters. Beginning with a preferred product would encourage the research to justify decisions already made. Beginning with questions allows the evidence to challenge the project's assumptions—including the assumption that a proposed AI capability would be useful, safe, or trustworthy.

The book therefore makes no promise that every investigation will produce a feature. A finding may support a design direction, identify conditions under which it would be appropriate, expose risks that require further study, or show that no product response is justified. An inconclusive result is also valuable when it identifies the limits of current knowledge.

The standard is not agreement with Zelyq's original vision. The standard is whether a reader can inspect the question, evidence, reasoning, uncertainty, and relationship between a finding and any implication drawn from it.

This is an open-source research project because scrutiny improves work of this kind. Engineers, researchers, students, practitioners, and other contributors should be able to examine sources, question methods, identify missing perspectives, reproduce analyses where possible, and propose better explanations. Contributions are evaluated by the quality and relevance of their reasoning and evidence, not by whether they reinforce an existing position.

Although Zelyq provides the initial motivation, the subject is broader than one product. Questions about engineering judgment, organizational knowledge, AI reliability, and justified trust affect the wider practice of AI-assisted software engineering. The book should remain useful even when particular tools, models, and product strategies change.

The governing question is deliberately demanding:

> What would an AI system need to understand, do, and demonstrate to earn trust as a software engineering partner?

The wording treats trust as something that requires evidence. It does not assume that human equivalence is possible, that automation should replace engineers, or that technical capability alone is sufficient. These are matters for investigation rather than premises of the project.

The book will change as the evidence changes. Its methods, sources, limitations, and revisions should remain visible so that future contributors can understand not only what it concludes, but why.

This preface states the motivation. The research that follows must determine which parts of that motivation withstand careful examination.
