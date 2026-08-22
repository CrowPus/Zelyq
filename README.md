<div align="center">

# Zelyq

**Open-source AI app builder.** Describe an app in plain language, watch an agent build it in a
real workspace, and edit the result live — on your laptop or on your own cloud.

[![CI](https://github.com/zelyq/zelyq/actions/workflows/ci.yml/badge.svg)](https://github.com/zelyq/zelyq/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen.svg)](https://nodejs.org)

[Quickstart](#quickstart) · [Architecture](#architecture) · [Configuration](./docs/configuration.md) ·
[Self-hosting](./docs/self-hosting.md) · [Contributing](./CONTRIBUTING.md)

</div>

---

## What it is

Zelyq is the engine behind a "prompt to running app" experience, extracted into a project you can
run yourself. You give it a prompt; an agent plans, writes files, runs commands, starts a dev
server, and reports back — while you watch the diff, the file tree, and the live preview.

The design goal is that **nothing is magic and nothing is locked in**:

- **Same code, laptop or cloud.** Every filesystem and shell operation goes through one
  `RuntimeDriver` interface. `local` runs projects as child processes on your machine; `remote`
  talks to a runtime host you deploy. The rest of the system does not know the difference.
- **Bring your own model key.** Zelyq talks to Claude or Gemini with a key you supply. No proxy, no
  account required, no telemetry. Switching vendor is one environment variable.
- **Boring, inspectable storage.** SQLite by default (one file), PostgreSQL when you scale. Project
  files are plain files on disk — you can `cd` into them.

## Status

**Early.** The end-to-end path works — create a project, prompt the agent, see it write files, run
a preview — and the interfaces around it are deliberately settled first. Expect breaking changes
before `1.0`. See [ROADMAP](./docs/roadmap.md).

## Quickstart

```bash
# Requires Node >= 20.11 and pnpm >= 9
git clone https://github.com/zelyq/zelyq.git
cd zelyq
pnpm install

cp .env.example .env
# Put a key in .env — Claude:  ANTHROPIC_API_KEY=sk-ant-...
#                     Gemini:  ZELYQ_PROVIDER=google and GEMINI_API_KEY=...

pnpm db:migrate     # creates ./data/zelyq.db
pnpm dev            # server :8787, agent :8788, web :5173
```

Open <http://localhost:5173>, create a project, and type what you want built.

Prefer containers? `docker compose -f docker/docker-compose.yml up` — see
[docs/self-hosting.md](./docs/self-hosting.md).

## Architecture

Three processes and four libraries. The agent never touches your disk directly; it goes through the
runtime driver, which is the seam that makes local and cloud identical.

```
        ┌───────────────┐
        │  apps/web     │  React + Vite SPA — chat, file tree, editor, live preview
        └───────┬───────┘
                │  REST + WebSocket
        ┌───────▼───────┐
        │  apps/server  │  Fastify. Projects, files, previews, snapshots, sessions.
        │               │  Owns the database. Relays agent events to the browser.
        └───────┬───────┘
                │  HTTP + SSE
        ┌───────▼───────┐
        │  apps/agent   │  Fastify. Runs the model loop, executes tools, streams events.
        └───────┬───────┘
                │  RuntimeDriver  (the only path to disk or shell)
     ┌──────────┴───────────┐
     │                      │
┌────▼─────┐        ┌───────▼────────┐
│  local   │        │     remote     │   docker / VM / k8s runtime host
│ child_   │        │  HTTP contract │
│ process  │        │                │
└──────────┘        └────────────────┘
```

| Package | Responsibility |
| --- | --- |
| [`@zelyq/core`](./packages/core) | Domain types and the wire protocol (Zod schemas shared by every process) |
| [`@zelyq/runtime`](./packages/runtime) | `RuntimeDriver` interface + `local` and `remote` implementations |
| [`@zelyq/db`](./packages/db) | Drizzle schema and migrations, SQLite and PostgreSQL |
| [`@zelyq/tools`](./packages/tools) | The agent's tool suite, defined once over `RuntimeDriver` |

Model vendors sit behind a `ModelProvider` interface inside `apps/agent`. Claude and Gemini ship
today; adding another is a registry entry plus one implementation, with no change to the server, the
UI, or the tools.

Full detail: [docs/architecture.md](./docs/architecture.md).

## How it runs locally vs. in the cloud

|  | Local | Cloud |
| --- | --- | --- |
| Database | SQLite file (`./data/zelyq.db`) | PostgreSQL (`DATABASE_URL=postgres://…`) |
| Project files | `./workspace/<project-id>` | Volume or runtime host storage |
| Shell + dev servers | `child_process` on your machine | Runtime host (`ZELYQ_RUNTIME=remote`) |
| Auth | Off — single local user | Pluggable provider |
| Model key | Your `.env` | Per-user, stored encrypted |
| Provider | `anthropic` or `google` | Same, or chosen per session |

One environment variable (`ZELYQ_RUNTIME`) moves you between them. No code changes.

## Security

Local mode runs generated code **on your machine with your permissions**. It is meant for projects
you trust and for development. For anything multi-tenant or public, run the remote runtime with
container isolation — see [SECURITY.md](./SECURITY.md) and
[docs/self-hosting.md](./docs/self-hosting.md).

## Contributing

Issues, discussions, and pull requests are welcome. Start with
[CONTRIBUTING.md](./CONTRIBUTING.md) — it covers the dev loop, project layout, and what a good PR
looks like here. Everyone participating is expected to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](./LICENSE) © The Zelyq Authors.
