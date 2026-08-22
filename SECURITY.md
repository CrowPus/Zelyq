# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub's
[Report a vulnerability](https://github.com/zelyq/zelyq/security/advisories/new) form, or email
`security@zelyq.dev`.

Include what you can: affected version or commit, reproduction steps, and impact. You will get an
acknowledgement within 3 working days and an assessment within 10. We will keep you updated through
the fix and credit you in the advisory unless you prefer otherwise.

## Supported versions

Zelyq is pre-1.0: only the latest release on `main` receives security fixes.

## Threat model — read this before deploying

Zelyq runs code that a language model writes. That is the product, and it means the runtime boundary
is the security boundary.

### Local mode (`ZELYQ_RUNTIME=local`) — the default

Generated code and agent shell commands run as **child processes of the server, with your user's
permissions**. The runtime confines file operations to the project directory, but a shell command
is a shell command: it can reach anything your user can reach.

Local mode is appropriate for a single trusted developer working on their own machine. It is **not**
a sandbox. Do not expose a local-mode instance to other people, and do not point it at prompts or
projects you do not trust.

### Remote mode (`ZELYQ_RUNTIME=remote`) — required for shared deployments

Execution moves to a runtime host you deploy, which should isolate each project (container or VM),
apply CPU, memory, disk, and process limits, restrict egress to what projects need, and run
unprivileged with a read-only base image.

Anything multi-tenant, internet-reachable, or handling other people's data must run in remote mode.

### What Zelyq does and does not protect

Enforced today:

- Path traversal defence — every file operation resolves inside the project root and rejects
  escapes and symlinks that leave it.
- Command timeouts and captured output limits.
- Model API keys read from the environment; never logged and never returned by the API.

Not provided by the core (supply it in your deployment):

- Authentication and multi-tenancy — the default build has a single implicit local user.
- Network egress filtering for generated code.
- Rate limiting and quota enforcement.
- Secret scanning of generated files.

## Handling credentials

Keep API keys in environment variables or your platform's secret store — never in the database, the
repository, or a project's workspace. Zelyq redacts values matching known key formats from log
output, but that is defence in depth, not a guarantee: treat agent transcripts as sensitive.
