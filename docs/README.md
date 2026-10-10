# Zelyq documentation

Zelyq is an open-source developer platform: build apps with AI, keep their secrets safe, and ship
them. These pages follow the sidebar.

## Start here

- [Getting started](./getting-started.md): install, the first account, your team, your first app
- [Self-hosting](./self-hosting.md): running it for a team, backups, what to keep safe
- [Configuration](./configuration.md): every setting and environment variable

## Build

**Apps:** describe an app and the agent builds it in real files.

- [Modes](./modes.md): default, Engineer, Architect, Auto
- [How the agent behaves](./agent-behaviour.md) and [skills](./skills.md)
- [Python backends](./python.md), [attachments](./attachments.md), [plugins](./plugins.md)
- `/clone`, `/figma`, `/motion`, `/cinematic`: see [getting started](./getting-started.md) and
  [cinematic](./cinematic.md)

**Studio:** images and video.

- [Image](./Image-gen/implementation.md) and [using it from an app](./Image-gen/agent-integration.md)
- [Video](./Video-gen/README.md), [frame export](./Video-gen/frame-export.md), and
  [using it from an app](./Video-gen/agent-integration.md)

## Secure

- [Vault](./vault.md): secrets, Protected keys, app variables, keys in Settings, service keys, the
  API, and `zelyq vault run`

## Ship

- [Pipelines](./pipelines.md): test, build and deploy on this server or your own machines over
  SSH (Linux, macOS, Windows); triggers, artifacts, notifications

Deploy is next. See the [roadmap](./roadmap.md) and the [platform plan](./platform-integration.md).

## How it is built

- [Architecture](./architecture.md), [runtime protocol](./runtime-protocol.md),
  [decision records](./adr/)
- [Vault design](./vault-standalone-plan.md)
- [Pipelines design](./pipelines-plan.md)
