# The Engineering Research Book

## Part V synthesis — Trust and human–AI collaboration

Part ID: ERB-05

Version: 0.1

Status: Reviewed — Part exit criterion passed with limitations

Evidence observation cutoff: 2026-08-25

Last substantive review: 2026-08-25

---

## Synthesis

Justified reliance is a decision to use, reject, constrain, verify, delegate to, or intervene in a configured AI system based on evidence appropriate to a defined responsibility and consequence. It is not a feeling of trust, a high adoption rate, a fluent explanation, or confidence in a brand.

Trust attitudes, reliance behavior, trustworthiness properties, and outcomes must remain separate:

```text
what a person feels or believes
        ≠
what the person delegates or accepts
        ≠
what the configured system demonstrably does
        ≠
what the human–AI–organization arrangement achieves
```

Calibration requires accepting useful correct assistance and rejecting, constraining, or escalating incorrect, insecure, or out-of-scope assistance. Both overreliance and under-reliance matter. Confidence displays and explanations can improve discrimination in some tasks and mislead in others; their presence is not evidence of calibration.

## Conditions for justified reliance

Reliance is better justified when:

- the responsibility, context, affected parties, consequence, and authority are explicit;
- evidence directly matches the model/harness version, task distribution, tools, and environment;
- success, failure, abstention, calibration, security, and recovery distributions are known with uncertainty;
- users receive evidence they can use before consequence and possess time, competence, and authority to act;
- permissions and data flows are least-privileged, isolated, logged, and enforceable outside model instructions;
- high-impact actions have independent checks, bounded side effects, and tested containment or recovery;
- responsibility remains assigned to people and institutions capable of governing and repairing the system;
- reliance evidence expires and material changes trigger revalidation; and
- affected people have routes for contest, correction, and redress where decisions affect them.

## Oversight boundary

A human-in-the-loop is not inherently a safeguard. Oversight becomes meaningful only when the person can know enough, reason independently, refuse, stop, modify, reverse, or escalate before unacceptable consequence. Output volume, time pressure, automation bias, skill loss, and unavailable evidence can convert nominal review into ceremonial approval.

Technical controls and human judgment must therefore reinforce one another. Sandboxes, scoped credentials, policy enforcement, tests, audit trails, previews, rate limits, and rollback remain necessary because both models and reviewers can fail.

## Allocation boundary

Human–AI combination does not guarantee synergy. Work should be allocated by comparative evidence, different error patterns, consequence, handoff quality, and recoverability—not by a fixed claim that humans provide judgment while AI provides speed. Accountability must travel with information and control. Allocation should preserve independent human understanding and be revised as capability, workload, and system state change.

## Limitations and exit decision

Many experiments use short non-engineering decision tasks; evidence from sustained software teams and production incidents is thin. Security threats evolve, legal obligations vary, and field measures may be selectively reported. Within these limits, Part V meets its exit criterion: it defines trust as context-dependent, evidence-supported reliance and distinguishes it from sentiment, adoption, familiarity, or confidence.

This synthesis is not a Zelyq requirement or implementation authorization.
