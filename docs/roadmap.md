# Roadmap

Direction, not dates. Anything here is open to a pull request — comment on the tracking issue first
so two people do not build the same thing.

The ordering below follows one principle: **an agent you cannot measure, review, or undo is not
something a team can adopt.** Quality first, then the change record, then the deployment story.

## Done — the foundation

- [x] Monorepo, licensing, CI, contribution guides
- [x] `RuntimeDriver` interface with local and remote drivers
- [x] SQLite + PostgreSQL schema with parity enforcement
- [x] Agent session loop with streaming, tools, and cancellation
- [x] Project create → prompt → edit → preview, end to end
- [x] Provider interface with Claude and Gemini implementations
- [x] Accounts, sessions, teams, and role-based access control
- [x] Eval harness — a scored suite that says whether a prompt change helped
      ([apps/agent/evals](../apps/agent/evals/README.md))

## Now — quality you can measure

- [x] Close the verification loop: when files changed, run the typecheck and read the preview logs
      automatically, and feed a failure back into the turn instead of ending it. See
      [docs/agent-behaviour.md](../docs/agent-behaviour.md#automatic-verification) — a project with
      neither a `typecheck` nor a `build` script gets no automatic check, and a preview that stays
      "running" is treated as passing, not proven correct
- [x] Editable code view — write files back from the browser, not just read them
- [x] Reconcile preview state across a server restart, and between the agent and the server, which
      each hold their own driver
- [x] Carry tool context across an agent restart. Each provider reconstructs its own native
      tool_use/tool_result shape from what a past turn actually did, the same construction it
      already uses for a live turn
- [x] **Architect Mode** — interview, a full `architecture/` design package (decisions, data model,
      API, `DESIGN.md`, a task build plan), reviewable before any code exists; then bounded builder
      dispatch, a separate verification session, and a checklist relayed verbatim. See
      [modes.md](./modes.md)
- [x] **Auto Mode** — the Architect runs the build passes itself to a hard ceiling (tokens / passes
      / wall-clock), with stuck detection and an always-live Stop
- [x] **Named specialist agents** — the first is the **Designer**: it owns `DESIGN.md`, surveys the
      project, authors or deepens the design system, implements it, and its work streams to the chat
      as a labelled sub-thread. Callable from Engineer Mode with `design_pass`

## Next — a change record you can trust

The pieces exist — snapshots, restore, and a full tool transcript per message — but nothing is
automatic and nothing is visible. Making an agent turn something you can inspect and undo is what
separates this from a chat with a black box.

- [x] A snapshot per turn, taken automatically
- [x] Diff per turn — click a changed file to see the lines added and removed
- [x] Revert to any turn, in one click
- [x] An audit log of who changed what — project- and team-level actions (see
      [docs/architecture.md](../docs/architecture.md)); instance-wide actions and per-prompt
      attribution are named follow-ups, not silently expanded into or dropped

## Then — deployable by a team

- [x] Reference runtime host implementing the remote protocol, with a conformance suite both
      drivers pass ([apps/runtime-host](../apps/runtime-host))
- [ ] Isolate execution: a container per project, resource limits, restricted egress.
      **Partly done** — `ZELYQ_RUNTIME=container` runs agent shell commands *and the dev server
      preview* in a container per project, with resource limits, no reachability between projects,
      and the cloud metadata endpoint blocked. General egress filtering exists as an opt-in,
      operator-maintained allowlist (`ZELYQ_CONTAINER_EGRESS_ALLOWLIST`) rather than a default —
      deliberately: an address like `registry.npmjs.org` resolves to a moving set Zelyq cannot
      promise to keep current, and a wrong default breaks real installs instead of failing safely.
      Still open: unfiltered by default until an operator opts in. See [SECURITY.md](../SECURITY.md)
- [ ] Per-user API keys, encrypted at rest
- [ ] Invitation links, so someone can be added before they register
- [x] SSO (OIDC) as an alternative to passwords — authorization code + PKCE, provider discovery,
      verified-email linking, identity persistence, and the existing httpOnly session cookie. See
      [docs/configuration.md](./configuration.md#single-sign-on-oidc)
- [x] Git integration: init, commit per turn, push to a remote — real git, server-orchestrated,
      never through the agent's own shell tool (already blocked there). Push is manual and
      on-demand, never automatic, never `--force`; a token is used once and never stored. Needs
      `git` on whatever `ZELYQ_RUNTIME=container` image is configured — the default project
      container image does not ship it today, the same gap clone already had

## Later — depth

- [ ] More templates: Next.js, plain Vite, static site, Node API
- [x] Element inspector — click something in the preview to point the agent at it. Works on
      projects not started from the Zelyq template too — the bridge script is patched into an
      existing project's `index.html` the first time its preview starts
- [x] A headless browser in the eval harness, so a component that throws on render is caught
- [x] Agent vision: a `view_preview` tool lets the agent screenshot its own running preview and
      actually look at it, not just read the code that produced it. Reaches for it on its own
      judgement, not automatically on every turn — costs real image tokens, so the tool's own
      description says when it's worth calling. Ships with a real headless Chromium in the
      production image (`docker/Dockerfile`), not left as an open gap
- [ ] Build and deploy targets (static hosts, containers)
- [x] Plugin interface for third-party tools — `ZELYQ_PLUGIN_DIR`, loaded once at boot. See
      [docs/plugins.md](../docs/plugins.md)
- [x] Skills: packaged, expert instructions for one kind of task, loaded on demand instead of
      carried by every session's prompt — a name and description sit in context cheaply, the full
      body loads through `use_skill` only when a task actually matches. Ships with two, for the
      template's own stack, plus `ZELYQ_SKILLS_DIR` for your own, plus an upload button in Settings
      so adding one doesn't require touching the filesystem — takes effect on the agent's next
      restart. Uploading a plugin is a separate, harder question (a plugin is code, not text) and
      isn't built yet. See [docs/skills.md](../docs/skills.md)
- [x] A `/` menu in the composer — skills, plugins, and models, filtered as you type, anywhere in
      the message, not just at the start. A picked skill's full body is guaranteed woven into the
      message the model reads on turn one; a picked plugin, honestly weaker since it has no body to
      weave, becomes a plain instruction naming the tool instead. See [docs/skills.md](../docs/skills.md)
      and [docs/plugins.md](../docs/plugins.md)
- [x] File upload and image attachments in prompts — images reach the model natively; other files
      are inlined as text
- [ ] Per-project provider and model selection in the UI

## Explicitly not planned

- **A hosted service in this repository.** Zelyq is the engine. Hosting concerns — billing,
  quotas, tenancy — belong to whoever runs it.
- **A visual drag-and-drop builder.** The agent edits code; the code is the source of truth.
- **Vendoring a framework.** Templates are ordinary projects you could have created yourself.
- **More model providers, for now.** Two are enough to prove the `ModelProvider` interface holds.
  A third is work nobody has asked for — open an issue if you are the one asking.
