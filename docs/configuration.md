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
| `ZELYQ_PROVIDER` | `anthropic` | `anthropic`, `google`, `openai`, or `custom`. |
| `ANTHROPIC_API_KEY` | — | Required when the provider is `anthropic`. |
| `GEMINI_API_KEY` | — | Required when the provider is `google`. `GOOGLE_API_KEY` is accepted as a fallback. |
| `OPENAI_API_KEY` | — | Required when the provider is `openai`. |
| `ZELYQ_MODEL_BASE_URL` | provider default | The endpoint for `openai` and `custom`. Required for `custom`. |
| `ZELYQ_MODEL_API_KEY` | — | Key for a `custom` endpoint. Optional — most self-hosted servers have none. |
| `ZELYQ_MODEL` | provider default | Overrides the model. Required for `custom`, which has no default. |
| `ZELYQ_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh`, or `max`. Controls reasoning depth and token spend. |

### Providers

| Provider | Default model | Endpoint | Key from |
| --- | --- | --- | --- |
| `anthropic` | `claude-opus-5` | vendor | <https://console.anthropic.com/settings/keys> |
| `google` | `gemini-3.7-flash` | vendor | <https://aistudio.google.com/apikey> |
| `openai` | `gpt-5.1` | `https://api.openai.com/v1` | <https://platform.openai.com/api-keys> |
| `custom` | none — set `ZELYQ_MODEL` | you supply it | usually none |

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
| `ZELYQ_EXEC_TIMEOUT_MS` | `120000` | Hard ceiling on one agent shell command. |
| `ZELYQ_PREVIEW_PORT_MIN` | `4300` | Start of the preview port range. |
| `ZELYQ_PREVIEW_PORT_MAX` | `4399` | End of the range — this many concurrent previews. |
| `ZELYQ_PREVIEW_HOST` | `127.0.0.1` | Host used in preview URLs. Set to a reachable address when Zelyq runs on a VM or remote host; anything other than loopback also makes project dev servers bind all interfaces. |
| `ZELYQ_MAX_TURN_ITERATIONS` | `50` | Model round-trips per turn before the loop stops. Raises the ceiling on long builds; also raises the worst-case cost. |

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
- a runaway build taking the machine down (memory, CPU and process limits)
- privilege escalation (`--cap-drop=ALL`, `no-new-privileges`, read-only root)

**What it does not stop yet, and this matters:**

- **Outbound network access is not filtered.** `npm install` needs the registry,
  and nothing currently distinguishes that from anything else the container
  might reach — including a cloud provider's metadata endpoint, which commonly
  hands out instance credentials.

So this narrows what an agent command, and now the preview, can reach. **It is
not yet a complete sandbox and should not be treated as one.** The egress gap
is being worked on.

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
concurrent previews.

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
