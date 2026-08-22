# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/CrowPus/Zelyq/compare/main...HEAD
