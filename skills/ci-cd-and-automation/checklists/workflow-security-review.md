# Workflow Security Review

- [ ] Any `pull_request_target`/`workflow_run` use is justified and does not execute untrusted code.
- [ ] `permissions` is explicit.
- [ ] No unnecessary write permissions.
- [ ] `id-token: write` appears only where OIDC is required.
- [ ] Third-party Actions are immutable-pinned where policy permits.
- [ ] Untrusted GitHub context is not interpolated directly into shell code.
- [ ] Fork jobs do not receive protected secrets.
- [ ] Cache content cannot cross a dangerous trust boundary.
- [ ] Untrusted artifacts are not executed by privileged jobs.
- [ ] Self-hosted runners are not exposed to arbitrary untrusted code.
- [ ] Secret scanning/push protection is considered/enabled where available.
- [ ] Cloud trust policy constrains expected repo/ref/environment/workflow.
