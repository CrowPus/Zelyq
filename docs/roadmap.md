# Roadmap

Direction, not dates. Anything here is open to a pull request — comment on the tracking issue first
so two people do not build the same thing.

## Now — the foundation

- [x] Monorepo, licensing, CI, contribution guides
- [x] `RuntimeDriver` interface with local and remote drivers
- [x] SQLite + PostgreSQL schema with parity enforcement
- [x] Agent session loop with streaming, tools, and cancellation
- [x] Project create → prompt → edit → preview, end to end
- [x] Provider interface with Claude and Gemini implementations
- [x] Accounts, sessions, teams, and role-based access control
- [ ] Reference runtime host (container per project) implementing the remote protocol
- [ ] Editable code view — write files back from the browser, not just read them
- [ ] Reconcile preview state across a server restart — dev servers are tracked in memory, so a
      restart leaves running processes orphaned and their ports held

## Next — making it usable by more than one person

- [ ] Per-user API keys, encrypted at rest
- [ ] Invitation links, so someone can be added before they register
- [ ] SSO (OIDC) as an alternative to passwords
- [ ] An audit log of who changed what
- [ ] Git integration: init, commit per turn, push to a remote
- [ ] Snapshot browsing and diffing in the UI, restore from any point
- [ ] File upload and image attachments in prompts

## Later — depth

- [ ] More templates: Next.js, plain Vite, static site, Node API
- [ ] Element inspector — click something in the preview to point the agent at it
- [ ] Automatic error recovery: feed dev-server and browser errors back into the turn
- [ ] Build and deploy targets (static hosts, containers)
- [ ] Plugin interface for third-party tools
- [ ] More providers behind the existing `ModelProvider` interface
- [ ] Per-project provider and model selection in the UI

## Explicitly not planned

- **A hosted service in this repository.** Zelyq is the engine. Hosting concerns — billing,
  quotas, tenancy — belong to whoever runs it.
- **A visual drag-and-drop builder.** The agent edits code; the code is the source of truth.
- **Vendoring a framework.** Templates are ordinary projects you could have created yourself.
