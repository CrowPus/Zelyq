# Deploy

Deploy puts an app on one of your machines and keeps it running: **Ship → Deployments**. A deploy is
a step in a [pipeline](./pipelines.md), so an app is tested before it ships, and if the new version
does not come up, the previous one is put back by itself.

- [Environments](#environments)
- [Deploying from a pipeline](#deploying-from-a-pipeline)
- [What a deploy does](#what-a-deploy-does)
- [Roll back](#roll-back)
- [Deploy every change the agent makes](#deploy-every-change-the-agent-makes)
- [Who can do what](#who-can-do-what)

## Environments

An environment is a named place apps run, such as `staging` or `production`. A team admin adds one in
**Deployments → New environment**:

| Field | Meaning |
| --- | --- |
| Name | `staging`, `production` (lower-case letters, digits, `-`) |
| Machine | One of the team's [SSH runners](./pipelines.md#adding-a-machine-ssh-runner), Linux or macOS, with Docker. The runner's user must be able to use Docker (the machine setup command adds it to the `docker` group). |
| Public address | The machine's address as people reach it (`35.202.251.235`, `apps.example.com`), used to show each app's link |
| Protected | Every deploy waits for an admin's **Approve** first. Use it for production. |
| Variables | What apps get in this environment: a typed value, or `vault://NAME` from the team's Vault. The same app gets a test key on staging and the live key on production, without the pipeline knowing either. Values are never shown again; leave one empty when editing to keep it. |

**Freeze** stops all deploys to an environment (with a reason, such as "release freeze") until an
admin unfreezes it. Pipelines that try fail with that reason.

## Deploying from a pipeline

The app needs a `Dockerfile` that runs it. If it has none, ask the agent: "add a Dockerfile that
serves the app". Then add a `deploy` step:

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

## What a deploy does

1. Checks the environment: it exists and is not frozen. If it is protected, the run shows **Waiting
   for approval** until an admin approves.
2. Sends the step's folder (the checked-out app, without `node_modules` and `.git`) to the
   environment's machine over SSH, and builds a Docker image there from the app's `Dockerfile`. No
   registry is needed.
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

A deploy takes a few seconds of downtime while the containers swap.

## Roll back

On a card, **History · roll back** lists every deploy of that app. **Roll back to this** puts an
earlier version back, with the same health check. The last three good versions can be rolled back to;
older images are removed from the machine.

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
| Roll back | | ✓ (not protected) | ✓ |
| Add, change, freeze, remove environments | | | ✓ |

Every environment change, deploy and roll back is in the team's Activity.

Not yet: Kubernetes, zero-downtime swaps, several machines per environment, and TLS certificates (put
the app behind your own nginx or Caddy, and set `url`). See [the plan](./deploy-plan.md).
