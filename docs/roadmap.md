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

- [ ] Close the verification loop: when files changed, run the typecheck and read the preview logs
      automatically, and feed a failure back into the turn instead of ending it. The system prompt
      asks the model to verify; nothing makes it. This is the largest single source of "it built me
      something broken"
- [x] Editable code view — write files back from the browser, not just read them
- [x] Reconcile preview state across a server restart, and between the agent and the server, which
      each hold their own driver
- [ ] Carry tool context across an agent restart. Conversations are rebuilt from message text, so a
      restart loses which files the agent read and what it already tried

## Next — a change record you can trust

The pieces exist — snapshots, restore, and a full tool transcript per message — but nothing is
automatic and nothing is visible. Making an agent turn something you can inspect and undo is what
separates this from a chat with a black box.

- [ ] A snapshot per turn, taken automatically
- [ ] Diff per turn in the transcript — what actually changed, collapsed by default
- [ ] Revert to any turn, in one click
- [ ] An audit log of who changed what

## Then — deployable by a team

- [ ] Reference runtime host (container per project) implementing the remote protocol. Until this
      exists there is no sandbox: agent shell commands run as the server's user. See
      [SECURITY.md](../SECURITY.md)
- [ ] Per-user API keys, encrypted at rest
- [ ] Invitation links, so someone can be added before they register
- [ ] SSO (OIDC) as an alternative to passwords
- [ ] Git integration: init, commit per turn, push to a remote

## Later — depth

- [ ] More templates: Next.js, plain Vite, static site, Node API
- [ ] Element inspector — click something in the preview to point the agent at it
- [ ] A headless browser in the eval harness, so a component that throws on render is caught
- [ ] Build and deploy targets (static hosts, containers)
- [ ] Plugin interface for third-party tools
- [ ] File upload and image attachments in prompts
- [ ] Per-project provider and model selection in the UI

## Explicitly not planned

- **A hosted service in this repository.** Zelyq is the engine. Hosting concerns — billing,
  quotas, tenancy — belong to whoever runs it.
- **A visual drag-and-drop builder.** The agent edits code; the code is the source of truth.
- **Vendoring a framework.** Templates are ordinary projects you could have created yourself.
- **More model providers, for now.** Two are enough to prove the `ModelProvider` interface holds.
  A third is work nobody has asked for — open an issue if you are the one asking.
