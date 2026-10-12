# Tutorial: from an app to production

This walks through Zelyq's **Secure** and **Ship** side once, end to end. You will:

1. keep a secret in Vault;
2. test an app with a pipeline;
3. add one of your own machines as a runner;
4. deploy the app to it, and roll it back;
5. run the pipeline on every push and pull request from GitHub;
6. make it faster with stages at the same time, a matrix and a template.

Each part takes a few minutes and builds on the one before. You can stop after any of them.

**You need:** a running Zelyq ([Getting started](./getting-started.md)), the **admin** or **owner**
role in your team, and an app built in Zelyq: a **React + Vite** app called `Shop` is used below. For
parts 3 and 4, a Linux machine you can reach over SSH, with Docker (a small cloud VM is fine). For
part 5, a GitHub repository with the app's code.

---

## Part 1 — Keep a secret in Vault

Secrets never go into a pipeline file. They live in Vault, and the file points at them.

1. Open **Vault** and press **Add secret**.
2. Name: `SHOP_API_KEY`. Value: anything, for example `test-123`. Description: `Shop's key for
   testing`. Press **Save**.

The value is now encrypted, and shown again only to people who press the eye (every reveal is
recorded in **Activity**). More in [Vault](./vault.md).

## Part 2 — Your first pipeline

1. Open **Pipelines** and press **New pipeline**. Choose the **Node app** template.
2. Replace the file with this, and press **Save**:

   ```yaml
   name: Shop tests
   runs-on: local
   source:
     app: Shop
   env:
     SHOP_API_KEY: vault://SHOP_API_KEY
   stages:
     - name: Get
       steps:
         - checkout: true
         - setup: node@22
         - cache: node_modules
     - name: Check
       steps:
         - run: npm ci
         - run: npm run build
         - run: echo "The key is $SHOP_API_KEY"
   ```

3. Press **Run now**.

What happens:

- `runs-on: local` runs it on the Zelyq server, in a fresh container that is thrown away afterwards.
- `checkout: true` copies the app's files, exactly as they are in Zelyq now, into an empty folder.
- `setup` installs Node 22 and `cache` keeps `node_modules` for the next run.
- The last line prints **`The key is ***`**. A secret is masked wherever it appears in a log.

The run page shows each stage as a box. Click one to see its steps and their output. If a step fails,
its output says why. **Run again** runs the same file again.

**The same, by clicking.** Press **New pipeline**, choose **Node app**, and stay on **Visual**:

1. Click the bar at the top. Set **Name** to `Shop tests`, **Runs on** to **This Zelyq server
   (local)**, and **App** to `Shop`. Under **Variables for every step**, press **+ Add**, and write
   `SHOP_API_KEY` and `vault://SHOP_API_KEY`.
2. Click the **Check** stage, then **Add a step** in it, and choose **Commands**. In **Commands**,
   write `echo "The key is $SHOP_API_KEY"`.
3. Switch to **YAML** to see the file you just made, then press **Create pipeline** and **Run now**.

Either way works for everything in this tutorial; the YAML is shown because it is shorter to read.

> **Where do the files come from?** From the app in Zelyq, because the file says `source: {app: Shop}`.
> For a GitHub repository, a subfolder, or files already on a machine, see
> [Where the files come from](./pipelines.md#where-the-files-come-from).

## Part 3 — Add your own machine

A **runner** is any machine Zelyq can reach over SSH: a cloud VM, a Mac mini, a Windows build box.

1. Open **Pipelines → Runners**.
2. **Step 1** shows a setup command for Linux, macOS and Windows. Copy the Linux one, sign in to your
   machine, and paste it there once. It creates a user called `zelyq`, lets the team's key in, and adds
   the user to the `docker` group.
3. Press **Add runner**: name `web-01`, the machine's IP address, port `22`, user `zelyq`.
4. Press **Test connection**. Zelyq shows the machine's fingerprint (`SHA256:…`). On the machine, run:

   ```sh
   for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done
   ```

   If one line matches, press **It matches — confirm**. From now on Zelyq talks only to that machine.

5. In **Shop tests**, change `runs-on: local` to `runs-on: web-01`, save, and **Run now**. The same
   steps now run on your machine, in `~/zelyq/runs/<id>`.

> **Test connection times out?** The machine's SSH port is closed to the Zelyq server. Open it in the
> cloud provider's firewall. See [firewalls and ports](./pipelines.md#firewalls-and-ports).

## Part 4 — Deploy, and roll back

A deploy runs the app on your machine in Docker, checks it answers, and puts the previous version back
by itself if it does not.

1. **Check how the app starts.** No Dockerfile is needed: Zelyq recognises Node, Python, Go and
   static sites and builds them. A Node app needs a `start` script in `package.json` (a site that only
   builds files needs just `build`); see [No Dockerfile needed](./deploy.md#no-dockerfile-needed).
2. **Create an environment.** Open **Deployments → New environment**: name `staging`, machine
   `web-01`, public address the machine's IP. Leave **Protected** off. Under **Variables**, add
   `SHOP_API_KEY` → `vault://SHOP_API_KEY`.
3. **Add a deploy stage** to **Shop tests**:

   ```yaml
     - name: Deploy
       steps:
         - deploy:
             to: staging
             port: 80          # inside the container
             host-port: 8080   # on the machine
   ```

   It deploys the files the stages before it checked out and built: they share one folder.

4. **Open port 8080** on the machine's firewall, then **Run now**.

When the run passes, **Deployments** shows `Shop` as **LIVE** under `staging`, with a link:
`http://<machine IP>:8080`.

**Roll back by hand.** Change something in the app, run the pipeline again, then on the app's card
press **History · roll back** and **Roll back to this** on the earlier deploy. The earlier version is
back in a few seconds.

**Roll back by itself.** Add `health: /does-not-exist` to the deploy step and run again. The new
version does not answer, so the deploy fails with *"Rolled back automatically"* and the previous
version keeps running. Remove the line afterwards.

For production, make a second environment with **Protected** on: every deploy to it waits for an
admin's **Approve**. **Freeze** stops all deploys to an environment during a release. More in
[Deploy](./deploy.md).

## Part 5 — Run on every push and pull request

Now let GitHub start the pipeline, and show ✓ or ✗ on each commit and pull request.

1. **A token for GitHub.** On GitHub: **Settings → Developer settings → Fine-grained tokens →
   Generate new token**. Pick the repository. Permissions: **Contents: Read** and **Commit statuses:
   Read and write**. Copy the token.
2. **Keep it in Vault** as `GITHUB_TOKEN`.
3. **Take the code from GitHub** instead of from the app. In **Shop tests**, replace `source:` with:

   ```yaml
   source:
     repo: https://github.com/YOU/shop
     token: vault://GITHUB_TOKEN
     report-status: true      # ✓ / ✗ on the commit and the pull request
   ```

4. **Add the trigger.** On the pipeline's **Triggers** tab: **On a git push**, branches `main`, tick
   **Also for pull requests**, press **Add trigger**. Copy the **Payload URL** and the **Secret** now:
   the secret is shown only once.
5. **Add the webhook on GitHub.** The repository's **Settings → Webhooks → Add webhook**:
   - Payload URL: the URL from Zelyq;
   - Content type: `application/json`;
   - Secret: the secret from Zelyq;
   - Which events: **Let me select individual events** → **Pushes** and **Pull requests**.

   Under the webhook, **Recent Deliveries** should show GitHub's test call answered `200 pong`.

6. **Try it.** Push a commit to `main`: a run starts at that commit. Open a pull request into `main`:
   a run starts at its newest commit, and the pull request shows a **zelyq/Shop tests** check that
   turns ✓ or ✗ with the run.

Pull requests from **forks** never run: their code would run with your secrets on your machines.

**Only when some files change.** On the trigger, press the **pencil** and fill in **Paths**, for
example `src/**, package.json`. A push that changes none of them does not start a run. The URL and
secret stay the same, so GitHub needs no change.

> **A delivery says `401 Unknown trigger or wrong secret.`?** The secret in GitHub is not the
> trigger's. See [when a webhook does not start a run](./pipelines.md#when-a-webhook-does-not-start-a-run).

## Part 6 — Make it faster, and reuse it

**Stages at the same time.** Lint and test do not need each other: give the second
`parallel: true`, and both run at once on machines of their own.

```yaml
  - name: Lint
    steps: [{checkout: true}, {run: npm ci && npm run lint}]
  - name: Test
    parallel: true
    steps: [{checkout: true}, {run: npm ci && npm test}]
```

**A matrix.** Test on two Node versions at once:

```yaml
  - name: Node
    matrix:
      node: [20, 22]
    steps:
      - checkout: true
      - setup: node@${{ matrix.node }}
      - run: npm ci && npm test
```

The run page stacks stages that ran together: **Lint** beside **Test**, **Node (20)** beside
**Node (22)**.

**A machine per stage.** `runs-on: mac-mini` on one stage runs just that stage on another runner.

**A template.** Put the checks every app needs in a pipeline of their own, say `Node checks`, and use
them anywhere:

```yaml
  - name: Checks
    uses: Node checks
```

Rules worth knowing (a stage beside another starts in an empty folder, so check out again; no
approvals there; what a template copies) are in
[Stages at the same time](./pipelines.md#stages-at-the-same-time-a-machine-per-stage-matrix) and
[Templates](./pipelines.md#templates-reuse-another-pipelines-stages).

---

## Where to go next

- [Pipelines](./pipelines.md): every step and option: setup, cache, docker, approvals, inputs, other
  pipelines, outputs, service containers, test reports, schedules, other CI.
- [Deploy](./deploy.md): environments, protected deploys, freeze, roll back, ports.
- [Vault](./vault.md): Protected secrets, history, service keys, and `zelyq vault run` for your own
  servers.
