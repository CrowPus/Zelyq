# Pipeline Definition of Done

- [ ] Repository type and trust model are understood.
- [ ] PR/untrusted validation is separated from privileged release where applicable.
- [ ] Workflow/token permissions are least-privileged.
- [ ] Third-party workflow dependencies are reviewed and pinned according to policy.
- [ ] Build/install inputs are controlled by lockfiles/pins as appropriate.
- [ ] Quality gates correspond to real risks.
- [ ] Required gates have useful signal and remediation.
- [ ] Flaky gates are not normalized.
- [ ] Secrets are not stored in code/cache/artifacts.
- [ ] OIDC/short-lived deployment identity is used where supported and appropriate.
- [ ] CI artifacts/logs make failures diagnosable.
- [ ] Superseded PR work/concurrency is handled intentionally.
- [ ] Pipeline timing/cost is measured instead of guessed.
- [ ] Fork/self-hosted-runner risks are addressed where applicable.
