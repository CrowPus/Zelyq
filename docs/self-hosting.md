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

Or skip the password route entirely and let people sign in with an identity they already have — see
[configuration.md](./configuration.md#single-sign-on-oidc) for OIDC.

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

### 4. Previews behind the proxy

By default a running preview is advertised at `http://<browser-host>:<port>` — the browser's own
address plus a port from `ZELYQ_PREVIEW_PORT_MIN..MAX`. That works on a laptop, or on a VM reached
by a bare IP with those ports opened. It does **not** work behind a real domain with HTTPS: HSTS
rewrites the `http://` to `https://` on a port nothing serves TLS on, and the app can't iframe an
`http://` preview from an `https://` page (mixed content).

Reverse-proxy each preview over one HTTPS origin instead:

1. **DNS** — a wildcard `*.preview.example.com` → the host.
2. **Cert** — a wildcard TLS cert for `*.preview.example.com` (Let's Encrypt DNS-01).
3. **nginx** — one vhost that maps the port out of the subdomain:

   ```nginx
   server {
       listen 443 ssl http2;
       server_name ~^p(?<pport>\d+)\.preview\.example\.com$;

       ssl_certificate     /etc/letsencrypt/live/preview.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/preview.example.com/privkey.pem;

       location / {
           proxy_pass http://127.0.0.1:$pport;
           proxy_http_version 1.1;
           proxy_set_header Upgrade    $http_upgrade;   # Vite HMR is a WebSocket
           proxy_set_header Connection "upgrade";
           proxy_set_header Host       $host;
           proxy_read_timeout 3600s;
       }
   }
   ```

4. **Zelyq** — set `ZELYQ_PREVIEW_URL_TEMPLATE` to the matching template and restart:

   ```env
   ZELYQ_PREVIEW_URL_TEMPLATE=https://p{port}.preview.example.com
   ```

   `{port}` is substituted with the assigned port; the app and the agent then use that URL as-is.
   Keep `ZELYQ_PREVIEW_HOST` at `127.0.0.1` (previews only need to be reachable from nginx) and
   leave the `4300-4399` range closed at the firewall.

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
