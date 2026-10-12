# Deploy

Deploy puts an app on one of your machines and keeps it running: **Ship → Deployments**. A deploy is
a step in a [pipeline](./pipelines.md), so an app is tested before it ships, and if the new version
does not come up, the previous one is put back by itself.

- [Environments](#environments)
- [Deploying from a pipeline](#deploying-from-a-pipeline)
- [What a deploy does](#what-a-deploy-does)
- [No Dockerfile needed](#no-dockerfile-needed)
- [Your own address, HTTPS, and no downtime](#your-own-address-https-and-no-downtime)
- [Roll back](#roll-back)
- [Ports and firewalls](#ports-and-firewalls)
- [Deploy every change the agent makes](#deploy-every-change-the-agent-makes)
- [Who can do what](#who-can-do-what)

## Environments

An environment is a named place apps run, such as `staging` or `production`. A team admin adds one in
**Deployments → New environment**:

| Field | Meaning |
| --- | --- |
| Name | `staging`, `production` (lower-case letters, digits, `-`) |
| Machine | One of the team's [SSH runners](./pipelines.md#adding-a-machine-ssh-runner), Linux or macOS, with Docker. The runner's user must be able to use Docker (the machine setup command adds it to the `docker` group). |
| Public address | The machine's address as people reach it (`203.0.113.10`), used to show each app's link and the DNS record to add |
| A subdomain for every app | Optional. Apps without an address of their own get `<app>.<domain>`. Each app's exact address is set on its page. See [below](#your-own-address-https-and-no-downtime). |
| Protected | Every deploy waits for an admin's **Approve** first. Use it for production. |
| Variables | What apps get in this environment: a typed value, or `vault://NAME` from the team's Vault. The same app gets a test key on staging and the live key on production, without the pipeline knowing either. Values are never shown again; leave one empty when editing to keep it. |

**Freeze** stops all deploys to an environment (with a reason, such as "release freeze") until an
admin unfreezes it. Pipelines that try fail with that reason.

## Deploying from a pipeline

Add a `deploy` step to the app's pipeline. The app needs no Dockerfile: Zelyq recognises the
common kinds of app and builds them ([No Dockerfile needed](#no-dockerfile-needed)). Its own
`Dockerfile`, when it has one, is always used instead.

```yaml
name: Shop
runs-on: local
source:
  app: Shop
stages:
  - name: Test
    steps:
      - checkout: true
      - setup: node@22
      - run: npm ci && npm test
  - name: Staging
    steps:
      - deploy:
          to: staging
          port: 3000          # what the app listens on inside its container
          host-port: 8080     # on the machine; default the same as port
  - name: Production
    steps:
      - deploy:
          to: production
          port: 3000
          host-port: 80
          health: /health    # checked after starting; default /
          health-timeout: 90s # default 60s
          url: https://shop.example.com   # where people reach it, if not http://<address>:<host-port>
```

`app:` names the app on the machine (default: the source app's name). The template **Deploy an app**
in New pipeline starts from this.

## No Dockerfile needed

When the app has no `Dockerfile`, Zelyq looks at its files, decides what kind of app it is, and writes
one. The run's log says what it found and shows the whole Dockerfile, so nothing is hidden; to change
it, save it in the app as `Dockerfile` and edit it.

| The app has | Zelyq builds | It starts with |
| --- | --- | --- |
| `package.json` with a `start` script | Node (the version from `engines`, `.nvmrc` or 22), installed with npm, pnpm or yarn (from the lock file), then `build` if there is one | `npm run start` (or `pnpm`/`yarn`) |
| `package.json`, a `build` script, no `start`, and Vite, Create React App, Angular, Vue CLI, Parcel or Astro | the site's files (`dist`, `build` or `out`), served by Caddy; links of single-page apps work | — |
| `package.json` without `start` | Node | `node` with `main`, or `server.js`, `index.js`, `app.js` |
| `requirements.txt` or `pyproject.toml` | Python (the version from `.python-version` or 3.12) | Django: `gunicorn <project>.wsgi`; FastAPI: `uvicorn main:app`; Flask: `gunicorn app:app`; otherwise `python main.py` |
| `go.mod` | Go (the version from `go.mod`), the main package at the top or in `cmd/<name>` | the built program |
| `index.html` only | a static site, served by Caddy | — |

**The port.** The image sets `PORT` to the deploy step's `port:`. Node, Python and Go servers that read
`PORT` (most do) listen there by themselves; the commands above pass it to gunicorn and uvicorn.

**A different start command.** Write `start:` on the deploy step, or a `Procfile` with a `web:` line, as
on Heroku:

```yaml
- deploy:
    to: staging
    port: 3000
    start: node dist/server.js
```

If Zelyq cannot tell, the step fails and says what to add.

## What a deploy does

1. Checks the environment: it exists and is not frozen. If it is protected, the run shows **Waiting
   for approval** until an admin approves.
2. Sends the step's folder (the checked-out app, without `node_modules` and `.git`) to the
   environment's machine over SSH, and builds a Docker image there from the app's `Dockerfile`, or
   from the one Zelyq writes for it. No registry is needed.
3. Moves the running version aside, and starts the new one as `zelyq-<app>-<environment>`, with
   `--restart unless-stopped` and the environment's variables. The variables travel through the SSH
   connection's input straight into `docker run`; they are never written to a file and show as `***`
   in the log.
4. Waits until `http://127.0.0.1:<host-port><health>` answers (any 2xx or 3xx) and the container keeps
   running.
5. **It answers**: the deploy is **live**, the previous container is removed, and the images of the
   last three good deploys are kept for roll back.
   **It does not**: the new container's last lines go into the log, it is removed, and the previous
   version is started again. The step fails with "Rolled back automatically".

Without an address, a deploy takes a few seconds of downtime while the containers swap. With one, there is none: see [Your own address, HTTPS, and no downtime](#your-own-address-https-and-no-downtime).

## Your own address, HTTPS, and no downtime

Give an app the exact address people type, such as `example.com`, `www.example.com` or
`shop.example.com`. It gets HTTPS, and new versions without downtime.

**For each app:**

1. Deploy it once (with a pipeline), then on Deployments press **Logs · manage** on it.
2. Under **Address**, type the name and press **Save**. Tick **Also www.example.com** to send that
   name on to the main one.
3. Add the DNS record the page shows, where your domain is managed: type **A**, the name (written `@`
   for the domain itself at most providers), value the machine's public IP.
4. Open ports **80** and **443** on the machine (and in the cloud's firewall).

A live app moves to its new address at once; no new deploy is needed. Every later deploy keeps it.
One name belongs to one app.

**Or a subdomain for every app.** Give the environment a domain (**A subdomain for every app**, such
as `apps.example.com`) and each app without an address of its own gets `<app>.apps.example.com`.
One DNS record covers them all: `*.apps.example.com`. A deploy step can also name the app's address
with `domain: shop.example.com`; an address set on the app's page comes first.

```yaml
- deploy:
    to: staging
    port: 3000
```

With an address, `host-port` and `url` are not used.

**What happens.** Zelyq runs a small proxy ([Caddy](https://caddyserver.com)) on the machine, as the
container `zelyq-proxy`. It takes free certificates from Let's Encrypt and renews them by itself. On
each deploy:

1. The new version starts **beside** the running one (`zelyq-shop-staging-12`). Nobody is sent to it
   yet.
2. Zelyq checks it answers, from inside the proxy.
3. Only then does the proxy send people to it, without dropping a connection, and the old version is
   removed.

If the new version does not come up, nobody notices: the running version was never touched. The
step fails with "The running version was not touched".

**HTTPS choices** (the environment's **HTTPS** setting):

| Choice | When |
| --- | --- |
| Automatic (recommended) | The machine is on the internet with ports 80 and 443 free and open. |
| My own web server is in front | nginx or Apache already serves other sites on the machine. See below. |
| Zelyq's own certificate | Testing, or a private network. Browsers warn until they trust it. |
| Off | Plain HTTP, for example behind a load balancer that already does HTTPS. |

### When nginx (or Apache) already uses 80 and 443

Keep your web server; Zelyq goes behind it.

1. Edit the environment and choose HTTPS: **My own web server is in front**. Zelyq's proxy then
   listens on a private port (8081 unless you choose another) on `127.0.0.1` only.
2. Set the app's address on its page, and press **Set it up for me**. Zelyq connects to the machine,
   adds an nginx site of its own for the name (`zelyq-example.com.conf`; your other sites are not
   touched, and a name another site already serves is left alone), checks it with `nginx -t`, reloads
   nginx, and gets the certificate with `certbot` (installing it if needed). This needs the machine's
   user to have `sudo` without a password, as cloud machines usually do; otherwise the page shows the
   lines to paste yourself.
3. The address shown is `https://example.com`, with no port.

Changing an environment's HTTPS setting or proxy ports applies at once to the apps live there; no new
deploy is needed.

Zelyq then opens the address the way a visitor would, and says plainly what is missing: the DNS
record, the nginx lines, or the certificate.

If a deploy says the proxy's ports are used by something else, it now says by what (a container, or
a program such as nginx) before building anything.

## The app page: logs, restart and stop

On a card, **Logs · manage** opens the app's own page:

- **State**: running, stopped, restarting, or gone from the machine.
- **CPU and memory** right now (100% CPU is one full core), when it started, and how many times
  Docker started it again after it crashed.
- **Logs**: the app's own output, live. New lines appear every few seconds; scroll up to read and it
  stops following. Lines on standard error are shown in amber. The environment's variable values are
  masked, as in deploy logs.
- **Restart**, **Stop** and **Start**. A stopped app stays stopped after the machine restarts, until
  you start it again or deploy a new version.

- **Remove app** takes it off the machine: its containers, its address on the proxy and its images.
  Its history stays. If the machine is gone for good, the app can be forgotten in Zelyq only.
- Removing an environment that still has apps offers to remove them with it.

## Promote: ship what you tested

On the app page, **Promote** sends the exact image running in this environment to another one, such
as staging to production. Nothing is built again, so production runs the bytes you tested on staging;
only that environment's own variables differ.

- On the same machine, the image is only given a new name. On another machine, Zelyq copies it over
  SSH, compressed (no registry needed).
- It is a deploy like any other: the same health check, no downtime for an app with an address, the previous
  version put back if it does not come up, and it appears in the history as *promoted from staging
  #7*. It can be rolled back.
- The app keeps its address in the target environment. Without an address there, it needs a
  `host-port` it already used there (deploy it there once with a pipeline), or an address.
- Protected environments need an admin to promote to them; frozen ones take nothing.

## Roll back

On a card, **History** (or the app page) lists every deploy of that app. **Roll back to this** puts an
earlier version back, with the same health check. The last three good versions can be rolled back to;
older images are removed from the machine.

### The app's name: what a history and a roll back belong to

Each deploy belongs to an **app name in an environment**: one card on Deployments, one history, one
container (`zelyq-<app>-<environment>`) on the machine. The name is the step's `app:`, or the source
app's name when there is none.

- Deploy the same app to `staging` and `production`: two cards, two histories, each rolled back on its
  own.
- Two pipelines deploying the same `app:` to the same environment replace each other's version: one
  card, one history. Use that on purpose, or give each its own `app:`.
- Renaming `app:` starts a new card and a new container. The old one keeps running until you stop it on
  the machine (`docker rm -f zelyq-<old name>-<environment>`), and its history cannot be rolled back
  from the new name.

## Ports and firewalls

- `port` is what the app listens on **inside** its container; `host-port` is where it answers **on the
  machine**. Two apps in one environment need two different `host-port`s.
- People reach an app at `http://<public address>:<host-port>`. Open that port in the machine's
  firewall and in the cloud provider's (Google Cloud: **VPC network → Firewall**; AWS: **Security
  group**; Azure: **Network security group**). The health check itself runs on the machine and needs no
  open port.
- For a name and HTTPS, put a reverse proxy (nginx, Caddy, Traefik) on the machine in front of the
  `host-port`, and set the step's `url:` so Deployments links to the right address.
- Zelyq reaches the machine over SSH only; see [Pipelines → firewalls and
  ports](./pipelines.md#firewalls-and-ports).

## Deploy every change the agent makes

On the pipeline's **Triggers** tab, **When the app changes**: every time the agent finishes a turn that
changed the app, the pipeline runs by itself. With a `deploy` to staging in it, staging always shows
the latest version.

## Who can do what

| | Viewer | Editor | Admin, owner |
| --- | --- | --- | --- |
| See environments, what is live, history | ✓ | ✓ | ✓ |
| Deploy (run a pipeline with `deploy`) | | ✓ | ✓ |
| Deploy to a protected environment | | asks an admin | approves |
| See an app's logs, CPU and memory | ✓ | ✓ | ✓ |
| Roll back, promote, restart, stop, start, set an app's address | | ✓ (not protected) | ✓ |
| Add, change, freeze, remove environments | | | ✓ |

Every environment change, deploy, roll back, promote, restart, stop and start is in the team's
Activity.

Without an address, a deploy takes a few seconds of downtime while the containers swap; with one,
none. Not yet: Kubernetes and several machines per environment. See [the plan](./deploy-plan.md).
