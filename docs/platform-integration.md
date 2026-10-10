# Platform integration plan

Zelyq started as the open-source Vibe: an agent that builds apps. This plan brings the developer
modules from the old Crowpus platform into it, one at a time, so Zelyq becomes the place where
you **build** an app, **store its secrets**, and **ship it through a pipeline**.

Nothing is copied. The Python is reference material; each module is written again in TypeScript
on Zelyq's own foundations.

## What Zelyq already gives us

The old modules each carried their own copy of these. Here they already exist, and every new
module must use them rather than build its own:

| Need | Already in Zelyq | Where |
| --- | --- | --- |
| Who may do what | Team roles: viewer / editor / admin / owner | `apps/server/src/services/access.ts` |
| Encryption at rest | `SecretBox`, AES-256-GCM, versioned format | `apps/server/src/services/secrets.ts` |
| Running commands | `RuntimeDriver`, local or remote | `packages/runtime` |
| Who changed what | Audit log | `store.auditLog`, `AccessControl.recordChange` |
| Git | Init, commit per turn, push | `apps/server/src/services/git.ts` |
| Agent access to privileged things | Bridges: scoped tokens, the agent never holds the credential | `docs/architecture.md` |
| Two databases | SQLite + PostgreSQL, parity enforced by a test | `packages/db` |

The most important line is `RuntimeDriver`. The old CrowFlow needed its own sandbox and its own
runner fleet to execute a pipeline step. In Zelyq, a pipeline step is a shell command run through
the same driver the agent already uses, locally on a laptop or remotely on a runtime host. So most
of what was hard about CrowFlow already exists.

## What is left behind

Organisations, token billing, Stripe, pricing tiers, partner programme. Access is team-based, as it
already is in Zelyq.

Not developer-core, so not planned: Kanban, chat, meetings, note taker, WhatsApp / Telegram /
Twilio, personal assistant, org email. Dev Studio, CodeGen and StackCraft are covered by the
Zelyq agent itself.

## The stages

Each stage ends in something a person can use, shown working, before the next one starts.

### Stage 0: how a module plugs in

A short, one-time step, so stages 1 to 5 all look the same.

- Each module has a schema in both dialects, a repository, a service, routes, and a web page.
  This is the same pattern as `images` and `videos`.
- Resources are **project-scoped** and checked with `access.requireProject(user, id, role)`.
  There is no second permission system.
- Navigation: the project page gains tabs (Editor · Secrets · Pipelines · …), so the modules
  sit inside the project rather than beside it.
- Update `docs/roadmap.md` and the README, which today describe Zelyq as only an app builder.

**Done when:** one empty module (tab, route, table) is merged, and it is the template the others
copy.

### Stage 1: Vault (secrets, replacing CrowStore)

Full plan: [vault-plan.md](./vault-plan.md).

The foundation the later stages build on: pipelines, deploys and the agent all need credentials.

In scope:
- Create, list, update and delete project secrets. Values are encrypted with `SecretBox` and never
  returned in a list.
- Reveal a value: editor role or higher, written to the audit log every time.
- Versions: each update keeps the previous value, with rollback.
- Import a `.env` file.
- **Integration:** secrets become environment variables in the project's runtime (preview and
  backend), next to what `project-backend.ts` sets today. The reserved-prefix rule there still
  applies.
- **Agent:** it can see secret *names* and reference them, never the values. Uses the bridge
  pattern.

Later, not now: share links, promotion between projects, rotation schedules, secret webhooks,
dependency map, transit encryption, service keys.

**Done when:** a user stores `STRIPE_KEY`, the generated app reads it in the preview, and the
agent never sees the value.

### Stage 2: Pipelines (from CrowFlow, core only)

- A pipeline file in the project repo (`jobs → stages → steps`), deliberately smaller than the old
  `Screenplay.yaml`. Start with two step types: `checkout` and `shell`.
- Steps run through `RuntimeDriver` in the project workspace. No new sandbox and no runner fleet.
- `secret://NAME` references are resolved from Stage 1, and their values are **masked in the
  logs**.
- Executions and per-step logs are stored and streamed live over the existing WebSocket.
- Manual trigger: "Run" button. Re-run a failed execution.
- **Agent:** can write the pipeline file and read a failed run's log to fix it.

Later: matrix builds, caching, stage replay, approvals, docker / npm / kubectl / trivy / sonar
steps.

**Done when:** a project has a pipeline that installs, tests and builds, run from the UI with live
logs and secrets masked.

### Stage 3: Triggers

- Run on commit: Zelyq already commits per turn and pushes.
- Incoming git webhooks (GitHub, GitLab) with HMAC verification.
- Schedules (cron).
- Project API keys, so external CI can trigger a run. These are the old service keys, scoped to
  one project.

**Done when:** a push to GitHub starts a pipeline run without anyone opening Zelyq.

### Stage 4: Runners

For steps that must run on a specific machine (Windows builds, private networks, GPUs).

- Enrollment token → a small Node runner agent that pulls jobs. Model it on the old
  `CrowflowRunner` (key-pair auth, pools, labels), but reuse the runtime-host protocol where
  possible, rather than inventing a second wire format.
- Docker build and push steps arrive here, because they need a real Docker host.

**Done when:** a runner enrolled on a separate machine picks up and completes a job.

### Stage 5: Deploy (GitOps-lite)

Fills the existing roadmap gap "build and deploy targets".

- Deploy targets per project: a Docker host or VM over SSH, then Kubernetes.
- A deploy is a pipeline stage with an environment (dev / staging / prod) and an optional
  approval.

**Done when:** the full path works: describe an app → the agent builds it → secrets stored →
pipeline green → deployed and reachable.

### After that, only if people ask

- **Log analysis** (from Logganizer): the agent explains a failed run and proposes the fix. It
  will be small by then, because Stage 2 already gives the agent the logs.
- **Monitoring** (from Analyzer).
- **Infrastructure as code** (from ControlPlane): the largest old module; only with clear demand.
- The CrowStore extras listed under Stage 1.

## Order, and why

```
0 Module pattern
   └─ 1 Vault ───────────┐
        └─ 2 Pipelines ──┤  (pipelines resolve Vault secrets)
             ├─ 3 Triggers
             ├─ 4 Runners
             └─ 5 Deploy ┘  (deploys are pipelines that need secrets)
```

Secrets come first because everything after them consumes them. In the old code, CrowFlow tools,
runners and ControlPlane all read from the secret service. Pipelines come second because
triggers, runners and deploys are each just a new way to *start* or *place* a pipeline.

## Reference: where the old code lives

| Module | Python reference (`backendapp/backend/app`) | UI reference (`frontendapp/src`) |
| --- | --- | --- |
| Vault | `api/v1/endpoints/secrets.py`, `secret_*.py`, `models/infrastructure.py` (`ProjectSecret`), `models/secret_*.py` | `pages/dashboard/CrowStorePage.tsx`, `components/crowstore/` |
| Pipelines | `CROWFLOW_REFERENCE.txt`, `api/v1/endpoints/crowflows.py`, `services/crowflow/` | `pages/dashboard/CrowflowPage.tsx`, `components/crowflow/` |
| Triggers | `api/v1/endpoints/webhooks.py`, `models/webhook.py`, `service_keys.py` | `components/webhook/` |
| Runners | `api/v1/endpoints/crowflow_runners.py`, `models/crowflow_runner*.py` | `pages/dashboard/RunnerPage` area |
| Deploy | `api/v1/endpoints/gitops.py` | `components/gitops/` |
