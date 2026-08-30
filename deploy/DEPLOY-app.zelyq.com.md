# Deploying app.zelyq.com

`app.zelyq.com` is served by the **Zelyq server process already running on this
VM** at `127.0.0.1:8081` (started from source with `tsx`, `NODE_ENV=production`,
`ZELYQ_RUNTIME=container`). It serves the web UI, the `/api` routes, and the
`/ws` websocket from one origin. The host nginx terminates TLS and reverse-proxies
to it — no container, no change to how the server is run.

```
browser ──HTTPS──▶ host nginx (:443, Let's Encrypt)
                      │  server_name app.zelyq.com
                      ▼
              127.0.0.1:8081  ──▶  zelyq server (tsx)  ──HTTP/SSE──▶  agent 127.0.0.1:8788
                                                        └─ SQLite  /home/crow/folder/zelyq/data/zelyq.db
                                                        └─ preview containers (ZELYQ_RUNTIME=container)
```

## Status

| Step | State |
| --- | --- |
| DNS `A app.zelyq.com → 136.112.104.233` | **done** |
| Let's Encrypt cert (`/etc/letsencrypt/live/app.zelyq.com/`) | **done** — expires 2026-11-27, auto-renews |
| Host nginx HTTPS vhost | **done, live** — `/etc/nginx/sites-zelyq/app.zelyq.com.conf`; HTTP→HTTPS 301, `/ws` upgrade (101), `/api` streaming, SPA fallback. `zelyq.com` + `meetcrow.dev` unaffected |
| `.env`: `ZELYQ_CORS_ORIGIN=https://app.zelyq.com` | **written** — needs a server restart to take effect |
| `.env`: `ZELYQ_ALLOW_REGISTRATION=false` | **written** — needs a server restart, OR flip it now in Settings → Access (`/api/health` still shows `registrationOpen:true`) |

Verified over HTTPS: `/` serves the Zelyq SPA (`<title>Zelyq</title>`), `/assets/*.js` 200,
`/api/health` ok, WebSocket `/ws/projects/:id` upgrades to 101 (over HTTP/1.1 — browsers do this
automatically even on an h2 site; `curl` without `--http1.1` shows a misleading 404).

## What you need to do

### 1. DNS — done

`app.zelyq.com` now has an A record → `136.112.104.233`. If an old AAAA record still
points elsewhere, remove it so IPv6 clients also land on this VM.

### 2. Certificate — done

Issued by `deploy/issue-cert-app.zelyq.com.sh` and the HTTPS vhost is live. Renewal is
automatic (system certbot timer + `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`).
Re-run the script only if you need to reissue.

### 3. Close registration now (no restart) — TODO

Sign in as the owner account → **Settings → Access → "Open registration" → off**.
`/api/health` currently reports `"registrationOpen": true`. The `.env` change is
only the durable default for the next restart; the Settings toggle is immediate.

### 4. Restart the server when convenient — TODO

To pick up the `.env` changes (`ZELYQ_CORS_ORIGIN`, `ZELYQ_ALLOW_REGISTRATION`),
the `:8081` process needs a restart. It was started with:

```
ZELYQ_SERVER_PORT=8081 NODE_ENV=production tsx apps/server/src/index.ts
```

Since the SPA and API share the origin `https://app.zelyq.com`, CORS is not on the
request path for normal use — the site works without the restart. Do it at a low-traffic
moment.

## Recommended hardening (server code change — not applied)

`apps/server/src/app.ts` creates Fastify without `trustProxy`. Behind nginx that
makes `request.protocol === "http"`, so session cookies are set **without the
`Secure` flag** (see `apps/server/src/routes/auth.ts`). nginx already forwards
`X-Forwarded-Proto`. Add `trustProxy: true` to the `Fastify({ ... })` options so
`Secure` cookies and correct client IPs work behind the proxy.

## Files

| File | Role |
| --- | --- |
| `deploy/app.zelyq.com.conf` | Full host nginx vhost (HTTP→HTTPS redirect, `/ws` upgrade, `/api` streaming, SPA). Installed by the cert script. |
| `deploy/issue-cert-app.zelyq.com.sh` | One-shot: issue cert → install HTTPS vhost → reload → verify. |
| `/etc/nginx/sites-zelyq/app.zelyq.com.conf` | What is live now (phase-1 HTTP-only until the cert script runs). |
| `/etc/nginx/nginx.conf.bak.*` | Timestamped backups from each change. |

## Operations

```bash
# nginx
sudo nginx -t && sudo systemctl reload nginx
sudo tail -f /var/log/nginx/error.log

# the app (whatever supervises the :8081 process — tmux/systemd/nohup)
curl -s http://127.0.0.1:8081/api/health | jq .
ss -tlnp | grep -E ':(8081|8788)'

# rollback the vhost entirely
sudo rm /etc/nginx/sites-zelyq/app.zelyq.com.conf && sudo systemctl reload nginx
```
