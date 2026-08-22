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
- `ZELYQ_PREVIEW_HOST`, so previews are reachable when Zelyq runs on a VM or remote host.
- Automatic `.env` loading in every process, located by walking up from the working directory. Real
  environment variables take precedence over the file.
- The session records which provider produced it, and the editor shows the answering model.
- Agent tool suite: read, write, edit, list, search, and shell execution, all scoped to a project.
- Project scaffolding from templates, live preview with dev-server management, and snapshots.
- React single-page app with project list, chat, file explorer, editor, and preview panel.

[Unreleased]: https://github.com/zelyq/zelyq/compare/main...HEAD
