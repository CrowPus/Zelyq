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
| `ZELYQ_PROVIDER` | `anthropic` | `anthropic` or `google`. |
| `ANTHROPIC_API_KEY` | — | Required when the provider is `anthropic`. |
| `GEMINI_API_KEY` | — | Required when the provider is `google`. `GOOGLE_API_KEY` is accepted as a fallback. |
| `ZELYQ_MODEL` | provider default | Overrides the model. Leave unset to get the provider's default. |
| `ZELYQ_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh`, or `max`. Controls reasoning depth and token spend. |

### Providers

| Provider | Default model | Key from |
| --- | --- | --- |
| `anthropic` | `claude-opus-5` | <https://console.anthropic.com/settings/keys> |
| `google` | `gemini-3.7-flash` | <https://aistudio.google.com/apikey> |

Only the selected provider's key is needed. `GET /api/health` reports the active provider and
model, and the agent's `GET /providers` lists every provider with a `configured` flag saying whether
a usable key is present.

Reasoning is on for both providers, with summaries streamed to the UI: Claude uses adaptive thinking
at the configured effort, Gemini uses thinking levels. Gemini has no level above `high`, so `xhigh`
and `max` both map onto it.

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
| `ZELYQ_RUNTIME` | `local` | `local` or `remote`. See [self-hosting.md](./self-hosting.md). |
| `ZELYQ_RUNTIME_URL` | — | Required when `ZELYQ_RUNTIME=remote`. |
| `ZELYQ_RUNTIME_TOKEN` | — | Bearer token for the runtime host. |
| `ZELYQ_EXEC_TIMEOUT_MS` | `120000` | Hard ceiling on one agent shell command. |
| `ZELYQ_PREVIEW_PORT_MIN` | `4300` | Start of the preview port range. |
| `ZELYQ_PREVIEW_PORT_MAX` | `4399` | End of the range — this many concurrent previews. |
| `ZELYQ_PREVIEW_HOST` | `127.0.0.1` | Host used in preview URLs. Set to a reachable address when Zelyq runs on a VM or remote host; anything other than loopback also makes project dev servers bind all interfaces. |
| `ZELYQ_MAX_TURN_ITERATIONS` | `50` | Model round-trips per turn before the loop stops. Raises the ceiling on long builds; also raises the worst-case cost. |

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
