# Self-hosting

## Docker Compose (single machine)

```bash
cp .env.example .env      # set ANTHROPIC_API_KEY
docker compose -f docker/docker-compose.yml up --build
```

Zelyq is on <http://localhost:8787> — the server serves the built UI, so there is no separate web
container. Data lives in the `zelyq-data` volume (database plus project files).

To use PostgreSQL, uncomment the `postgres` service in the compose file and set:

```env
DATABASE_URL=postgres://zelyq:zelyq@postgres:5432/zelyq
```

Migrations run automatically on server startup.

## Running it as a real deployment

Compose gets you running. Before other people use it, three things need attention.

### 1. Isolation — required

The default compose file runs `ZELYQ_RUNTIME=local`, which executes generated code **inside the
agent container as the container's user**. That is fine for one trusted person. For anyone else,
deploy a runtime host and switch to:

```env
ZELYQ_RUNTIME=remote
ZELYQ_RUNTIME_URL=https://runtime.internal
ZELYQ_RUNTIME_TOKEN=<a long random string>
```

See [runtime-protocol.md](./runtime-protocol.md) for the contract and the isolation requirements.

### 2. Accounts — close signup once yours exist

Zelyq authenticates every request. The first account you create owns the instance; after that, set

```env
ZELYQ_ALLOW_REGISTRATION=false
```

so strangers cannot sign themselves up, and add people through the team screen instead. They register
before you can add them, so create their accounts while signup is open, or turn it on briefly.

Because sessions ride in a cookie, put the instance behind TLS — the cookie is only marked `Secure`
on an HTTPS connection.

### 3. TLS and WebSockets

Terminate TLS at your proxy and make sure it forwards WebSocket upgrades for `/ws/*`. For nginx:

```nginx
location /ws/ {
    proxy_pass http://zelyq-server:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # turns can run for minutes
}
```

The long read timeout matters — the default 60 seconds cuts turns off mid-answer.

## Backups

Two things hold state:

| What | Where | Back up |
| --- | --- | --- |
| Database | `DATABASE_URL` | `pg_dump`, or copy the SQLite file while the server is stopped |
| Project files | `ZELYQ_WORKSPACE_DIR` | Volume snapshot or `rsync` |

They are only loosely coupled: a project row without its directory shows as an error rather than
crashing, and an orphaned directory is ignored. Still, back them up together.

## Resource planning

- **Server:** small. It is I/O-bound.
- **Agent:** one turn holds a conversation in memory; long builds can reach a few hundred MB.
- **Runtime:** the expensive one. Every previewed project runs `npm install` and a dev server —
  budget roughly 500 MB and a shared core per active project, plus disk for `node_modules`.
- **Ports:** `ZELYQ_PREVIEW_PORT_MIN..MAX` caps concurrent previews. Widen it before you hit it.

## Upgrading

```bash
git pull
pnpm install
pnpm build
# restart; migrations run on boot
```

Pre-1.0 releases may include breaking changes — read [CHANGELOG.md](../CHANGELOG.md) first.
