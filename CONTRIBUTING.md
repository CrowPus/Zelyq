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
assets/      Source brand assets (the served copies live in apps/web/public)
```

### Where a change usually belongs

| You want to… | Change this |
| --- | --- |
| Add an agent capability | `packages/tools` (and register it in the tool index) |
| Support a new execution target | `packages/runtime` — implement `RuntimeDriver` |
| Add a field the UI needs | `packages/core` schema first, then server, then web |
| Change persisted data | `packages/db/src/schema/*` **plus** a generated migration |
| Add a route that creates, edits, or deletes a project- or team-level thing | Call `access.recordChange(...)` after it succeeds — see `apps/server/src/services/access.ts` and the existing call sites in `apps/server/src/routes/`. A mutating route that skips this is the one way the audit log rots |

## Checks

```bash
pnpm typecheck   # every workspace
pnpm lint        # Biome
pnpm test        # node:test across workspaces
```

Please run all three before pushing. CI runs the same commands, plus one more (below) — a pass on
all four locally means a green PR.

### Secrets and dependency vulnerabilities

A separate, required CI check — **Secrets and vulnerabilities** — scans every PR for a committed
secret and any high-or-critical dependency vulnerability. It is not covered by the three commands
above, and it blocks merging the same way they do. To check it yourself before pushing:

```bash
pnpm audit --audit-level=high          # the workspace
(cd plugins && npm audit --audit-level=high)   # plugins/ has its own lockfile, outside the workspace
```

For the secret scan, install [gitleaks](https://github.com/gitleaks/gitleaks) once and run
`gitleaks detect --source . --no-banner` — it reads `.gitleaks.toml` at the repo root the same way
CI does. If a finding is a fixture that deliberately contains a fake credential, widen
`.gitleaks.toml`'s allowlist in the same PR and say why; do not lower the audit severity threshold
to get past a real one. See [SECURITY.md](./SECURITY.md#repository-scanning) for what each layer
actually covers.

## Commit and PR conventions

- `main` is protected. Every change arrives through a pull request, and CI must be green before it
  can merge. Pull before you branch — the remote moves.
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

## Releases

Versions are tagged, not published to a registry: the applications are deployed from source and the
packages are not on npm.

To cut one, add a section to [CHANGELOG.md](./CHANGELOG.md) under a version heading, then:

```bash
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

The release workflow re-runs lint, build, typecheck, and tests against the tagged commit, then
publishes a GitHub release using that changelog section as the notes. A tag whose commit does not
pass is not released.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](./SECURITY.md).

## Licence

Zelyq is source-available under the [Sustainable Use License](./LICENSE), with
"Zelyq Enterprise" components under the [Zelyq Enterprise License](./LICENSE_EE.md).
See [LICENSING.md](./LICENSING.md).

Contributions are accepted under a [Contributor License Agreement](./CLA.md). It
keeps your copyright with you while letting the project offer Zelyq under both the
Sustainable Use License and a commercial license. You accept it by signing off
your commits (`git commit -s` adds a `Signed-off-by` line) and confirming when
prompted on your first pull request. Contributions to `research/` are instead
covered by CC BY 4.0, per [research/00-front-matter/02-copyright.md](./research/00-front-matter/02-copyright.md).
