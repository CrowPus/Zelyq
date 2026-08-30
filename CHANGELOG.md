# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An eval harness (`pnpm eval`) that runs the agent against a suite of realistic prompts in throwaway
  projects and scores the result on machine-checkable facts: does the typecheck pass, does the build
  pass, does the dev server serve an app whose every module compiles, and did the agent change more
  than it needed to. Two runs can be compared with `--compare`, so a change to the system prompt or a
  tool description can be defended with a number. See
  [apps/agent/evals](apps/agent/evals/README.md).

### Changed

- **License changed from Apache-2.0 to the GNU AGPL-3.0.** Zelyq is open source: run it, modify it,
  self-host it, fork it, with no usage restriction. If you run a *modified* Zelyq as a network
  service, the AGPL requires you to offer users your source. A **commercial license** — the same
  code without that requirement — is available for embedding Zelyq in a closed product or for
  organisations that cannot use AGPL. Features designated "Zelyq Enterprise" (`ee/` paths) are a
  separate paid subscription under the Zelyq Enterprise License. Contributions are accepted under a
  Contributor License Agreement (`CLA.md`), which the dual-license needs. Releases up to and
  including `v0.1.0` remain available under Apache-2.0. See `LICENSE`, `LICENSE_EE.md`,
  `LICENSING.md`, and [ADR 0005](docs/adr/0005-agpl-3.0-and-dual-licensing.md). (An interim move to
  the source-available Sustainable Use License, ADR 0004, was reversed before any release carried
  it.)
- The README and `SECURITY.md` now state plainly that no reference runtime host ships yet, so
  `ZELYQ_RUNTIME=remote` currently means implementing the protocol yourself, and that local mode is
  not a sandbox. The `remote` driver was always documented; the host it talks to was not, and the
  distinction matters before deploying.
- The roadmap is reordered around measurable agent quality first, then per-turn review and revert,
  then the deployment story.

## [0.1.0] - 2026-08-22

First tagged release. Everything below is new.

### Added

- Initial project structure: `web`, `server`, and `agent` applications with the `core`, `runtime`,
  `db`, and `tools` packages.
- `RuntimeDriver` interface with a local (child process) driver and a remote HTTP driver, selected
  by `ZELYQ_RUNTIME`.
- Drizzle schema and migrations for SQLite and PostgreSQL.
- Agent session loop with streaming events over Server-Sent Events, relayed to the browser over
  WebSocket.
- `ModelProvider` interface with Claude and Google Gemini implementations, selected with
  `ZELYQ_PROVIDER`; each provider carries its own default model and API key variables.
- `GET /providers` on the agent, reporting every provider and whether a usable key is present.
- A settings screen for instance administrators covering the model provider, API keys, registration,
  session length, and preview host, so an instance can be configured without editing `.env`.
  Environment variables take precedence and are shown locked; stored API keys are encrypted with
  AES-256-GCM and never returned to the browser.
- An instance-level administrator role, distinct from team roles, held by the first account. A
  backfill migration promotes the earliest account on instances that predate it.
- Accounts, sessions, and teams: registration and sign-in, an httpOnly session cookie backed by a
  hashed token, scrypt password hashing, and role-based access control (`viewer`, `editor`, `admin`,
  `owner`) enforced on every REST route and on the WebSocket handshake.
- Brand mark and favicons, with trimmed and sized derivatives generated from the source logo.
- `ZELYQ_PREVIEW_HOST`, so previews are reachable when Zelyq runs on a VM or remote host.
- Automatic `.env` loading in every process, located by walking up from the working directory. Real
  environment variables take precedence over the file.
- The session records which provider produced it, and the editor shows the answering model.
- Agent tool suite: read, write, edit, list, search, and shell execution, all scoped to a project.
- Project scaffolding from templates, live preview with dev-server management, and snapshots.
- React single-page app with project list, chat, file explorer, editor, and preview panel.

[Unreleased]: https://github.com/CrowPus/Zelyq/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CrowPus/Zelyq/releases/tag/v0.1.0
