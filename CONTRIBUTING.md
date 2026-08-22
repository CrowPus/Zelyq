# Contributing to Zelyq

Thanks for being here. This document is short on purpose — the goal is to get you from clone to a
merged change without guessing.

## Ground rules

- **Discuss before you build something large.** Open an issue or a discussion first for anything
  that changes an interface, adds a dependency, or takes more than a day. Small fixes need no
  ceremony — just send the PR.
- **One concern per pull request.** A bug fix and a refactor in the same diff is two PRs.
- **Every PR keeps `main` releasable.** CI must be green; if you change behaviour, update the docs
  in the same PR.

## Development setup

```bash
node -v          # >= 20.11
corepack enable  # provides pnpm
pnpm install
cp .env.example .env   # add ANTHROPIC_API_KEY
pnpm db:migrate
pnpm dev
```

`pnpm dev` starts three processes:

| Process | Port | Command |
| --- | --- | --- |
| `apps/server` | 8787 | `pnpm dev:server` |
| `apps/agent` | 8788 | `pnpm dev:agent` |
| `apps/web` | 5173 | `pnpm dev:web` |

Run them separately when you want readable logs for one of them.

## Repository layout

```
apps/
  web/       React + Vite SPA
  server/    Fastify API, WebSocket gateway, owns the database
  agent/     Model loop and tool execution
packages/
  core/      Shared domain types and wire protocol (Zod)
  runtime/   RuntimeDriver interface + local/remote drivers
  db/        Drizzle schema, migrations, SQLite + PostgreSQL clients
  tools/     Agent tools, written once against RuntimeDriver
templates/   Starter project templates the agent scaffolds from
docs/        Architecture, configuration, self-hosting, ADRs
```

### Where a change usually belongs

| You want to… | Change this |
| --- | --- |
| Add an agent capability | `packages/tools` (and register it in the tool index) |
| Support a new execution target | `packages/runtime` — implement `RuntimeDriver` |
| Add a field the UI needs | `packages/core` schema first, then server, then web |
| Change persisted data | `packages/db/src/schema/*` **plus** a generated migration |

## Checks

```bash
pnpm typecheck   # every workspace
pnpm lint        # Biome
pnpm test        # node:test across workspaces
```

Please run all three before pushing. CI runs the same commands, so a local pass means a green PR.

## Commit and PR conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat(runtime): add docker driver`, `fix(server): release preview port on delete`.
- PR titles use the same format — the changelog is generated from them.
- Describe **what changed and why**, and how you verified it. Screenshots or a short clip for UI
  changes.
- Reference the issue with `Closes #123`.

## Adding a dependency

Dependencies are a long-term cost. Before adding one, check it is actively maintained, has a
compatible licence (Apache-2.0, MIT, BSD, ISC), and is not replaceable by ~30 lines of code. Say why
in the PR description.

## Architecture decisions

Non-obvious or hard-to-reverse decisions get an ADR in [`docs/adr/`](./docs/adr). Copy the format of
an existing one. An ADR is a paragraph of context, the decision, and the consequences — not an
essay.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](./SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](./LICENSE).
