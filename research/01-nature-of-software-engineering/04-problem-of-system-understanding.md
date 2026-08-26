# The Engineering Research Book

## The problem of system understanding

Chapter ID: ERB-01-04

Version: 0.1

Status: Reviewed — Gate A and Gate B passed with limitations

Authors: Dee Empire and the Zelyq contributors

Last substantive review: 2026-08-25

Research artifacts: [ERB-01-04 artifacts](../artifacts/erb-01-04/)

---

## Primary research question

> Why do software systems become difficult to understand, and which forms of understanding does engineering work require?

## Findings

### Understanding is relative to an engineering task

An engineer does not simply “understand the system.” Change, diagnosis, review, testing, operation, and design require different questions and different boundaries. Observed programmers asked where to begin, how entities relate, how behavior arises, what a component is intended to do, and who or what can supply missing information. A correct local explanation may therefore be insufficient for a cross-component change, while broad architectural familiarity may not predict a particular runtime state.

### The required knowledge is not contained in source text alone

The reviewed studies locate relevant information in code, runtime behavior, tests, documentation, issue and change records, design history, tools, and other people. Intent, rationale, ownership, and environmental assumptions may be only partially encoded—or not encoded at all—in the current program. System difficulty grows when these sources disagree, disappear, become stale, or cannot be connected to the question being answered.

### Comprehension is substantial, distributed engineering work

Workplace evidence shows developers moving among tools, artifacts, and coworkers to answer information needs. One instrumented two-company study classified a substantial share of 3,148 observed working hours as program-comprehension activity and found browsers and documents were important alongside development environments. Its reported percentage is not a universal constant: it depends on the study’s participants, projects, instrumentation, and activity classification.

### Prior context helps selectively; experience is not proof

The test-code study found relationships between project knowledge or experience and some task measures. Other evidence distinguishes newcomers from people familiar with a system. These findings support preserving context and testing task-relevant knowledge. They do not justify using job title, years worked, familiarity, or confidence as a substitute for demonstrated understanding.

### Cognition constrains local reasoning, but representations must be tested

Controlled tracing studies show that maintaining program state is vulnerable to working-memory limits, interference, and strategy. External representations can plausibly reduce what must be remembered, but plausibility is not outcome evidence. In a small controlled study, a spatial code canvas changed time allocation without a statistically significant aggregate comprehension-performance advantage. The result is neither proof of equivalence nor permission to assume a visual aid works.

### No single proxy establishes complete understanding

The studies operationalize comprehension through observed questions, classified time, navigation, recall, task answers, annotations, or accuracy. Each measure answers a narrower question. Faster completion may reflect prior familiarity; more navigation may reflect exploration or confusion; a correct answer may cover only the tested slice. A defensible assessment must state the task, required knowledge, observable evidence, and consequences of error.

## Approved findings

1. **Task relativity—Moderate:** required understanding changes with the engineering task and system boundary.
2. **Distributed knowledge—Moderate:** relevant knowledge can reside across code, behavior, tests, records, tools, and people.
3. **Material comprehension work—Moderate in observed settings:** professional developers devote substantial work to acquiring and checking understanding through multiple sources.
4. **Context and cognitive constraint—Moderate–Low:** prior context and working-memory limits affect bounded comprehension tasks, without determining all outcomes.
5. **Aid effectiveness—Low, direct:** one small experiment found no significant overall performance benefit from a spatial canvas; aids require task-relevant evaluation.
6. **Measurement boundary—Moderate–Low:** no single reviewed proxy supports a claim of complete system understanding.

See the [claim–evidence records](../artifacts/erb-01-04/claim-evidence-records.md) for confidence and prohibited inferences.

## Practical research consequence

Later chapters evaluating a person, team, process, or AI system must not accept fluent explanation or code production as sufficient evidence of system understanding. They must define the task and boundary, identify necessary information classes, elicit predictions or explanations that can be checked, and test performance against consequences relevant to the task.

## Limitations

The synthesis is structured but non-exhaustive. Several samples are small, volunteer-based, or organization-specific; some include students. Evidence is thin for safety-critical operation, distributed teams, longitudinal retention, non-code production systems, and accessibility. The chapter identifies requirements for evaluating understanding but does not provide a universal test.

## Research boundary

This chapter concerns software engineering generally. It does not inspect Zelyq, specify an AI system, authorize engineering, or make a code decision.
