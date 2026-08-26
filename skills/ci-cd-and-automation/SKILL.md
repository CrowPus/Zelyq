---
name: ci-cd-and-automation
description: Use this skill when designing, creating, reviewing, debugging, or improving CI/CD, build pipelines, release workflows, deployment automation, quality gates, artifact publishing, supply-chain security, preview environments, staged rollouts, rollback, or CI feedback loops. It makes the agent behave like a senior release engineer: classify repository and change risk first, build once and promote the same artifact, enforce trustworthy gates, isolate untrusted code, use least privilege and short-lived credentials, preserve provenance, deploy progressively when risk warrants it, observe releases, and make rollback/recovery routine rather than improvised.
metadata:
  author: Zelyq
  version: "1.0.0"
---

# CI/CD and Release Engineering

## Mission

Build a delivery system that makes the safe path the easy path.

CI/CD is not "a YAML file that runs tests." It is the automated control plane that turns source changes into trusted, reproducible, observable, and recoverable releases.

A strong pipeline should answer:

- What exact source and dependencies produced this artifact?
- Which checks proved it safe enough for this risk level?
- Can untrusted pull-request code reach secrets or privileged runners?
- Are third-party actions and build dependencies trusted and pinned?
- Are cloud credentials short-lived and least-privileged?
- Are we deploying the exact artifact that passed verification?
- Can old and new versions coexist during rollout?
- What happens if deployment succeeds only partially?
- What signals decide whether rollout continues?
- How do we stop, roll back, or roll forward?
- Can an operator reconstruct what happened later?

## Core principles

1. **Classify before configuring.** Repository type and release risk determine gates.
2. **Build once, promote the same artifact.** Do not rebuild independently per environment.
3. **Untrusted code never gets privileged credentials by accident.**
4. **Least privilege is the default.** Scope workflow tokens, environment secrets, and cloud roles narrowly.
5. **Prefer short-lived identity.** Use OIDC/federated identity instead of long-lived cloud keys where supported.
6. **Pin the release inputs.** Lock dependencies and pin third-party Actions/reusable workflows to immutable revisions when feasible.
7. **Provenance matters.** Record commit, build inputs, artifact digest, and attestations for important releases.
8. **Fast feedback and trustworthy feedback both matter.**
9. **Flaky gates are broken gates.** Do not normalize rerun-until-green.
10. **Deployments are state transitions, not file copies.**
11. **Observe the release while it changes production.**
12. **Rollback is designed before failure, not during it.**
13. **Database/configuration changes are part of release engineering.**
14. **Pipeline security is software security.**
15. **Automation reduces toil only when humans can still understand and override it safely.**

## Classify the repository

### Application/service
Load:
- `profiles/application-service.md`
- `references/quality-gates.md`
- `references/deployment-and-progressive-delivery.md`
- `references/observability-and-release-health.md`

### Database-backed service
Also load:
- `profiles/database-backed-service.md`
- `references/database-and-schema-delivery.md`

### Container/image producer
Also load:
- `profiles/container-artifact.md`
- `references/artifacts-provenance-and-supply-chain.md`

### Package/library/SDK
Load:
- `profiles/library-package.md`
- `references/versioning-and-publishing.md`

### Static/public web
Load:
- `profiles/static-web.md`

### Monorepo
Also load:
- `profiles/monorepo.md`
- `references/pipeline-performance-and-cost.md`

### Infrastructure/configuration
Load:
- `profiles/infrastructure-config.md`
- `references/deployment-and-progressive-delivery.md`

### Open-source / fork-heavy repository
Load:
- `profiles/open-source-forks.md`
- `references/workflow-security.md`

## Required workflow

### 1. Inspect before editing

Inspect:
- `.github/workflows/` or equivalent CI configuration;
- package/build manifests and lockfiles;
- test/lint/typecheck/build commands;
- release/publish scripts;
- container definitions;
- database migrations;
- infrastructure-as-code;
- environment/deployment configuration;
- branch/ruleset expectations;
- artifact registry;
- deployment platform;
- current secrets/auth method;
- observability/health checks;
- previous release/rollback conventions.

Do not replace working conventions without a reason.

Run `scripts/ci-audit` when available as a discovery aid. Treat its findings as prompts for review, not complete security proof.

### 2. Define the change path

Map:

```text
source change
  ↓
verification
  ↓
build
  ↓
artifact identity
  ↓
publish/store
  ↓
pre-production verification
  ↓
production rollout
  ↓
health evaluation
  ↓
promote / halt / rollback
```

For libraries, replace deployment with versioning/publishing/consumer verification.

### 3. Identify trust boundaries

Explicitly classify workflow inputs as:
- trusted repository code;
- untrusted pull-request/fork code;
- third-party action code;
- dependency/install scripts;
- uploaded/downloaded artifacts;
- cache content;
- environment secrets;
- cloud identity;
- self-hosted runner environment.

For GitHub Actions, privileged triggers such as `pull_request_target` or privileged `workflow_run` flows require special care. Never check out and execute untrusted PR code in a privileged context.

Read `references/workflow-security.md`.

### 4. Design gates by risk

Do **not** force every job onto every change.

Possible gates:
- formatting/lint;
- static/type analysis;
- unit tests;
- integration tests;
- contract/compatibility tests;
- build/package;
- database migration tests;
- E2E;
- security scanning;
- dependency review;
- license policy;
- secret scanning/push protection;
- container/IaC scanning;
- SBOM/provenance/attestation;
- bundle/performance budget;
- accessibility;
- smoke tests;
- deployment health checks.

Use `references/quality-gates.md`.

Cheap, deterministic checks should usually fail quickly. Expensive checks may run in parallel after prerequisites or be scoped by change impact.

### 5. Separate PR validation from privileged release

A pull request from an untrusted fork should be able to prove code quality without receiving production secrets or privileged credentials.

Typical model:

```text
PR/fork
  └─ read-only validation
      ├─ lint/types
      ├─ tests
      └─ build

trusted main/tag
  └─ privileged release
      ├─ build/publish artifact
      ├─ attest/sign
      └─ deploy/promote
```

Do not solve fork CI by exposing secrets to fork jobs.

### 6. Minimize permissions

For GitHub Actions:
- explicitly set `permissions`;
- begin from read-only;
- add write scopes only to jobs that require them;
- give `id-token: write` only where OIDC is needed;
- gate production secrets behind protected environments;
- separate build and deployment credentials.

Do not assume an Action cannot access `github.token` merely because it was not passed explicitly.

### 7. Secure third-party workflow dependencies

For third-party Actions/reusable workflows:
- prefer trusted maintainers;
- pin to a full commit SHA where your policy allows, recording the human-readable release in a comment;
- use dependency automation to keep pins current;
- avoid unnecessary Actions when a small transparent shell step is safer;
- review changes to workflow dependencies like code dependencies.

Never treat `@main` as an immutable release.

### 8. Use reproducible build inputs

Prefer:
- lockfiles;
- pinned tool/runtime versions according to project policy;
- deterministic build configuration;
- clean/ephemeral build environments;
- versioned build tooling;
- controlled external inputs.

Do not let a production artifact depend accidentally on whatever happens to be installed on a runner.

### 9. Build once and identify the artifact

Create one release artifact from one source revision.

Record:
- commit SHA;
- version/build ID;
- artifact digest;
- build time;
- relevant dependency/build metadata.

Publish it to an artifact/package/container registry.

Promote the **same artifact digest** across environments rather than rebuilding source separately for staging and production.

### 10. Preserve provenance and integrity

For important distributable artifacts:
- generate provenance/attestation where the platform supports it;
- attach SBOM where useful/required;
- sign or attest release artifacts according to threat model;
- verify provenance before high-trust deployment where supported.

GitHub Artifact Attestations can establish build provenance for binaries and container images. SLSA provides a model for verifiable build provenance and increasing build integrity.

Read `references/artifacts-provenance-and-supply-chain.md`.

### 11. Authenticate deployments without long-lived cloud keys

Where supported, prefer workload identity/OIDC from CI to the cloud provider.

Scope identity conditions to:
- repository;
- branch/tag;
- workflow;
- environment;
- audience/subject claims

as supported by the provider.

Rotate/remove obsolete static deployment credentials after migration.

### 12. Use environment protections

For sensitive environments:
- restrict deploy branches/tags;
- use required approval only where it reduces risk;
- prevent self-approval where appropriate;
- use environment-specific secrets/variables;
- serialize production deployment when concurrent release mutation is unsafe;
- use automated protection rules tied to observability/security/change-management systems when justified.

Manual approval is not automatically safer. Prefer automated evidence when it is more reliable.

### 13. Handle database/config compatibility

Before deployment determine whether:
- old app + new schema works;
- new app + old schema works during rollout;
- migration locks tables or rewrites large data;
- rollback is possible after data transformation;
- backfills are bounded and observable;
- destructive cleanup must be delayed until old versions disappear.

Prefer expand → migrate/backfill → contract for risky zero-downtime changes.

Read `references/database-and-schema-delivery.md`.

### 14. Deploy progressively when blast radius warrants it

Choose based on risk:
- direct/atomic deployment;
- rolling;
- blue-green;
- canary;
- feature-flagged release;
- region/tenant/cohort staged rollout.

A canary is not merely "deploy to 10%." It requires:
- control/baseline;
- observation period;
- success/failure signals;
- promotion criteria;
- automatic/manual halt;
- rollback path.

Google SRE guidance treats progressive rollout and canary evaluation as a release-safety mechanism.

### 15. Evaluate release health

Observe user and system outcomes during rollout.

Potential signals:
- availability/error rate;
- latency;
- saturation/resource errors;
- queue backlog;
- failed jobs;
- business transaction success;
- client error/crash rate;
- SLO burn rate;
- deployment-specific logs/traces.

Prefer symptoms tied to user impact over noisy internal metrics.

Read `references/observability-and-release-health.md`.

### 16. Roll back first when safety requires it

When a rollout is clearly harming production and rollback is safe:
- halt promotion;
- restore known-good artifact/config;
- verify recovery;
- then diagnose.

Do not improvise an untested hotfix while impact continues if a trusted rollback exists.

Know when rollback is **not** safe, especially after irreversible data migration. In that case, use roll-forward/compensation.

### 17. Make CI feedback useful to agents and humans

On failure:
- preserve full logs;
- upload test reports/screenshots/traces;
- surface concise job summaries;
- distinguish infrastructure failure from product failure;
- include exact failed command/test;
- avoid hiding the first useful error in megabytes of output.

An agent may repair failures, but it must reproduce/verify locally or in an equivalent environment when practical before pushing another attempt.

Do not create an infinite "agent pushes → CI fails → agent pushes" loop.

### 18. Treat flakiness as a defect

When a test intermittently fails:
- record evidence;
- reproduce;
- fix race/time/global-state/network dependence;
- quarantine only with an owner, issue, and deadline when necessary;
- do not make blind retries the normal definition of green.

Retries may be diagnostic or temporarily bounded, not a substitute for reliability.

### 19. Optimize pipeline flow after correctness

Optimize by:
- parallel independent jobs;
- dependency/tool caches with a cache threat model;
- change-aware task selection;
- test sharding;
- build graph/remote cache;
- reusable workflows;
- canceling superseded PR validation;
- right-sized runners;
- avoiding duplicated installs/builds.

Do not impose a universal "under 10 minutes" requirement. Measure:
- time to first useful failure;
- p50/p95 PR feedback;
- queue time;
- total compute cost;
- critical-path duration.

Read `references/pipeline-performance-and-cost.md`.

### 20. Measure delivery outcomes

Track at team/service level when useful:
- change lead time;
- deployment frequency;
- change fail percentage;
- failed-deployment recovery time.

DORA research treats throughput and stability as complementary dimensions, not opposites.

Do not game metrics by splitting meaningless deployments or hiding incidents.

### 21. Final adversarial review

**Trust**
- Can untrusted code reach secrets, write tokens, caches, privileged artifacts, or self-hosted runners?
- Are third-party Actions mutable?

**Artifact**
- Can I prove which source produced production?
- Is production running the same artifact that passed release checks?

**Deployment**
- Can two deployments race?
- Can old/new versions coexist?
- What if rollout stops halfway?

**Data**
- Does rollback still work after migration?
- Can backfill be paused/resumed?

**Detection**
- How will we know within minutes that this release is worse?
- What specific metric halts promotion?

**Recovery**
- Is rollback tested?
- Does rollback restore config/schema compatibility too?

**Pipeline**
- Are flaky tests masking real regressions?
- Is the pipeline so slow people bypass it?

**Security**
- Are cloud credentials long-lived?
- Could a compromised dependency/action modify releases?

## Definition of done

A CI/CD change is done when applicable items are true:
- repository/change risk is classified;
- PR and privileged release trust boundaries are explicit;
- permissions are least-privileged;
- untrusted code cannot access protected credentials;
- quality gates reflect actual project risk;
- build inputs are controlled;
- release artifact has stable identity/digest;
- staging/production promote the same artifact where applicable;
- provenance/SBOM/signing requirements are satisfied where applicable;
- deployment credentials are short-lived when supported;
- production environment protections are appropriate;
- concurrency/race behavior is controlled;
- schema/config compatibility is addressed;
- rollout strategy matches blast radius;
- health signals and promotion criteria exist;
- rollback/roll-forward path exists;
- CI failures provide useful artifacts/logs;
- flaky checks are not normalized;
- pipeline performance is measured and reasonable;
- delivery/recovery can be audited after the fact.

Use `checklists/pipeline-definition-of-done.md` and `checklists/release-definition-of-done.md`.

## Rejection rules

Reject or challenge:
- privileged `pull_request_target` workflows that execute untrusted PR code;
- write-all `GITHUB_TOKEN` permissions by default;
- cloud access keys stored as long-lived repository secrets when OIDC is supported;
- third-party Actions referenced only by mutable branches;
- production deployments from arbitrary branches;
- build-in-production workflows that bypass verified artifacts;
- independent staging and production rebuilds of the same source;
- caches containing secrets or trusted executable state writable by untrusted workflows;
- self-hosted runners exposed to untrusted fork code;
- "rerun until green";
- destructive DB migration + immediate old-code removal in one unsafe step;
- canary without success/failure criteria;
- deployment without observation;
- rollback workflow that has never been exercised;
- security gate consisting only of `npm audit`;
- CI optimized by deleting meaningful tests;
- "manual testing is enough" for repeatable critical checks;
- "manual approval makes it safe" without evidence.

## Context discipline

Load only references relevant to the current repository and release path. Do not turn a simple package-publish workflow into an enterprise deployment platform.
