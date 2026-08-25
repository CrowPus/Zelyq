# Configuration

Everything is environment variables. Copy `.env.example` to `.env` for local development; in
production set them however your platform prefers. Unset values fall back to the defaults below.

## Two ways to configure

Everything below can be set as an environment variable **or**, for most of it, in **Settings** inside
the app — so an instance can be run by someone who never opens a terminal.

Precedence is fixed and one-directional:

```
environment  >  settings screen  >  built-in default
```

An operator who sets a variable expects it to hold, so a value in the environment cannot be
overridden from the UI. Those fields appear in Settings as read-only, labelled with the variable
that supplies them, and trying to write one returns an error rather than storing a value that would
have no effect. To manage something from the UI, remove it from the environment.

Settings are instance-wide and only an **instance administrator** can see or change them — that is
the first account created, separate from team roles. API keys entered there are encrypted with
AES-256-GCM before storage and are never sent back to the browser; the screen shows only whether one
is set and its last four characters.

Most settings apply immediately. Those that do not are marked `restart` in the UI.

| Variable | Default | Notes |
| --- | --- | --- |
| `ZELYQ_SECRET_KEY` | generated | 32 bytes, base64 or 64 hex characters, used to encrypt stored API keys. Generated at `data/secret.key` with owner-only permissions when unset. |
| `ZELYQ_SECRET_KEY_FILE` | `<data dir>/secret.key` | Where the generated key is kept. |

Each process loads the repository's `.env` at startup, found by walking up from wherever it was
launched — so it works whether you run `pnpm dev` from the root or a single app from its own
directory. **A real environment variable always wins over the file**, which is what deployments
expect. Values are read once at startup: after editing `.env`, restart.

## Model

| Variable | Default | Notes |
| --- | --- | --- |
| `ZELYQ_PROVIDER` | `anthropic` | `anthropic`, `google`, `openai`, `deepseek`, `mistral`, `xai`, `groq`, `openrouter`, or `custom`. |
| `ANTHROPIC_API_KEY` | — | Required when the provider is `anthropic`. |
| `GEMINI_API_KEY` | — | Required when the provider is `google`. `GOOGLE_API_KEY` is accepted as a fallback. |
| `OPENAI_API_KEY` | — | Required when the provider is `openai`. |
| `DEEPSEEK_API_KEY` | — | Required when the provider is `deepseek`. |
| `MISTRAL_API_KEY` | — | Required when the provider is `mistral`. |
| `XAI_API_KEY` | — | Required when the provider is `xai`. |
| `GROQ_API_KEY` | — | Required when the provider is `groq`. |
| `OPENROUTER_API_KEY` | — | Required when the provider is `openrouter`. |
| `ZELYQ_MODEL_BASE_URL` | provider default | Overrides the endpoint for any OpenAI-dialect provider. Required for `custom`. |
| `ZELYQ_MODEL_API_KEY` | — | Key for a `custom` endpoint. Optional — most self-hosted servers have none. |
| `ZELYQ_MODEL` | provider default | Overrides the model. Required for `custom`, which has no default. |
| `ZELYQ_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh`, or `max`. Controls reasoning depth and token spend. |

### Providers

| Provider | Default model | Endpoint | Key from |
| --- | --- | --- | --- |
| `anthropic` | `claude-opus-5` | vendor | <https://console.anthropic.com/settings/keys> |
| `google` | `gemini-3.7-flash` | vendor | <https://aistudio.google.com/apikey> |
| `openai` | `gpt-5.1` | `https://api.openai.com/v1` | <https://platform.openai.com/api-keys> |
| `deepseek` | `deepseek-chat` | `https://api.deepseek.com/v1` | <https://platform.deepseek.com/api_keys> |
| `mistral` | `mistral-large-latest` | `https://api.mistral.ai/v1` | <https://console.mistral.ai/api-keys> |
| `xai` | none — set `ZELYQ_MODEL` | `https://api.x.ai/v1` | <https://console.x.ai> |
| `groq` | none — set `ZELYQ_MODEL` | `https://api.groq.com/openai/v1` | <https://console.groq.com/keys> |
| `openrouter` | none — set `ZELYQ_MODEL` | `https://openrouter.ai/api/v1` | <https://openrouter.ai/keys> |
| `custom` | none — set `ZELYQ_MODEL` | you supply it | usually none |

`xai`, `groq`, and `openrouter` have no default model yet — not an oversight: a hosted vendor's model
name is only worth defaulting to once it has actually been confirmed against a real account, and
none of these three has been yet (Groq and OpenRouter also both rotate or aggregate models by
nature, so a fixed default would go stale fast even once one is picked). Set `ZELYQ_MODEL` to the
exact name the vendor reports.

Only the selected provider's key is needed. `GET /api/health` reports the active provider and
model, and the agent's `GET /providers` lists every provider with a `configured` flag saying whether
a usable key is present.

Reasoning is on for Claude and Gemini, with summaries streamed to the UI: Claude uses adaptive
thinking at the configured effort, Gemini uses thinking levels. Gemini has no level above `high`, so
`xhigh` and `max` both map onto it. The OpenAI dialect has three levels, so `xhigh` and `max` map
onto `high` there too; a `custom` endpoint is not sent a reasoning setting at all, because a server
that rejects unknown fields would fail every turn.

### Keeping your code on your own network

`custom` is the reason this section exists. It is not a vendor — it is any endpoint speaking the
OpenAI chat-completions dialect at an address you choose, which means the model can be one you run
yourself and **your project's contents never leave your network.**

```bash
ZELYQ_PROVIDER=custom
ZELYQ_MODEL_BASE_URL=http://localhost:11434/v1   # Ollama
ZELYQ_MODEL=qwen3-coder:30b                      # exactly as your server reports it
# no key needed
```

The address can be written as the root, as `/v1`, or as the full `/v1/chat/completions` path —
whatever your server's own documentation shows you. All three work.

**Plaintext `http://` is refused unless the address is on this machine.** Everything the agent reads
— file contents, command output — crosses that connection, so an unencrypted hop to another host
would defeat the point of running the model yourself. Use `https` for anything not on `localhost`.

Two runtimes are tested against: **Ollama** and **vLLM**. "OpenAI-compatible" is a family of
dialects rather than a standard, and others may work without being verified here — if one does not,
the failure is reported with the server's own error text rather than a generic one.

A smaller local model is usually **materially worse at agentic tool use** than a frontier hosted
model. That is a real trade, not a detail: see the eval numbers before deciding, and treat this as
the option you take when the code genuinely may not leave.

### Switching provider

```bash
ZELYQ_PROVIDER=google
GEMINI_API_KEY=...
# ZELYQ_MODEL left unset -> gemini-3.7-flash
```

Restart the agent. Existing projects keep working — the provider is recorded per session, so
conversations started on one model stay labelled with it.

## Processes

| Variable | Default | Notes |
| --- | --- | --- |
| `ZELYQ_SERVER_HOST` | `127.0.0.1` | Use `0.0.0.0` in a container. |
| `ZELYQ_SERVER_PORT` | `8787` | |
| `ZELYQ_AGENT_HOST` | `127.0.0.1` | |
| `ZELYQ_AGENT_PORT` | `8788` | |
| `ZELYQ_AGENT_URL` | `http://127.0.0.1:8788` | How the server reaches the agent. |
| `ZELYQ_WEB_HOST` | `127.0.0.1` | Bind address of the web dev server. Set `0.0.0.0` to reach it from another machine. |
| `ZELYQ_CORS_ORIGIN` | `http://localhost:5173` | Comma-separated origins. |
| `LOG_LEVEL` | `info` | `trace`…`silent`. Pretty-printed unless `NODE_ENV=production`. |
| `NODE_ENV` | `development` | `production` enables JSON logs and static file serving. |

## Accounts

| Variable | Default | Notes |
| --- | --- | --- |
| `ZELYQ_ALLOW_REGISTRATION` | `true` | Whether people may sign themselves up. The first account is always allowed regardless, and becomes the owner. Set `false` on anything internet-reachable and add people through the team screen. |
| `ZELYQ_SESSION_TTL_DAYS` | `30` | How long a sign-in lasts. Sessions are extended on use and can be ended by signing out. |

The session cookie is marked `Secure` automatically when the request arrives over HTTPS, and not when
it does not — so sign-in still works on a plain-HTTP instance without silently sending the cookie in
the clear where TLS is available.

## Storage

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:./data/zelyq.db` | SQLite file, `libsql://…`, or `postgres://…`. Dialect is detected from the scheme. |
| `ZELYQ_WORKSPACE_DIR` | `./workspace` | Where project files live in local mode. |
| `ZELYQ_TEMPLATES_DIR` | `<repo>/templates` | Where starter templates are read from. |
| `ZELYQ_WEB_DIR` | `apps/web/dist` in production | Built UI to serve. Unset in development. |
| `ZELYQ_ATTACHMENTS_DIR` | `<data dir>/attachments` | Where uploaded prompt attachments live — beside the database, never inside a project's own workspace. See [attachments.md](./attachments.md) for why. |

Migrations run automatically when the server boots.

## Execution

| Variable | Default | Notes |
| --- | --- | --- |
| `ZELYQ_RUNTIME` | `local` | `local`, `container`, or `remote`. See [self-hosting.md](./self-hosting.md). |
| `ZELYQ_RUNTIME_URL` | — | Required when `ZELYQ_RUNTIME=remote`. |
| `ZELYQ_RUNTIME_TOKEN` | — | Bearer token for the runtime host. |
| `ZELYQ_CONTAINER_IMAGE` | `node:22-bookworm-slim` | Image agent commands run in, for `container`. |
| `ZELYQ_CONTAINER_MEMORY` | `2g` | Memory ceiling per project container. |
| `ZELYQ_CONTAINER_CPUS` | `2` | CPU ceiling per project container. |
| `ZELYQ_CONTAINER_ENGINE` | `docker` | The engine binary. `podman` works as a drop-in. |
| `ZELYQ_CONTAINER_BLOCK_METADATA` | `true` | Set `false` to disable blocking the cloud metadata endpoint. See below. |
| `ZELYQ_CONTAINER_EGRESS_ALLOWLIST` | — | Comma-separated hostnames; unset means egress is unfiltered. See below. |
| `ZELYQ_EXEC_TIMEOUT_MS` | `120000` | Hard ceiling on one agent shell command. |
| `ZELYQ_PREVIEW_PORT_MIN` | `4300` | Start of the preview port range. |
| `ZELYQ_PREVIEW_PORT_MAX` | `4399` | End of the range — this many concurrent previews. |
| `ZELYQ_PREVIEW_HOST` | `127.0.0.1` | Decides whether project dev servers bind `127.0.0.1` or all interfaces — set it to anything other than loopback on a VM or remote host, or previews are not reachable from outside the machine at all. The web UI figures out the address it displays and loads a preview at from the browser's own location, not from this variable, so you no longer need to get the exact value right for previews to load — only the loopback-or-not choice, for whether they're reachable at all. Non-browser callers of the API (a script, `curl`) still get this value in the `url` field. |
| `ZELYQ_MAX_TURN_ITERATIONS` | `50` | Model round-trips per turn before the loop stops. Raises the ceiling on long builds; also raises the worst-case cost. |
| `ZELYQ_PLUGIN_DIR` | — | A local directory of extra tools for the agent, loaded once at boot. See [plugins.md](./plugins.md). |

### Running agent commands and the preview in a container

`ZELYQ_RUNTIME=container` is `local` with one difference: **agent shell commands
and the dev server preview run inside a container, one per project**, instead
of as the user running Zelyq.

```env
ZELYQ_RUNTIME=container
```

Nothing else changes. The workspace stays on the same disk in the same place;
the container has that one project bind-mounted at `/workspace` and nothing else
from the host. Files it writes are owned by the user Zelyq runs as, so Zelyq
reads and writes them exactly as before.

**What it stops**, each verified by a test that also runs against the local
driver and fails there:

- reading another project's files, or anything else on the host
- reaching a service on the host's loopback — an internal admin API, a database
- reaching another project's container over the network — every project shares one dedicated
  network with inter-container communication disabled
- a runaway build taking the machine down (memory, CPU and process limits)
- privilege escalation (`--cap-drop=ALL`, `no-new-privileges`, read-only root)
- **reaching the cloud instance metadata endpoint** (`169.254.169.254`), which on most providers
  hands out instance credentials to anything that asks it, unauthenticated. On by default; set
  `ZELYQ_CONTAINER_BLOCK_METADATA=false` to disable. The request is refused immediately rather than
  left to hang, so code that tries fails fast instead of stalling.

  This is the one thing container mode does that reaches outside objects Zelyq itself creates and
  destroys: a single rule, scoped to Zelyq's own project network, written into the host's
  `DOCKER-USER` firewall chain — the chain Docker reserves for operator rules exactly like this one,
  applied through a short-lived helper container rather than a direct `sudo` call. If it cannot be
  installed, a project can still be created — check `GET /api/health` for `metadata block FAILED`
  rather than assuming the protection held.

**What it does not stop by default, and this matters:**

- **Outbound network access is otherwise not filtered.** `npm install` needs the registry, and
  nothing distinguishes that from anything else the container might reach on your network. Only the
  metadata address above is refused.

So this narrows what an agent command, and now the preview, can reach. **It is
not a complete sandbox by default and should not be treated as one.**

#### Opt-in: a general egress allowlist

`ZELYQ_CONTAINER_EGRESS_ALLOWLIST` closes the rest of the gap, for an operator who wants it:

```env
ZELYQ_CONTAINER_EGRESS_ALLOWLIST=registry.npmjs.org,github.com
```

Unset (the default): nothing changes, egress stays unfiltered as described above. Set: project
containers can reach only the named hosts — everything else on the `zelyq-projects` network is
default-denied at the same `DOCKER-USER` chain the metadata rule uses, refused immediately rather
than left to hang. Each hostname is resolved and the result refreshed every five minutes, since a DNS
TTL is not a promise worth trusting a firewall to.

**There is no Zelyq-maintained default list, on purpose.** `registry.npmjs.org` alone resolves to a
dozen different addresses behind Cloudflare, and that set is not fixed — a list Zelyq shipped and
maintained would be a promise about addresses nobody on this team controls, and getting it wrong
breaks a real `npm install` silently rather than failing safely. This is the operator's list, sized to
what *your* deployment's projects actually need to reach, checked with `GET /api/health` for
`egress allowlist FAILED` the same way the metadata rule is.

This still is not a general sandbox: it filters by resolved IP address only, so a CDN fronting both
an allowed and a disallowed service behind the same address is not distinguished, and there is no TLS
inspection.

**A host that answers from a small, rotating pool of addresses can take a few refresh cycles to work
reliably.** Checked live, not assumed: `github.com` answered three different addresses across three
independent lookups a few minutes apart. Each resolved address is kept allowed for three refresh
cycles after it was last seen, specifically so a pool like that has time to be sampled rather than
being dropped the moment one cycle doesn't happen to repeat it — but on a freshly-enabled allowlist,
before that has had time to happen, a request can still occasionally land on an address the set
has not seen yet. A host behind a large, consistent range — `registry.npmjs.org`'s Cloudflare
anycast, for instance — does not show this at all.

Requires a container engine on the host. Commands cost about **120ms more** each
— roughly 2.4 seconds across a twenty-command turn, against turns measured in
minutes.

## Choosing a configuration

**Solo, on a laptop**
```env
ZELYQ_RUNTIME=local
DATABASE_URL=file:./data/zelyq.db
```

**On a VM you browse from your laptop**
```env
ZELYQ_SERVER_HOST=0.0.0.0
ZELYQ_SERVER_PORT=8081
ZELYQ_PREVIEW_HOST=<the VM address you browse to>
NODE_ENV=production
```
The server serves the built UI, so a single open port covers the UI, the API, and the WebSocket.
Previews still run on their own ports — open as many of `ZELYQ_PREVIEW_PORT_MIN..MAX` as you want
concurrent previews. Any non-loopback value here makes dev servers accept connections from outside
the VM, which is what actually matters; the web UI works out the address it shows and loads previews
at from the browser itself, so this no longer has to be the *exact* right value for previews to load
— a real, reachable address is still worth setting, though, since non-browser callers of the API still
get this value back verbatim.

**A team, on one server**
```env
ZELYQ_RUNTIME=remote
ZELYQ_RUNTIME_URL=https://runtime.internal
ZELYQ_RUNTIME_TOKEN=…
DATABASE_URL=postgres://zelyq:…@db:5432/zelyq
ZELYQ_SERVER_HOST=0.0.0.0
NODE_ENV=production
```

Read the threat model in [SECURITY.md](../SECURITY.md) before the second one. Local mode has no
isolation and must not be shared.
