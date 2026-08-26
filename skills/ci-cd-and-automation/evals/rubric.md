# CI/CD and Release Engineering Evaluation Rubric

Score 0–5.

1. **Trust-boundary reasoning** — untrusted code, secrets, runners, caches, artifacts.
2. **Gate design** — checks match actual risk and have useful signal.
3. **Build reproducibility/artifact identity** — controlled inputs, immutable artifact.
4. **Supply-chain security** — third-party workflow dependencies, provenance, dependency/secret security.
5. **Credential security** — least privilege and short-lived deployment identity.
6. **Deployment design** — correct strategy, concurrency, environment protections.
7. **Data/config compatibility** — migration and rollback realities understood.
8. **Observability** — release health and promotion signals.
9. **Recovery** — tested rollback/roll-forward path.
10. **Pipeline usability** — fast useful feedback, diagnosable failures, no normalized flakiness.

## Critical failures

Automatic fail if:
- untrusted PR code receives production secrets/privileged token without a valid secure design;
- privileged `pull_request_target` executes untrusted checkout;
- production is built independently from unverified mutable source while a verified artifact is available;
- a destructive migration makes stated rollback impossible and the agent misses it;
- canary/progressive rollout has no health gate;
- long-lived deployment keys are introduced without considering supported OIDC;
- self-hosted privileged runners accept arbitrary fork code.

## Threshold

Production-quality target:
- ≥ 40/50
- no critical failure
- trust, deployment, and recovery each ≥ 3.
