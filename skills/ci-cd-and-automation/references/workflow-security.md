# Workflow Security

## Threat model

CI executes code with access to valuable capabilities:
- repository write tokens;
- release/package permissions;
- environment secrets;
- cloud credentials;
- signing/attestation identity;
- caches/artifacts;
- internal networks;
- self-hosted runner state.

Treat workflow files as security-sensitive code.

## Untrusted pull requests

Fork/PR code may control:
- source files;
- tests;
- build scripts;
- package manager lifecycle scripts;
- filenames;
- commit/PR metadata;
- generated artifacts.

Do not expose privileged credentials merely because the workflow file itself comes from the base branch.

### GitHub privileged triggers

`pull_request_target` runs in the target/base repository context and may have privileged access. GitHub warns against checking out and executing untrusted PR code in that context.

Use `pull_request` for ordinary untrusted validation.

If a privileged follow-up is required:
- separate it from untrusted execution;
- treat uploaded artifacts as untrusted input;
- verify provenance/content before privileged use.

## Token permissions

Set explicit permissions.

Example read-only validation:

```yaml
permissions:
  contents: read
```

A release job may add only the scopes it needs, e.g. package or attestation write.

Do not use `write-all` as a convenience default.

## OIDC

Use OpenID Connect / workload identity for cloud authentication when supported.

GitHub requires `id-token: write` for the job to request an OIDC token. This permission does not itself grant cloud access; the cloud trust policy determines what claims are accepted.

Trust policies should constrain identity to expected repository/workflow/environment/ref claims supported by the provider.

## Third-party actions

GitHub's secure-use guidance recommends pinning third-party Actions to full-length commit SHAs because tags/branches are mutable.

Pattern:

```yaml
- uses: owner/action@<FULL_COMMIT_SHA> # vX.Y.Z
```

Maintain the pin through dependency automation/review.

Evaluate:
- maintainer reputation;
- repository ownership changes;
- transitive execution;
- requested token/secrets;
- network access;
- whether a simple shell command is more auditable.

## Script injection

Never directly interpolate untrusted GitHub context into shell source.

Risky:

```yaml
run: echo "${{ github.event.pull_request.title }}"
```

Prefer passing untrusted data through an environment variable:

```yaml
env:
  PR_TITLE: ${{ github.event.pull_request.title }}
run: printf '%s\n' "$PR_TITLE"
```

Then quote correctly for the shell.

## Caches

GitHub documents that caches are not signed or verified.

Rules:
- never store secrets;
- avoid privileged workflows executing cache content written by untrusted workflows;
- scope keys appropriately;
- treat restored executable/generated content as potentially attacker-influenced;
- save caches from trusted triggers where threat model requires it.

Cache is a performance optimization, not a trust boundary.

## Artifacts

Artifacts uploaded by untrusted workflows are untrusted until verified.

Do not let a privileged workflow:
1. download arbitrary PR artifact;
2. execute it;
3. use production credentials.

Prefer rebuilding trusted source in the privileged context or verify provenance/digest with a safe design.

## Self-hosted runners

GitHub warns that self-hosted runners are not guaranteed ephemeral/clean and can be persistently compromised by untrusted code.

For public/fork-heavy repos, prefer GitHub-hosted ephemeral runners.

If self-hosted is required:
- restrict repository/runner groups;
- isolate networks;
- minimize ambient credentials;
- prefer truly ephemeral/JIT environments;
- never expose a privileged runner to arbitrary fork code.

## Secret scanning

Enable secret scanning/push protection where available.

If a secret is committed:
- remove it from history as needed;
- revoke/rotate it;
- do not assume deletion from the latest file makes it safe.

## Security gate layering

Use multiple controls when applicable:
- code scanning/SAST;
- dependency review;
- secret scanning;
- IaC/container scanning;
- provenance/attestation;
- branch/ruleset protections;
- least-privilege deployment identity.

`npm audit` or equivalent alone is not a supply-chain security program.

## Sources

- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/actions/reference/security/oidc
- https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
- https://docs.github.com/en/code-security/concepts/secret-security/push-protection
