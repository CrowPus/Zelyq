# Deploy: plan

Status: **built 2026-10-11** — see [Deploy](./deploy.md). Decided 2026-10-11 (the user asked for "the best and easiest way"; decisions in
section 9). Stage 5 of [platform-integration.md](./platform-integration.md).

**Done when:** describe an app → the agent builds it → its secrets are in Vault → its pipeline is
green → it is deployed to an environment and reachable at an address, and a bad deploy is undone
with one click.

## 1. What a person sees

**Ship → Deployments**: one card per environment.

```
 ┌ staging ───────────────────────┐   ┌ production  🔒 needs approval ────┐
 │ on app-builder (35.202.251.235) │   │ on app-builder                     │
 │                                 │   │                                    │
 │ Shop     #4 ● live   2h ago     │   │ Shop     #2 ● live   yesterday     │
 │   http://35.202.251.235:8080    │   │   https://shop.example.com         │
 │   [History] [Roll back]         │   │   [History] [Roll back]            │
 └─────────────────────────────────┘   └────────────────────────────────────┘
```

A deploy is one step in a pipeline, so it is tested before it ships:

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
          port: 3000          # the port the app listens on inside its container
          host-port: 8080     # the port on the machine (default: the same as port)
  - name: Production
    steps:
      - deploy:
          to: production
          port: 3000
          host-port: 80
          url: https://shop.example.com
```

## 2. Environments

An environment is a named place apps run: `staging`, `production`, … It belongs to a team and is
managed by the team's admins.

| Field | Meaning |
| --- | --- |
| Name | `staging`, `production` (letters, digits, `-`) |
| Machine | One of the team's SSH runners with Docker (Linux or macOS) |
| Address | The machine's public address (`35.202.251.235` or `apps.example.com`), to show where an app is reachable |
| Protected | Every deploy needs an admin's approval first (the `approval` step's machinery) |
| Frozen | No deploys at all, with a reason ("release freeze until Monday") |
| Variables | What apps get in this environment: typed, or `vault://NAME` from the team's Vault |

The same app gets different variables per environment (a test Stripe key on staging, the live one
on production) without the pipeline file knowing either.

## 3. How a deploy works (Docker on the environment's machine)

The `deploy` step, wherever the run itself runs:

1. **Checks the environment**: it exists, is not frozen, its machine is confirmed and turned on. If
   it is protected, the run waits for an admin's **Approve** (same box as `approval`).
2. **Sends the step's folder** (the checked-out app) to the environment's machine over SSH, into
   `~/zelyq/deploy/<environment>/<app>/<number>/`. If the run is already on that machine, it is
   copied there locally.
3. **Builds an image there** from the app's `Dockerfile`: `zelyq-<app>:<number>`. No registry is
   needed. (No Dockerfile: the step says so; the agent can add one — "add a Dockerfile".)
4. **Swaps the container**: the running `zelyq-<app>-<environment>` is renamed to
   `…-previous` and stopped; the new one starts with `--restart unless-stopped`, the environment's
   variables, and `-p host-port:port`. *(Changed while building: the variables go through the SSH
   input straight into `docker run`'s environment — no file is written at all.)*
5. **Health check**: `http://127.0.0.1:<host-port><health>` must answer (any 2xx or 3xx) within
   `health-timeout` (default 60 s), and the container must still be running.
6. **Healthy** → the previous container is removed; the deploy is **live**; the last three images
   of the app are kept for roll back, older ones deleted.
   **Not healthy** → the new container's last 50 log lines go into the step's log, it is removed,
   the previous one is started again, and the step fails: **rolled back automatically**.

Step options:

```yaml
- deploy:
    to: production            # environment name (required)
    app: shop                 # name on the machine; default: the source app, else the pipeline
    port: 3000                # inside the container (required)
    host-port: 80             # on the machine; default: port
    health: /health           # path to check; default /
    health-timeout: 90s       # default 60s
    url: https://shop.example.com   # where people reach it; default http://<address>:<host-port>
```

## 4. Roll back

**Roll back** on a card (or **Roll back to this** in History) runs the swap of section 3 with an
earlier image that is still on the machine (the last three), health check included. It is recorded
like any deploy, with who did it. Rolling back a protected environment needs an admin; others need
an editor.

## 5. History

Each environment and app keeps every deploy: number, status (`deploying`, `live`, `failed`,
`rolled back`, `replaced`), the pipeline run it came from (with its commit or app version), who
started it, when, and the address. The card shows the live one.

## 6. Run when the app changes

The missing piece of stage 3: a new trigger, **When the app changes**, for pipelines whose
`source:` is an app. When the agent finishes a turn that changed the app's files, the pipeline
starts by itself — so a change made in Zelyq reaches staging without anyone pressing Run.

## 7. Security

- Deploys only to confirmed SSH runners (pinned host key), with the team's key — as every runner.
- Variables from Vault are resolved at deploy time and sent through SSH input straight into
  `docker run` — never written to a file — and masked in the log.
- Protected environments need an admin's approval for every deploy, and an admin for roll back.
- Frozen environments refuse deploys, including from triggers.
- Every environment change, deploy and roll back is in the team's Activity.

## 8. Tests

- Real deploys to a Debian machine over SSH with a real Docker: build, start, health check, a
  second deploy replacing the first, a broken app rolled back automatically, roll back by button,
  the three-image limit, variables (and Vault secrets) reaching the app but not the log.
- Protected (approval) and frozen environments; roles.
- The "app changed" trigger starting a run.
- Then on app.zelyq.com: you deploy an app to your VM.

## 9. Decisions (made 2026-10-11)

1. **Targets: Docker on an SSH runner first.** Every team here has a VM with Docker; it needs
   nothing new on the machine. Kubernetes is a later plan of its own.
2. **Build on the target machine, no registry.** Easiest: nothing to set up. Teams with a registry
   can still use the `docker` step with `push`, and Kubernetes will pull from registries.
3. **One container per app and environment, swapped with automatic roll back** — no blue/green or
   load balancer yet: a few seconds of downtime per deploy, in exchange for nothing extra to run.
4. **Linux and macOS targets only** for deploys (Docker on Windows servers is rare and different).
   Pipelines themselves still run anywhere.
5. **Environments are team-level** (a team's `production` holds all its apps), managed by admins.

## 10. Not in this plan

Kubernetes, zero-downtime (blue/green) swaps, several machines per environment, TLS certificates
and reverse proxies (put the app behind your own nginx/Caddy and set `url`), drift detection and
health scores from the old GitOps module.
