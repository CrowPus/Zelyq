# Zelyq documentation

Zelyq is an open-source developer platform: build apps with an AI agent, keep their secrets in Vault,
and test, build and deploy them on your own machines. These pages follow the sidebar: **Build**,
**Secure**, **Ship**.

## Start here

| | |
| --- | --- |
| [Getting started](./getting-started.md) | Install Zelyq, create the first account, add a model key, build your first app |
| [**Tutorial: from an app to production**](./tutorial.md) | Step by step: a secret in Vault, a pipeline, your own machine, a deploy and a roll back, GitHub pushes and pull requests, parallel stages, matrix and templates |
| [Self-hosting](./self-hosting.md) | Running Zelyq for a team: Docker, a VM, HTTPS, backups, what to keep safe |
| [Configuration](./configuration.md) | Every setting and environment variable |

## Build

**Apps** — describe an app and the agent builds it in real files.

- [Modes](./modes.md): default, Engineer, Architect and Auto
- [How the agent behaves](./agent-behaviour.md) and [skills](./skills.md)
- [Python backends](./python.md), [attachments](./attachments.md), [plugins](./plugins.md)
- `/clone`, `/figma`: [Getting started](./getting-started.md#cloning-a-site); `/cinematic`:
  [Cinematic](./cinematic.md)

**Studio** — images and video.

- [Image](./Image-gen/implementation.md), and [using it from an app](./Image-gen/agent-integration.md)
- [Video](./Video-gen/README.md), [frame export](./Video-gen/frame-export.md), and
  [using it from an app](./Video-gen/agent-integration.md)

## Secure

- [Vault](./vault.md): add, reveal and version secrets; Protected secrets; using them in apps,
  Settings, pipelines and environments; service keys and the API; `zelyq vault run` for your own
  servers

## Ship

- [Pipelines](./pipelines.md), the full reference:
  - [where a pipeline runs](./pipelines.md#where-a-pipeline-runs) and
    [adding your own machines](./pipelines.md#adding-a-machine-ssh-runner) (Linux, macOS, Windows),
    [firewalls and ports](./pipelines.md#firewalls-and-ports)
  - [visual or YAML](./pipelines.md#visual-or-yaml-two-ways-to-edit): editing a pipeline by clicking
    and dragging, with its latest run on the picture
  - [the overview](./pipelines.md#the-overview): success rates, run times and the slowest stages
  - [the file](./pipelines.md#the-file) and
    [where the files come from](./pipelines.md#where-the-files-come-from)
  - [keep the file in your repository](./pipelines.md#keep-the-file-in-your-repository): each branch
    and pull request runs its own copy
  - [built-in steps](./pipelines.md#built-in-steps): `setup`, `cache`, `docker`, `approval`
  - [stages at the same time, a machine per stage, matrix](./pipelines.md#stages-at-the-same-time-a-machine-per-stage-matrix)
  - [templates](./pipelines.md#templates-reuse-another-pipelines-stages)
  - [pipelines working together](./pipelines.md#pipelines-working-together): inputs, other
    pipelines, artifacts, one at a time, retry, keeping runs
  - [results, services and test reports](./pipelines.md#results-services-and-test-reports):
    outputs, Postgres/Redis for a run, JUnit, ✓ / ✗ on GitHub and GitLab
  - [triggers](./pipelines.md#starting-a-run-without-pressing-run): git push, pull requests,
    schedules, other CI, and [when a webhook does not start a run](./pipelines.md#when-a-webhook-does-not-start-a-run)
- [Pipeline plugins](./pipeline-plugins.md): build your own ready-made steps, pack them, install them
  in your team and use them with `plugin:`
- [Deploy](./deploy.md): environments, deploying from a pipeline, protected environments and freeze,
  automatic and one-click roll back, ports, and [a domain with HTTPS and no downtime](./deploy.md#a-domain-https-and-no-downtime), [no Dockerfile needed](./deploy.md#no-dockerfile-needed)

## How it is built

For contributors and the curious.

- [Architecture](./architecture.md), [runtime protocol](./runtime-protocol.md),
  [decision records](./adr/)
- Design notes: [Vault](./vault-standalone-plan.md), [Pipelines](./pipelines-plan.md),
  [built-in steps](./pipeline-steps-plan.md), [chaining](./pipeline-chaining-plan.md),
  [results and services](./pipeline-group2-plan.md), [Deploy](./deploy-plan.md)
