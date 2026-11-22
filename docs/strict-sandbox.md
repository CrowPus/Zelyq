# The strict sandbox

On a server that strangers share, every team's code has to be treated as hostile. That
covers what the agent runs, an app's preview, a pipeline run, a pipeline's service
containers and a plugin's steps. The strict sandbox makes sure that code can't reach the
server, the other teams or your private network.

It is **always on for a managed server** (`ZELYQ_ACCOUNTS_URL` set) and cannot be turned
off there. A self-hosted server is unchanged unless its owner sets `ZELYQ_STRICT_SANDBOX=true`.

## What it does

| | Without it | With it |
| --- | --- | --- |
| Container runtime | Docker's default (`runc`): the team's code talks to the server's own kernel | `ZELYQ_CONTAINER_RUNTIME`, which must be **gVisor** (`runsc`) on a managed server: a kernel of its own between the code and the server's |
| Agent commands | `ZELYQ_RUNTIME` may be `local` (on the server itself) | `ZELYQ_RUNTIME=container` is required, or Zelyq refuses to start |
| What a container can reach | The internet, **this server's own ports**, private networks | The internet only. Never this server, a private network (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`) or a link-local/metadata address. Replies to connections made *to* the container still flow |
| Pipelines "On this server" | Allowed (an admin setting) | Refused: at start, in Settings and when a run starts |
| Plugins | A team admin may upload any `.tar.gz` | Only from the plugin registry, signed with a trusted key. On Zelyq's registry only Zelyq publishes, so each plugin is reviewed |
| A browser opening a team's page (screenshots, walking the preview, reading a website) | Chromium on the server, without its own sandbox. The page could reach this server, private networks and other teams' previews | Chromium in a gVisor container of its own, on a network that reaches nothing. Each request the page makes comes back to Zelyq. Its own preview is fetched for it, a public address goes through the address guard, and anything else is refused |
| A team's SSH runner | Any address | Never this server, a private network or a metadata address. The check is made on the exact address Zelyq connects to |

How it fails: no team container starts until the runtime is installed and the firewall is
in place. If either is missing, a project or run fails with a message saying which. The
server's health shows `strict sandbox NOT READY: …`.

### How the network wall works

Every team container joins a network whose bridge is named `zsbx…`. That is `zsbx0` for
app containers (the `zelyq-sandbox` network), and one per pipeline run for its services.
Zelyq installs two iptables chains that match only `zsbx+` interfaces, so nothing else on
the machine is touched:

- `ZELYQ-SBX-FWD` (from `DOCKER-USER`): replies are allowed. Traffic between sandbox
  bridges is left to Docker's own isolation (`enable_icc=false`). Everything to the
  blocked ranges is rejected.
- `ZELYQ-SBX-IN` (from `INPUT`): only replies. A container can't open a connection to the
  server itself, whichever of the server's addresses it uses.

IPv6 gets its own two chains (`ZELYQ-SBX6-FWD` and `ZELYQ-SBX6-IN`): nothing is forwarded,
and only replies reach the server. The bridges have link-local IPv6 addresses even on IPv4-only
networks, and services listening on `[::]` would otherwise answer them.

The rules are rebuilt in fresh chains and swapped in, so there is never a moment without
them. The install runs under a lock, because the server and the agent both install them.
It starts by checking that Docker's own firewall is visible to it (the same iptables
backend). It ends by checking that every hook is really there. Rules don't survive a reboot,
and something else on the machine (a firewall reload) can remove them, so Zelyq installs
them again before the first container after every start, and checks them again every two
minutes after that.

### Names inside a gVisor container

gVisor has its own network stack, so it can't use Docker's built-in name server
(`127.0.0.11`). Zelyq gives each gVisor container a `resolv.conf` that names
`ZELYQ_SANDBOX_DNS` (by default `1.1.1.1,8.8.8.8`). A pipeline reaches its services by
address, and Zelyq also writes each service's name into the run's `/etc/hosts`, so
`postgres:5432` keeps working.

## Setting it up (Debian/Ubuntu, Google Cloud VM)

1. Install gVisor (official release, checksum-verified). Releases are dated folders, each
   holding one bundle; `runsc` expects its helper programs in a `gvisor-bin` folder beside it.
   Pick a recent release from
   `https://storage.googleapis.com/storage/v1/b/gvisor/o?prefix=releases/release/&delimiter=/`
   (this guide was tested with `20261116.0`):

   ```bash
   RELEASE=20261116.0
   URL=https://storage.googleapis.com/gvisor/releases/release/${RELEASE}/$(uname -m)
   cd "$(mktemp -d)"
   wget ${URL}/gvisor.tar.bz2 ${URL}/gvisor.tar.bz2.sha512
   sha512sum -c gvisor.tar.bz2.sha512
   mkdir x && tar -xjf gvisor.tar.bz2 -C x
   sudo install -m 755 x/runsc x/containerd-shim-runsc-v1 /usr/local/bin/
   sudo install -d /usr/local/bin/gvisor-bin
   sudo install -m 755 x/gvisor-bin/* /usr/local/bin/gvisor-bin/
   ```

2. Register it with Docker. This writes `runsc` into `/etc/docker/daemon.json`. A reload
   is enough and running containers keep running:

   ```bash
   sudo /usr/local/bin/runsc install
   sudo systemctl reload docker
   docker info --format '{{json .Runtimes}}' | grep -q runsc && echo "gVisor ready"
   ```

3. Check it works:

   ```bash
   docker run --rm --runtime=runsc alpine dmesg | head -3   # prints "Starting gVisor..."
   ```

4. Set Zelyq's environment (server and agent read the same file):

   ```env
   ZELYQ_RUNTIME=container
   ZELYQ_CONTAINER_RUNTIME=runsc
   # Optional: the name servers gVisor containers use.
   # ZELYQ_SANDBOX_DNS=1.1.1.1,8.8.8.8
   ```

   Restart the server and the agent. On a managed server, Zelyq refuses to start with a
   clear message if any of these is missing.

5. The first time the agent opens a browser, Zelyq builds the browser image, which takes a
   couple of minutes. Its tag follows the Playwright version Zelyq uses, for example
   `zelyq/browser:pw-1.62.1` (about 1.8 GB). After that, starting a sandboxed browser takes
   about 6 seconds.

6. Keep the machine itself small. The sandbox holds the code in. The next layer is to keep
   the database and the secrets on *other* machines (Cloud SQL, Secret Manager), so even a
   container break-out finds nothing worth having here.

## Settings

| Variable | Default | Notes |
| --- | --- | --- |
| `ZELYQ_STRICT_SANDBOX` | off; always on when managed | `true` turns it on for a self-hosted server. `false` is refused on a managed one. |
| `ZELYQ_CONTAINER_RUNTIME` | Docker's default | The runtime for team containers. A managed server needs gVisor: `runsc`. |
| `ZELYQ_SANDBOX_DNS` | `1.1.1.1,8.8.8.8` | Name servers for gVisor containers. Addresses only. |
