# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Frame export in Video Studio** — split a finished clip into a numbered image sequence, in WebP,
  JPEG, PNG or AVIF, at a chosen frame count and width. The output is deliberately the exact shape
  the bundled `cinematic-web` scroll-scrub recipe already reads: `frame_0001.webp…`, a `poster`, and
  a `manifest.json` carrying the count and dimensions, so a scroll-scrubbed hero can be built from a
  generated clip without hand-extracting anything. That recipe previously had to tell the agent to
  ask the user for a pre-extracted sequence, because no `ffmpeg` was available; `ffmpeg-static` is
  now packaged the same way `ffprobe-static` already was. Download the whole set as one ZIP, or fetch
  frames individually. Re-extracting replaces the previous set, frame bytes count against the same
  storage budget as clips, and deleting the video takes its frames with it. See
  [frame export](docs/Video-gen/frame-export.md). Packaging ffmpeg also gave every finished video a
  real **poster**, taken from the middle of the clip — a text-to-video result previously showed a
  grey film icon in the library, because the only picture it could offer was a starting image it
  never had.

- **Video Studio** — a signed-in page at `/video-studio` for generating short clips from a prompt or
  animating a still image, with Google (Veo) and xAI (Grok Imagine) adapters, each with its own key
  and model. Ratio, duration, resolution and audio are offered only where the selected model supports
  them, and rejected server-side otherwise. A starting frame can be uploaded or chosen from your
  Image Studio library, in which case it is copied into video storage so deleting the original image
  cannot break an accepted job. Video generation is long and asynchronous, so the work is built
  around that rather than around the image contract: the provider's operation handle is persisted
  before it is needed, polling resumes after a restart, leases are fenced so two workers cannot both
  commit, and a submission whose outcome cannot be established is reported as unconfirmed instead of
  being silently retried — it may already have been billed. Finished clips are saved to private
  storage and keep playing after the provider's temporary URL expires, streamed to their owner with
  HTTP range support so seeking works. Queued jobs can be cancelled; submitted ones say plainly that
  they cannot. Capacity and spending are bounded by `ZELYQ_VIDEO_CONCURRENCY` and
  `ZELYQ_VIDEO_HOURLY_LIMIT`, both separate from images so a slow clip cannot occupy an image slot.
  See [Video Studio](docs/Video-gen/README.md).

- **Image Studio** — a signed-in page at `/image-studio` for generating original images from a
  prompt, independent of any project or agent session. OpenAI (GPT Image), Google (Nano Banana) or
  xAI (Grok Imagine), each with its own key and model, configured in Settings or by environment.
  Aspect ratio and quality limited to what the chosen provider actually supports, up to three
  reference images on OpenAI and Google, a private per-user library with history and PNG downloads,
  and durable jobs that survive a refresh or a restart. Images are private authenticated assets in
  `ZELYQ_IMAGE_ASSETS_DIR`, not public static files — back that directory up with the database. See
  [Image Studio](docs/Image-gen/implementation.md).
- **The build agent can generate and place images.** Switch it on for a project (a toggle in the
  chat toolbar, persisted, **off by default**) and the agent gets `generate_image`,
  `place_generated_image` and `list_generated_images`. It never holds the image API key: the tools
  call the server over a short-lived session bridge, the same pattern the Supabase migration tools
  use. The server generates as the connecting user, so anything the agent makes appears in that
  person's own Image Studio library, labelled with the project that made it. Reuse of an image you
  generated yourself costs nothing. Spending is bounded by `ZELYQ_IMAGE_HOURLY_LIMIT` per user
  (shared with Studio) and `ZELYQ_IMAGE_SESSION_LIMIT` per conversation, so a retry loop — or an
  instruction hidden in a cloned repository — cannot drain an hour's budget in one turn. The prompt
  keeps generated artwork away from anything the copy claims is real; a generated landmark is not a
  photograph of it. See [agent integration](docs/Image-gen/agent-integration.md).

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
