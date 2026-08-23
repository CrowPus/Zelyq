# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub's
[Report a vulnerability](https://github.com/CrowPus/Zelyq/security/advisories/new) form, which opens a
draft advisory visible only to you and the maintainers.

Include what you can: affected version or commit, reproduction steps, and impact. You will get an
acknowledgement within 3 working days and an assessment within 10. We will keep you updated through
the fix and credit you in the advisory unless you prefer otherwise.

## Supported versions

Zelyq is pre-1.0: only the latest release on `main` receives security fixes.

## Threat model — read this before deploying

Zelyq runs code that a language model writes. That is the product, and it means the runtime boundary
is the security boundary.

### Your project's contents are sent to the model vendor

This is the first thing to know, because it is the one property **self-hosting does not change.**

To answer a prompt, the agent reads your project and sends what it reads to the model vendor
configured by `ZELYQ_PROVIDER` — today, Anthropic or Google. Over the course of a turn that includes:

- the **contents of every file the agent opens**, and the paths of the files it lists,
- the **output of every shell command it runs**, including build and test output,
- your prompts, the project name, and the preview logs it reads when something breaks.

Running Zelyq on your own hardware moves *execution* onto your machine. It does not keep your source
code on it. A `local` runtime, a private database and an air-gapped workspace still end with file
contents leaving over HTTPS to a third party, because that is how the agent thinks.

What follows from that:

- **Treat every project you open in Zelyq as disclosed to your model vendor.** If a repository
  contains material you may not send to a third party — regulated data, another company's code under
  NDA, secrets in tracked files — the agent must not be pointed at it.
- **Your agreement with the vendor is what governs the data**, not this project. Retention, training
  use, and jurisdiction are theirs to state; read their terms for the account whose key you supply.
- **A `.gitignore`d file is hidden from `list_files`, not from the model.** The agent can still read
  such a file if it is asked to, and its contents then travel with the turn.
- Zelyq adds no proxy of its own and sends nothing to its maintainers. The traffic goes from your
  instance directly to the vendor you configured.

Support for pointing Zelyq at a model **on your own network** — so that this section can say
something different — is in progress; see the [roadmap](./docs/roadmap.md). It is not in the build
you are reading about, and nothing above is softened by it.

### Local mode (`ZELYQ_RUNTIME=local`) — the default

Generated code and agent shell commands run as **child processes of the server, with your user's
permissions**. The runtime confines file operations to the project directory, but a shell command
is a shell command: it can reach anything your user can reach.

Local mode is appropriate for a single trusted developer working on their own machine. It is **not**
a sandbox. Do not expose a local-mode instance to other people, and do not point it at prompts or
projects you do not trust.

### Accounts

The first account created owns the instance and adopts any projects that predate it. After that,
`ZELYQ_ALLOW_REGISTRATION=false` closes signup so people can only join by being added to a team.

Access control does not sandbox anything: an `editor` can make the agent run commands, and in local
mode those run as the server's user. Grant `editor` to people you would trust with a shell on that
machine. `viewer` is the role for everyone else.

### Remote mode (`ZELYQ_RUNTIME=remote`) — required for shared deployments

**A reference host ships (`apps/runtime-host`), and it is not a sandbox.** It implements the
[wire protocol](./docs/runtime-protocol.md) — a conformance suite proves both drivers behave
identically — but it executes with the local driver and applies no container, no resource limits
and no egress control. It says so at startup. Running it as-is has the same security properties as
local mode; wrapping it in a container per project is what buys the boundary described below, and
that isolation is the next milestone.

Execution moves to a runtime host you deploy, which should isolate each project (container or VM),
apply CPU, memory, disk, and process limits, restrict egress to what projects need, and run
unprivileged with a read-only base image.

Anything multi-tenant, internet-reachable, or handling other people's data must run in remote mode.

### What Zelyq does and does not protect

Enforced today:

- **Authentication on every route.** Sessions are random 256-bit tokens delivered in an httpOnly,
  SameSite=Lax cookie; only a SHA-256 of the token is stored, so a database dump yields no usable
  sessions. Passwords are hashed with scrypt (N=2^15). Sign-in reports the same error for an unknown
  email as for a wrong password, and spends the same time on both.
- **Authorization on every route**, from one place. A project belongs to a team, and your role in
  that team decides what you may do: `viewer` reads, `editor` writes, `admin` manages members and
  deletes projects, `owner` controls the team. Non-members get `404`, not `403` — a `403` would
  confirm the project exists.
- **The WebSocket is authenticated at the handshake** and carries the same role. A viewer may watch a
  conversation stream; only an editor may start one.
- **API keys stored through the settings screen are encrypted at rest** with AES-256-GCM under a
  32-byte key from `ZELYQ_SECRET_KEY`, or one generated at `data/secret.key` with owner-only
  permissions. They are never returned to the browser — the screen shows only whether a key is set
  and its last four characters. Only an instance administrator can read or change settings.
- Path traversal defence — every file operation resolves inside the project root and rejects
  escapes and symlinks that leave it.
- Command timeouts and captured output limits.
- Model API keys read from the environment; never logged and never returned by the API.

Not provided by the core (supply it in your deployment):

- Network egress filtering for generated code.
- Rate limiting and quota enforcement.
- Secret scanning of generated files.

## Handling credentials

API keys belong in `ZELYQ_SECRET_KEY`-protected settings or in your platform's secret store — never
in the repository or a project's workspace.

On a server, prefer setting `ZELYQ_SECRET_KEY` from a secret manager. The generated fallback keeps a
laptop install working with no setup, but it puts the key on the same disk as the ciphertext it
protects, which defends against a stolen database file and not against a stolen machine. Zelyq redacts values matching known key formats from log
output, but that is defence in depth, not a guarantee: treat agent transcripts as sensitive.
