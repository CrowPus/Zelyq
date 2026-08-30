import fs from "node:fs/promises";
import path from "node:path";
import type { FileContent, FileEntry, Preview, Snapshot } from "@zelyq/core";
import { ZelyqError } from "@zelyq/core";
import {
  agentCommandEnv,
  announcedPort,
  clearPreviewRecord,
  detectDevCommand,
  LocalRuntimeDriver,
  PREVIEW_READY_TIMEOUT_MS,
  readPreviewRecord,
  runCaptured,
  stoppedPreview,
  writePreviewRecord,
} from "./local.js";
import { allocatePort, previewUrl, releasePort } from "./ports.js";
import type {
  ExecOptions,
  ExecResult,
  ListOptions,
  PreviewOptions,
  ProjectRuntime,
  RuntimeConfig,
  RuntimeDriver,
  RuntimeHealth,
  ScaffoldFile,
} from "./types.js";

/**
 * Agent commands and the dev server both run inside a container, one per
 * project.
 *
 * Zelyq runs code a language model wrote. Until now that code ran as the
 * server's own user — `SECURITY.md` says so plainly — which is why the product
 * has only ever been safe for one trusted developer on one machine.
 *
 * **The container is an execution jail, not a storage layer.** Of the twenty
 * methods on `RuntimeDriver`, exactly two spawn a process — `exec` and
 * `startPreview` — and both do it inside the container now. The rest read and
 * write files under the project root, and they keep doing that on the host,
 * directly and unchanged, against a directory the container has bind-mounted.
 * Reimplementing the filesystem across a container boundary would have been
 * weeks of work and a new class of bug for no benefit.
 *
 * Composition rather than inheritance. Inheritance would need six private
 * fields made protected and a `readonly kind` widened on the base class, to
 * save a dozen one-line delegations. The delegations are also honest: what is
 * isolated, and what is not, is visible in this file rather than implied by
 * what a subclass forgot to override.
 *
 * The preview has no live child-process object to hold the way the local
 * driver's does — `startPreview` runs the dev server detached via `docker
 * exec` and returns, so status is always *derived*: from the on-disk record
 * `local.ts` already writes, and a liveness/readiness check run through
 * `docker exec` rather than the host's own pid table or a host-side port
 * probe. The second of those was not assumed to work — a host-side TCP
 * connect to the published port turned out to succeed the moment the
 * container exists, whether or not anything inside is listening, because
 * `docker-proxy` accepts the handshake itself. Confirmed against a real
 * container before this was written, not guessed at; see `probeInContainer`.
 *
 * Project containers share one dedicated network with inter-container
 * communication disabled, rather than Docker's default bridge. Verified live
 * before this was written, not assumed: on the default bridge, one project's
 * container can reach another's — connect to its internal IP and port
 * directly, no publishing required — which is a cross-*tenant* leak on a
 * multi-project deployment. `enable_icc=false` closes it while leaving each
 * container's own route to the real internet untouched.
 *
 * The cloud metadata endpoint (169.254.169.254) is blocked by default, the
 * same way and for the same reason — see `installMetadataBlock`.
 *
 * ## What this does not do by default
 *
 * **General egress is not filtered.** A container can still reach anything
 * else on the internet and the host's own network. An operator who wants
 * that closed can opt into `egressAllowlist` — a default-deny rule with an
 * `ipset`-backed allow list the *operator* supplies and maintains. Zelyq
 * does not ship or maintain a default list of "what a project needs":
 * `registry.npmjs.org` alone resolves to a dozen Cloudflare addresses that
 * are not a fixed fact Zelyq could promise to keep current. Off by default;
 * on is a deliberate, narrower choice than it sounds.
 */

const DEFAULT_IMAGE = "node:22-bookworm-slim";
const DEFAULT_MEMORY = "2g";
const DEFAULT_CPUS = "2";
const DEFAULT_PIDS = 512;
/**
 * One network, shared by every project this driver ever creates a container
 * for — including across separate Zelyq processes on the same host. Sharing
 * it is safe rather than a shortcut: `enable_icc=false` only ever removes
 * reachability, never grants it, so two unrelated Zelyq instances on one
 * machine are no worse off sharing this network than each having their own.
 */
const DEFAULT_NETWORK = "zelyq-projects";
/** Long enough for `docker run` to pull on a cold cache. */
const ENGINE_TIMEOUT_MS = 300_000;
/**
 * The cloud instance metadata address. AWS, Azure, DigitalOcean, Oracle Cloud
 * and GCP all converge on this one link-local IP — documented, stable
 * provider behaviour, not something specific to any one of them. On most
 * providers it will hand a request for it credentials for the instance
 * itself, no authentication required.
 */
const METADATA_ADDRESS = "169.254.169.254/32";
/** Only used to install `iptables`/`ipset` inside the throwaway helper container. */
const FIREWALL_HELPER_IMAGE = "alpine";
/**
 * One set, shared the same way `DEFAULT_NETWORK` is: two Zelyq instances on
 * one host sharing this name end up with the union of both allowlists, which
 * is the same "removes reachability, never grants surprise reachability
 * beyond what either operator asked for" shape `DEFAULT_NETWORK`'s sharing
 * already relies on — not a gap introduced here.
 */
const EGRESS_ALLOW_SET = "zelyq-egress-allow";
/**
 * DNS TTLs are not a promise a firewall should trust — this is a fixed
 * republish instead. Five minutes: frequent enough that a CDN reshuffling
 * its addresses is noticed soon, infrequent enough that a helper container
 * is not churning constantly for a list that rarely changes.
 */
const EGRESS_REFRESH_INTERVAL_MS = 5 * 60_000;
/**
 * How long a resolved address stays allowed after its most recent sighting —
 * an `ipset` per-entry timeout, not the refresh interval above. Deliberately
 * a multiple of it, not equal to it: checked live, not assumed, that a
 * single refresh's resolution is a *sample* of a round-robin pool, not the
 * complete truth. Three independent queries for `github.com`, minutes
 * apart, returned three different addresses, each one stable for repeated
 * queries within that same short window. A one-shot "replace the allowed
 * set with whatever this refresh happened to resolve" design — what this
 * had before — drops an address the moment one refresh doesn't happen to
 * re-sample it, which is indistinguishable from that address going bad.
 * Three refresh cycles of silence is the signal actually worth acting on.
 */
const EGRESS_ALLOW_TIMEOUT_SECONDS = (EGRESS_REFRESH_INTERVAL_MS / 1000) * 3;

export interface ContainerOptions {
  image?: string;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
  /** The `docker` binary, or a drop-in such as `podman`. */
  engine?: string;
  /** The network project containers attach to. Rarely worth changing. */
  network?: string;
  /**
   * Whether to block containers from reaching the cloud metadata endpoint.
   * On by default. See the class doc for why this exists and what it does
   * and does not do — it is the one thing this driver does that reaches past
   * objects Zelyq itself creates and destroys,
   * and disabling it is a legitimate choice for an operator who manages their
   * own firewall and does not want an out-of-band tool touching it.
   */
  blockMetadataEndpoint?: boolean;
  /**
   * Hostnames project containers are allowed to reach; everything else on
   * the internet is default-denied. Unset or empty (the default): nothing
   * changes, egress is unfiltered as it always has been. There is no
   * Zelyq-maintained default list — see the class doc for why: a list Zelyq
   * owns is a promise about addresses it does not control and
   * cannot keep current, and getting it wrong breaks a real install rather
   * than failing safely. This is the operator's list, for the operator's
   * deployment.
   */
  egressAllowlist?: string[];
}

export class ContainerRuntimeDriver implements RuntimeDriver {
  readonly kind = "container" as const;

  private readonly local: LocalRuntimeDriver;
  private readonly workspaceDir: string;
  private readonly image: string;
  private readonly memory: string;
  private readonly cpus: string;
  private readonly pidsLimit: number;
  private readonly engine: string;
  private readonly network: string;
  private readonly execTimeoutMs: number;
  private readonly portRange: [number, number];
  /** What the preview URL names — the address a browser on this machine reaches it at. */
  private readonly previewHost: string;
  /** What `--publish` binds to. Loopback for loopback previews; every interface otherwise. */
  private readonly previewBindHost: string;
  /** See `RuntimeConfig.previewUrlTemplate`. */
  private readonly previewUrlTemplate: string | undefined;
  /** Projects whose container this process has already started. */
  private readonly started = new Set<string>();
  /** The preview port published on that container, if any. */
  private readonly containerPort = new Map<string, number>();
  /**
   * A start that failed before any process existed to track — a bad install,
   * a container that would not come up. There is no pid and no record file for
   * either, so without this a repeat status check would report "stopped"
   * rather than repeating the reason, which is what `local.ts` avoids by
   * keeping a failed attempt in memory too.
   */
  private readonly lastFailure = new Map<string, Preview>();
  /**
   * Serialises operations that change what a project's container *is* —
   * create, recreate, destroy. Held only around the mutation itself, inside
   * `ensureContainer`/`destroyContainer` — never around a caller of those,
   * which is what keeps this safe to acquire from inside `withPreviewLock`
   * below without the two deadlocking each other.
   */
  private readonly locks = new Map<string, Promise<unknown>>();
  /**
   * Serialises `startPreview` and `stopPreview` for one project, so two
   * concurrent calls cannot both decide nothing is running and both spawn a
   * server. A separate map from `locks`, deliberately: `startPreview` runs
   * *inside* this lock and calls `exec`, which acquires `locks` internally —
   * the same lock nested inside itself would never resolve.
   */
  private readonly previewLocks = new Map<string, Promise<unknown>>();
  /**
   * Memoised so the network is created at most once per process rather than
   * once per project — `docker network create` on a name that already exists
   * is an error, not a no-op, so every caller has to share one attempt rather
   * than each trying its own. `undefined` until the first project needs it;
   * cleared on failure so a transient docker error does not permanently wedge
   * every container creation for the rest of the process's life.
   */
  private networkReady: Promise<void> | undefined;
  /** Same memoisation shape as `networkReady`, for the metadata-block rule. */
  private metadataBlockReady: Promise<void> | undefined;
  private readonly blockMetadataEndpoint: boolean;
  /**
   * Set when the block could not be installed, so `health()` can say so
   * rather than the failure being silent. A container is still allowed to
   * start without it — see the call site in `ensureContainer` for why.
   */
  private metadataBlockFailure: string | undefined;
  /** Empty means disabled — see `ContainerOptions.egressAllowlist`. */
  private readonly egressAllowlist: string[];
  /** Same memoisation shape as `networkReady`/`metadataBlockReady`. */
  private egressAllowlistReady: Promise<void> | undefined;
  /** Same visibility contract as `metadataBlockFailure` — surfaced, not enforced. */
  private egressAllowlistFailure: string | undefined;
  /** Cleared on `dispose()` so refreshing an allowlist never outlives this driver. */
  private egressRefreshTimer: NodeJS.Timeout | undefined;
  /**
   * Same memoisation shape as `egressAllowlistReady`, for the opposite case —
   * see `teardownEgressAllowlist` for why this exists at all.
   */
  private egressAllowlistTornDown: Promise<void> | undefined;

  constructor(config: RuntimeConfig, options: ContainerOptions = {}) {
    this.local = new LocalRuntimeDriver(config);
    this.workspaceDir = path.resolve(config.workspaceDir);
    this.execTimeoutMs = config.execTimeoutMs;
    this.portRange = config.previewPortRange;
    this.previewHost = config.previewHost || "127.0.0.1";
    this.previewBindHost =
      this.previewHost === "127.0.0.1" || this.previewHost === "localhost"
        ? "127.0.0.1"
        : "0.0.0.0";
    this.previewUrlTemplate = config.previewUrlTemplate || undefined;
    this.image = options.image ?? DEFAULT_IMAGE;
    this.memory = options.memory ?? DEFAULT_MEMORY;
    this.cpus = options.cpus ?? DEFAULT_CPUS;
    this.pidsLimit = options.pidsLimit ?? DEFAULT_PIDS;
    this.engine = options.engine ?? "docker";
    this.network = options.network ?? DEFAULT_NETWORK;
    this.blockMetadataEndpoint = options.blockMetadataEndpoint ?? true;
    this.egressAllowlist = (options.egressAllowlist ?? [])
      .map((hostname) => hostname.trim())
      .filter(Boolean);
  }

  /** The address a browser should load a running preview at. */
  private previewUrlFor(port: number): string {
    return previewUrl(this.previewUrlTemplate, this.previewHost, port);
  }

  /**
   * Runs `fn` after every operation already queued for this project has
   * settled, and queues `fn` itself for whatever comes next. A prior failure
   * does not block the next operation — only its own caller sees the
   * rejection — which is why the queued tail swallows errors while the
   * returned promise does not.
   */
  private withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return chained(this.locks, projectId, fn);
  }

  /** Same mechanism, the other map — see the field comments for why they differ. */
  private withPreviewLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return chained(this.previewLocks, projectId, fn);
  }

  async health(): Promise<RuntimeHealth> {
    const local = await this.local.health();
    if (!local.ok) return { ...local, kind: this.kind };

    const probe = await this.engineRun(["version", "--format", "{{.Server.Version}}"], 10_000);
    if (probe.exitCode !== 0) {
      return {
        kind: this.kind,
        ok: false,
        detail:
          `${this.engine} is not usable: ${firstLine(probe.stderr) || firstLine(probe.stdout)}. ` +
          "Agent commands cannot run without a container engine.",
      };
    }
    // Reported, not enforced here: a firewall problem should not also make
    // the instance report unhealthy, or a project could not be created while
    // someone diagnoses it. See the call site in `ensureContainer`.
    const metadataStatus = !this.blockMetadataEndpoint
      ? "metadata block disabled"
      : this.metadataBlockFailure
        ? `metadata block FAILED: ${this.metadataBlockFailure}`
        : "metadata block on";
    const egressStatus =
      this.egressAllowlist.length === 0
        ? // A failed teardown means a previous run's rules may still be
          // active despite nothing being configured now — worth surfacing,
          // not the silent `null` an intentionally-unfiltered instance gets.
          this.egressAllowlistFailure
          ? `egress allowlist teardown FAILED, may still be restricting traffic: ${this.egressAllowlistFailure}`
          : null
        : this.egressAllowlistFailure
          ? `egress allowlist FAILED: ${this.egressAllowlistFailure}`
          : `egress allowlist on (${this.egressAllowlist.length} host${
              this.egressAllowlist.length === 1 ? "" : "s"
            })`;

    return {
      kind: this.kind,
      ok: true,
      detail:
        `${local.detail} · ${this.engine} ${firstLine(probe.stdout)} · image ${this.image} · ` +
        metadataStatus +
        (egressStatus ? ` · ${egressStatus}` : ""),
      version: process.version,
    };
  }

  /**
   * A command inside the project's container.
   *
   * The environment comes from `agentCommandEnv`, the same source the local
   * driver uses, so the two cannot drift. `PATH` is deliberately *not* carried
   * over from the host — the container has its own node, and pointing at the
   * host's would name paths that do not exist inside it.
   */
  async exec(projectId: string, options: ExecOptions): Promise<ExecResult> {
    const { root } = await this.local.ensureProject(projectId);
    // Unlocked at this level on purpose: `ensureContainer` locks only the
    // create/recreate it may need to do, not the check, so an ordinary
    // command that finds a container already there pays nothing for it.
    await this.ensureContainer(projectId, root);

    // Refused rather than resolved on the host: a `cwd` that escaped the
    // project would be silently created inside the container, which reads as
    // an empty directory rather than as the error it is.
    const cwd = containerCwd(options.cwd);
    const env = agentCommandEnv(options.env);

    const args = ["exec", "--workdir", cwd];
    for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
    args.push(containerName(projectId), "/bin/bash", "-c", options.command);

    return await runCaptured(this.engine, args, {
      timeoutMs: options.timeoutMs ?? this.execTimeoutMs,
      maxOutputBytes: options.maxOutputBytes ?? 200_000,
    });
  }

  async removeProject(projectId: string): Promise<void> {
    await this.stopPreview(projectId).catch(() => undefined);
    await this.withProjectLock(projectId, () => this.destroyContainer(projectId));
    this.lastFailure.delete(projectId);
    await this.local.removeProject(projectId);
  }

  async dispose(): Promise<void> {
    if (this.egressRefreshTimer) clearInterval(this.egressRefreshTimer);
    // Sequential on purpose: a machine with many projects should not be asked
    // to tear down fifty containers at once while it is already shutting down.
    for (const projectId of [...this.started]) {
      await this.withProjectLock(projectId, () => this.destroyContainer(projectId)).catch(
        () => undefined,
      );
    }
    await this.local.dispose();
  }

  // -------------------------------------------------------------------------
  // Delegated to the host, unchanged. These read and write files under the
  // project root — the same directory the container has mounted — so there is
  // nothing to gain by routing them through it.
  // -------------------------------------------------------------------------

  ensureProject(projectId: string): Promise<ProjectRuntime> {
    return this.local.ensureProject(projectId);
  }
  scaffold(projectId: string, files: ScaffoldFile[]): Promise<void> {
    return this.local.scaffold(projectId, files);
  }
  listFiles(projectId: string, options?: ListOptions): Promise<FileEntry[]> {
    return this.local.listFiles(projectId, options);
  }
  readFile(projectId: string, path: string): Promise<FileContent> {
    return this.local.readFile(projectId, path);
  }
  writeFile(
    projectId: string,
    path: string,
    content: string,
    encoding?: "utf8" | "base64",
  ): Promise<void> {
    return this.local.writeFile(projectId, path, content, encoding);
  }
  deleteFile(projectId: string, path: string): Promise<void> {
    return this.local.deleteFile(projectId, path);
  }
  createSnapshot(projectId: string, label: string): Promise<Snapshot> {
    return this.local.createSnapshot(projectId, label);
  }
  restoreSnapshot(projectId: string, snapshotId: string): Promise<void> {
    return this.local.restoreSnapshot(projectId, snapshotId);
  }
  readSnapshotFile(projectId: string, snapshotId: string, path: string): Promise<FileContent> {
    return this.local.readSnapshotFile(projectId, snapshotId, path);
  }

  /**
   * The dev server, inside the container.
   *
   * There is no live child-process object to hold — the process is started
   * detached via `docker exec` and outlives this call — so status is always
   * derived, the same way `local.ts` derives it for a preview *another*
   * process started: from the on-disk record plus a liveness check, here
   * always run through `docker exec` rather than the host's own pid table.
   */
  async startPreview(projectId: string, options: PreviewOptions = {}): Promise<Preview> {
    return await this.withPreviewLock(projectId, async () => {
      const quick = await this.checkPreview(projectId);
      if (quick.status === "running" || quick.status === "starting") return quick;

      const { root } = await this.local.ensureProject(projectId);
      this.lastFailure.delete(projectId);
      const name = containerName(projectId);

      // A container to install into. No port needed yet — that is decided
      // once the install has succeeded, and asking for one here would recreate
      // the container twice on a project's very first preview.
      await this.ensureContainer(projectId, root);

      const hasModules = await fs
        .access(path.join(root, "node_modules"))
        .then(() => true)
        .catch(() => false);
      if (!hasModules) {
        const install = await this.exec(projectId, {
          command: "npm install --no-audit --no-fund --include=dev",
          timeoutMs: 10 * 60_000,
        });
        if (install.exitCode !== 0) {
          return this.fail(projectId, `Dependency install failed (exit ${install.exitCode})`);
        }
      }

      const port = options.port ?? (await allocatePort(this.portRange));
      // The container must have exactly this port published. If it does not —
      // the common case, since the install above did not ask for one — it is
      // recreated. Safe: nothing lives in the container's own layer.
      await this.ensureContainer(projectId, root, port);

      // Inside the container the server always binds every interface; it is
      // `--publish` above, not this flag, that decides what the host can
      // reach. Binding `previewBindHost` here would tell the process to listen
      // only on the container's own loopback or its own single address, which
      // is not the interface docker's forwarding arrives on.
      const command = options.command ?? (await detectDevCommand(root, port, "0.0.0.0"));
      const env = { ...agentCommandEnv(options.env), PORT: String(port), HOST: "0.0.0.0" };

      const spawned = await this.spawnDetached(name, command, env);
      if (!spawned.pid) {
        releasePort(port);
        return this.fail(
          projectId,
          `Could not start the dev server: ${spawned.detail || "no process id was reported"}`,
        );
      }

      const startedAt = new Date().toISOString();
      await writePreviewRecord(this.workspaceDir, projectId, {
        pid: spawned.pid,
        port,
        startedAt,
        ownerPid: process.pid,
      });

      // The same shape as `local.ts`: keep waiting on the port we assigned:
      // an announced *different* port shortens the remaining wait to three
      // seconds rather than confirming the other port is reachable, because
      // it is a diagnosis, not a redirect.
      const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
      let shortDeadline: number | null = null;
      let elsewhere: number | null = null;
      let ready = false;
      while (Date.now() < (shortDeadline ?? deadline)) {
        if (await this.probeInContainer(name, port)) {
          ready = true;
          break;
        }
        if (elsewhere === null) {
          const log = await this.readLog(name);
          const announced = announcedPort(log);
          if (announced !== null && announced !== port) {
            elsewhere = announced;
            shortDeadline = Date.now() + 3_000;
          }
        }
        // Each iteration is already at least one `docker exec` round trip;
        // this just keeps a fast engine from spinning tighter than there is
        // any reason to.
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      if (ready) {
        return {
          projectId,
          status: "running",
          url: this.previewUrlFor(port),
          port,
          pid: spawned.pid,
          startedAt,
          lastError: null,
        };
      }

      // Whatever it is doing, it is not serving this preview. Left alive it
      // holds a container-internal port and a live pid a later status check
      // would read back as "still starting" — the same reason `local.ts`
      // kills the child on this path.
      await this.killInContainer(name, spawned.pid);
      releasePort(port);
      await clearPreviewRecord(this.workspaceDir, projectId);

      return this.fail(
        projectId,
        elsewhere === null
          ? "Dev server did not start listening in time"
          : `The dev server started on port ${elsewhere}, not the ${port} Zelyq assigned it. ` +
              "That usually means the project's own config sets a fixed port.",
      );
    });
  }

  async stopPreview(projectId: string): Promise<Preview> {
    return await this.withPreviewLock(projectId, async () => {
      this.lastFailure.delete(projectId);
      // Not gated on whether *this* process started the container: the other
      // half of Zelyq (agent or server, each holding its own driver instance)
      // may have. A container that does not exist just fails the exec below,
      // caught the same way every other engine call is.
      const record = await readPreviewRecord(this.workspaceDir, projectId);
      if (record) {
        await this.killInContainer(containerName(projectId), record.pid);
        releasePort(record.port);
      }
      await clearPreviewRecord(this.workspaceDir, projectId);
      return stoppedPreview(projectId);
    });
  }

  async previewStatus(projectId: string): Promise<Preview> {
    return await this.checkPreview(projectId);
  }

  async previewLogs(projectId: string, lines = 200): Promise<string> {
    const text = await this.readLog(containerName(projectId));
    return text.split("\n").slice(-lines).join("\n");
  }

  /**
   * Derives status the way `local.ts` does for a preview a *different*
   * process started: from the on-disk record and a liveness check, never from
   * memory this process might not hold.
   */
  private async checkPreview(projectId: string): Promise<Preview> {
    const record = await readPreviewRecord(this.workspaceDir, projectId);
    if (!record) return this.lastFailure.get(projectId) ?? stoppedPreview(projectId);

    const name = containerName(projectId);
    const alive = await this.processAliveInContainer(name, record.pid);
    if (!alive) {
      await clearPreviewRecord(this.workspaceDir, projectId);
      return this.lastFailure.get(projectId) ?? stoppedPreview(projectId);
    }

    // Checked from inside the container, not via a host-side `waitForPort`:
    // `docker-proxy` accepts the TCP handshake on the published host port
    // regardless of whether anything inside is listening, so a host-side
    // check here would report every live process as "running" forever.
    const listening = await this.probeInContainer(name, record.port);

    // A live process on a dead port, once it has had long enough to start, is
    // not "still starting" — reporting it as such is how a spinner becomes
    // permanent. Same reasoning as `local.ts`'s `adoptPreview`.
    const age = Date.now() - new Date(record.startedAt).getTime();
    if (!listening && Number.isFinite(age) && age > PREVIEW_READY_TIMEOUT_MS) {
      return {
        projectId,
        status: "crashed",
        url: null,
        port: record.port,
        pid: record.pid,
        startedAt: record.startedAt,
        lastError: `The dev server is running but nothing is listening on port ${record.port}.`,
      };
    }

    return {
      projectId,
      status: listening ? "running" : "starting",
      url: listening ? this.previewUrlFor(record.port) : null,
      port: record.port,
      pid: record.pid,
      startedAt: record.startedAt,
      lastError: null,
    };
  }

  private fail(projectId: string, message: string): Preview {
    const failed: Preview = {
      projectId,
      status: "crashed",
      url: null,
      port: null,
      pid: null,
      startedAt: new Date().toISOString(),
      lastError: message,
    };
    this.lastFailure.set(projectId, failed);
    return failed;
  }

  /**
   * Starts `command` in the background inside the container and returns its
   * pid, without a pidfile round trip: `setsid` makes the backgrounded process
   * its own session leader — killable as a group by that same pid, the
   * container-side equivalent of `killPidTree` — and its pid is `$!`, echoed
   * straight back on this call's own stdout before it returns.
   */
  private async spawnDetached(
    name: string,
    command: string,
    env: Record<string, string>,
  ): Promise<{ pid: number | null; detail: string }> {
    const escaped = command.replace(/'/g, `'\\''`);
    const script = `setsid bash -c '${escaped}' > /tmp/preview.log 2>&1 < /dev/null & echo $!`;

    const envArgs: string[] = [];
    for (const [key, value] of Object.entries(env)) envArgs.push("--env", `${key}=${value}`);

    const result = await this.engineRun(
      ["exec", ...envArgs, "--workdir", "/workspace", name, "/bin/bash", "-c", script],
      15_000,
    );
    const pid = Number.parseInt(result.stdout.trim(), 10);
    return {
      pid: Number.isFinite(pid) && pid > 0 ? pid : null,
      detail: firstLine(result.stderr) || firstLine(result.stdout),
    };
  }

  /** Bounded, so a dev server that never stops talking cannot grow this without limit. */
  private async readLog(name: string): Promise<string> {
    const result = await this.engineRun(
      ["exec", name, "tail", "-c", "65536", "/tmp/preview.log"],
      10_000,
    );
    return result.exitCode === 0 ? result.stdout : "";
  }

  /**
   * Whether something is actually answering on `port`, checked from *inside*
   * the container.
   *
   * `waitForPort` — a host-side TCP connect — is not a valid check here and
   * was tried first: `docker-proxy` accepts the TCP handshake on the
   * published host port the moment the container exists, whether or not
   * anything inside is listening, so the host-side connect succeeds
   * immediately regardless of whether the dev server has even started.
   * Confirmed against a real container before this was written, not assumed:
   * a script that never binds the assigned port at all still read as
   * "running" under the host-side check.
   *
   * `node` is always present in the image; `curl`/`wget` are not.
   */
  private async probeInContainer(name: string, port: number): Promise<boolean> {
    const script = `node -e "fetch('http://127.0.0.1:${port}').then(()=>process.exit(0)).catch(()=>process.exit(1))"`;
    const result = await this.engineRun(["exec", name, "bash", "-c", script], 5_000);
    return result.exitCode === 0;
  }

  /**
   * `kill` is a shell builtin, not a binary — `node:22-bookworm-slim` has no
   * `/bin/kill`, so every call here has to go through a shell. The first
   * version of this driver passed `kill` as the exec argument directly:
   * docker reported "executable file not found", every liveness check read as
   * dead, and every stop was a silent no-op that left the server running.
   */
  private async processAliveInContainer(name: string, pid: number): Promise<boolean> {
    const result = await this.engineRun(["exec", name, "bash", "-c", `kill -0 ${pid}`], 10_000);
    return result.exitCode === 0;
  }

  /**
   * The container-side equivalent of `killPidTree`: the same signal, the same
   * negative-pid process-group target, the same grace period. `setsid` in
   * `spawnDetached` is what makes the group exist — confirmed against a real
   * container, not assumed: `npm run dev` and its `sh`/`node` children all
   * shared one process group, and `kill -TERM -<pid>` took out every one.
   */
  private async killInContainer(name: string, pid: number): Promise<void> {
    await this.engineRun(["exec", name, "bash", "-c", `kill -TERM -${pid}`], 10_000);
    setTimeout(() => {
      void this.engineRun(["exec", name, "bash", "-c", `kill -KILL -${pid}`], 10_000).catch(
        () => undefined,
      );
    }, 3_000).unref();
  }

  // -------------------------------------------------------------------------

  /**
   * Idempotent, and — the part step one did not need — able to recreate.
   *
   * Docker publishes ports at creation time; there is no way to add one to a
   * container that is already running. So when `publishPort` names a port the
   * current container does not have, the only way to get it is to destroy and
   * recreate. Safe: nothing lives in the container's own writable layer, the
   * project is the bind mount, and the root filesystem is already read-only.
   *
   * Called directly — not wrapped in a caller's lock — because it locks only
   * the create/recreate itself, internally, once it knows one is needed. Any
   * caller may safely call it from inside `withPreviewLock`: that lock and
   * `locks` below are different maps, so nothing here can deadlock against it.
   */
  private async ensureContainer(
    projectId: string,
    root: string,
    publishPort?: number,
  ): Promise<void> {
    const name = containerName(projectId);

    if (this.hasWhatWeNeed(projectId, publishPort)) return;

    if (!this.started.has(projectId)) {
      const running = await this.engineRun(
        ["inspect", "--format", "{{.State.Running}}", name],
        10_000,
      );
      if (running.exitCode === 0 && running.stdout.trim() === "true") {
        if (publishPort === undefined) {
          this.started.add(projectId);
          return;
        }
        const published = await this.engineRun(["port", name, `${publishPort}/tcp`], 10_000);
        if (published.exitCode === 0 && published.stdout.trim() !== "") {
          this.started.add(projectId);
          this.containerPort.set(projectId, publishPort);
          return;
        }
        // Exists, from an earlier `exec`-only container — recreate below.
      } else if (running.exitCode === 0) {
        // Present but stopped: a machine that rebooted, or a previous crash.
        await this.engineRun(["rm", "-f", name], 30_000);
      }
    }

    // Only the mutation is serialised. A concurrent caller that reaches here
    // while a recreate is already running waits for it, then re-checks —
    // harmlessly finding it already done, rather than recreating twice.
    await this.withProjectLock(projectId, async () => {
      if (this.hasWhatWeNeed(projectId, publishPort)) return;

      await this.ensureNetwork();
      // The rule is scoped by source to this network's subnet, so it has to
      // exist first — but it does not have to succeed before a container can
      // be created. A firewall problem should not also be a "cannot open any
      // project" problem; it is surfaced through `health()` instead.
      if (this.blockMetadataEndpoint) {
        await this.ensureMetadataBlock().catch((error: unknown) => {
          this.metadataBlockFailure = error instanceof Error ? error.message : String(error);
        });
      }
      // Same non-blocking posture, same reason: an operator's allowlist going
      // stale should not also be a "cannot open any project" problem.
      if (this.egressAllowlist.length > 0) {
        await this.ensureEgressAllowlist().catch((error: unknown) => {
          this.egressAllowlistFailure = error instanceof Error ? error.message : String(error);
        });
      } else {
        // A driver that starts up with no allowlist must not silently
        // inherit whatever a *previous* run's allowlist left installed on
        // the host.
        await this.teardownEgressAllowlist().catch((error: unknown) => {
          this.egressAllowlistFailure = error instanceof Error ? error.message : String(error);
        });
      }
      await this.engineRun(["rm", "-f", name], 30_000).catch(() => undefined);
      const created = await this.engineRun(
        this.runArgs(name, root, publishPort),
        ENGINE_TIMEOUT_MS,
      );
      if (created.exitCode !== 0) {
        throw new ZelyqError(
          "runtime_unavailable",
          `Could not start a container for this project: ${
            firstLine(created.stderr) || firstLine(created.stdout) || "unknown error"
          }`,
        );
      }
      this.started.add(projectId);
      if (publishPort === undefined) this.containerPort.delete(projectId);
      else this.containerPort.set(projectId, publishPort);
    });
  }

  private hasWhatWeNeed(projectId: string, publishPort?: number): boolean {
    if (!this.started.has(projectId)) return false;
    return publishPort === undefined || this.containerPort.get(projectId) === publishPort;
  }

  /**
   * The dedicated, `enable_icc=false` network every project container joins.
   * Idempotent: `docker network create` on an existing name is an error, so
   * "already exists" is treated as success rather than propagated. Memoised
   * on `networkReady` so concurrent callers — different projects racing their
   * very first container — share one attempt instead of each making their
   * own; a failed attempt clears the memo so the next call tries again rather
   * than every container creation failing for the rest of the process.
   */
  private ensureNetwork(): Promise<void> {
    if (!this.networkReady) {
      this.networkReady = this.createNetworkIfMissing().catch((error: unknown) => {
        this.networkReady = undefined;
        throw error;
      });
    }
    return this.networkReady;
  }

  private async createNetworkIfMissing(): Promise<void> {
    const exists = await this.engineRun(["network", "inspect", this.network], 10_000);
    if (exists.exitCode === 0) return;

    const created = await this.engineRun(
      [
        "network",
        "create",
        // The whole point: one project's container must not be able to reach
        // another's. Verified live before this was written — on the default
        // bridge, a second container could connect to the first's internal
        // port directly, no publishing required, which is a cross-tenant leak
        // on the exact deployment this driver exists for.
        "--opt",
        "com.docker.network.bridge.enable_icc=false",
        this.network,
      ],
      30_000,
    );
    if (created.exitCode === 0) return;

    // Lost a race with another process creating the same network at the same
    // moment — not a failure, the network exists either way now.
    const raced = await this.engineRun(["network", "inspect", this.network], 10_000);
    if (raced.exitCode === 0) return;

    throw new ZelyqError(
      "runtime_unavailable",
      `Could not create the "${this.network}" network: ${
        firstLine(created.stderr) || firstLine(created.stdout) || "unknown error"
      }`,
    );
  }

  /**
   * Blocks project containers from reaching the cloud instance metadata
   * endpoint. See the class doc for the reasoning and the scope this was
   * deliberately kept to.
   *
   * The one thing this driver does that reaches past objects Zelyq itself
   * creates and destroys: a rule written into the *host's* `DOCKER-USER`
   * iptables chain, the chain Docker reserves for exactly this — operator
   * rules that survive `dockerd` restarts rather than being overwritten by
   * it. Applied through a privileged helper container with `--network host`,
   * never a direct `sudo` call from the Zelyq process itself: the same
   * "docker group access is root-equivalent" property every other privileged
   * operation in this file already relies on, used here for the first time to
   * touch something outside Docker's own object model.
   *
   * **Scoped by source to this driver's own network, not host-wide.** A
   * host-wide rule would protect every container on the machine, including
   * ones Zelyq did not create — which sounds like a bonus and is actually
   * scope creep: this driver has no business deciding network policy for
   * workloads it does not own. Scoping by source also makes the rule
   * genuinely idempotent to *check*: a second Zelyq instance on the same host
   * computes the same subnet from the same network and finds its own rule
   * already there, rather than each instance's host-wide rule silently
   * shadowing the other's.
   *
   * **`REJECT`, not `DROP`.** A dropped packet leaves the caller to hang until
   * its own timeout, which for arbitrary code reaching for this address on
   * purpose or by accident could be long or absent — burning into an agent
   * turn's exec budget for no visible reason. A reset closes the connection
   * immediately: the same protection, a debuggable failure instead of a
   * silent one.
   */
  private ensureMetadataBlock(): Promise<void> {
    if (!this.metadataBlockReady) {
      this.metadataBlockReady = this.installMetadataBlock().catch((error: unknown) => {
        this.metadataBlockReady = undefined;
        throw error;
      });
    }
    return this.metadataBlockReady;
  }

  private async installMetadataBlock(): Promise<void> {
    const subnet = await this.networkSubnet();
    const rule = [
      "-s",
      subnet,
      "-d",
      METADATA_ADDRESS,
      // Required by this host's nf_tables-backed iptables: `--reject-with
      // tcp-reset` only makes sense for TCP, and without an explicit `-p tcp`
      // the insert fails outright ("Invalid argument") rather than falling
      // back to any implicit protocol. Every cloud metadata endpoint is
      // HTTP/TCP, so this does not narrow what the rule actually needs to
      // cover.
      "-p",
      "tcp",
      "-j",
      "REJECT",
      "--reject-with",
      "tcp-reset",
    ];

    await this.withFirewallHelper(async (execIn) => {
      const check = await execIn(["iptables", "-C", "DOCKER-USER", ...rule]);
      if (check.exitCode === 0) return; // already present — nothing to do

      const insert = await execIn(["iptables", "-I", "DOCKER-USER", ...rule]);
      if (insert.exitCode !== 0) {
        throw new ZelyqError(
          "runtime_unavailable",
          `Could not block the metadata endpoint: ${
            firstLine(insert.stderr) || firstLine(insert.stdout) || "unknown error"
          }`,
        );
      }
    });
  }

  /**
   * Runs `fn` inside a short-lived, privileged helper container with
   * `iptables` and `ipset` installed — the one mechanism `installMetadataBlock`
   * and the egress allowlist below both use to touch the host's own firewall
   * state. Started, used, removed, every time: never a persistent privileged
   * container, the same posture `installMetadataBlock` established first.
   */
  private async withFirewallHelper<T>(
    fn: (execIn: (args: string[]) => Promise<ExecResult>) => Promise<T>,
  ): Promise<T> {
    const helper = `zelyq-firewall-setup-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const started = await runCaptured(
      this.engine,
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        helper,
        "--network",
        "host",
        "--cap-add",
        "NET_ADMIN",
        FIREWALL_HELPER_IMAGE,
        "sh",
        "-c",
        // Stays up long enough for `fn`'s exec calls. Neither tool is in the
        // base image, so the first thing this container does is fetch them —
        // over the host's own network, before any project container or
        // restriction exists, so nothing here is circular.
        "apk add --no-cache iptables ipset bind-tools >/dev/null 2>&1 && sleep 60",
      ],
      { timeoutMs: 60_000, maxOutputBytes: 5_000 },
    );
    if (started.exitCode !== 0) {
      throw new ZelyqError(
        "runtime_unavailable",
        `Could not start the firewall setup helper: ${
          firstLine(started.stderr) || firstLine(started.stdout) || "unknown error"
        }`,
      );
    }

    try {
      // Waiting for `apk add` to finish, not for the container to exist —
      // `docker exec` against a container whose entrypoint has not reached
      // `sleep` yet just fails, and would read as "the tools are broken"
      // rather than "still installing them".
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline) {
        const probe = await runCaptured(this.engine, ["exec", helper, "which", "iptables"], {
          timeoutMs: 5_000,
          maxOutputBytes: 1_000,
        });
        if (probe.exitCode === 0) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!ready) {
        throw new ZelyqError(
          "runtime_unavailable",
          "The firewall setup helper could not install iptables/ipset in time.",
        );
      }

      return await fn((args) =>
        runCaptured(this.engine, ["exec", helper, ...args], {
          timeoutMs: 10_000,
          maxOutputBytes: 2_000,
        }),
      );
    } finally {
      await runCaptured(this.engine, ["rm", "-f", helper], {
        timeoutMs: 30_000,
        maxOutputBytes: 1_000,
      });
    }
  }

  /**
   * Blocks project containers from reaching anything not named in
   * `egressAllowlist` — see the class doc for why this ships as a mechanism,
   * opt-in, with no default list.
   *
   * Three rules, installed once each: two default-deny `REJECT`s scoped to
   * this driver's own network subnet, one per protocol (same reasoning as
   * `installMetadataBlock` — source-scoped, `REJECT` not `DROP`; split by
   * protocol for the same nf_tables reason `installMetadataBlock` needs
   * `-p tcp` — see `rejectRules` below), and an `ACCEPT` for anything in
   * `EGRESS_ALLOW_SET`, inserted *after* the deny rules so it lands above
   * them — iptables is first-match-wins. All three are permanent once
   * installed; only the set's *contents* change afterward, on entries with
   * their own expiry rather than a wholesale replace — see
   * `refreshEgressAllowlist` for why. This calls it once more before
   * returning so the set is never empty in the moment between "rules
   * installed" and "first refresh happens to run".
   *
   * DNS resolution itself is not expected to be blocked by the deny rules: a
   * container's queries go to Docker's own embedded resolver, which makes the
   * actual upstream query from the *host's* network namespace, not the
   * container's — so it never appears at `DOCKER-USER` with the container
   * subnet's source address in the first place. Documented Docker networking
   * behaviour, and consistent with what live testing on a real deployment
   * showed once these rules were active — `dns.resolve4` succeeded
   * throughout — but that is DNS resolution surviving *in practice*, not a
   * packet-level confirmation that a query never reaches this chain at all.
   */
  private ensureEgressAllowlist(): Promise<void> {
    if (!this.egressAllowlistReady) {
      this.egressAllowlistReady = this.installEgressAllowlist().catch((error: unknown) => {
        this.egressAllowlistReady = undefined;
        throw error;
      });
    }
    return this.egressAllowlistReady;
  }

  /**
   * Removes whatever `installEgressAllowlist` above installed, for a driver
   * that starts up with no allowlist configured. `installEgressAllowlist`'s
   * own doc calls its rules "permanent once installed," which holds only as
   * long as an allowlist, once turned on, is never turned off again — but
   * the allowlist is a Settings field an operator can flip off, and a driver
   * restarted with it removed would otherwise leave the previous run's
   * `DOCKER-USER` rules in place, rejecting everything they didn't cover,
   * indistinguishable from "still configured" to anyone who did not know to
   * check `iptables` directly.
   *
   * Best-effort and tolerant of nothing being there to remove — the common
   * case, an instance that has never enabled this, must not pay for a
   * teardown of rules that were never installed. `-D` and `ipset destroy`
   * both fail harmlessly against a rule or set that is already absent.
   */
  private teardownEgressAllowlist(): Promise<void> {
    if (!this.egressAllowlistTornDown) {
      this.egressAllowlistTornDown = this.removeEgressAllowlist().catch((error: unknown) => {
        this.egressAllowlistTornDown = undefined;
        throw error;
      });
    }
    return this.egressAllowlistTornDown;
  }

  private async removeEgressAllowlist(): Promise<void> {
    const subnet = await this.networkSubnet();
    const rejectRules = [
      ["-s", subnet, "-p", "tcp", "-j", "REJECT", "--reject-with", "tcp-reset"],
      ["-s", subnet, "-p", "udp", "-j", "REJECT", "--reject-with", "icmp-port-unreachable"],
    ];
    const acceptRule = [
      "-s",
      subnet,
      "-m",
      "set",
      "--match-set",
      EGRESS_ALLOW_SET,
      "dst",
      "-j",
      "ACCEPT",
    ];

    await this.withFirewallHelper(async (execIn) => {
      // The accept rule first — `ipset destroy` refuses a set a rule still
      // references, the same ordering `ensureEgressSet` already documents.
      await execIn(["iptables", "-D", "DOCKER-USER", ...acceptRule]);
      for (const rejectRule of rejectRules) {
        await execIn(["iptables", "-D", "DOCKER-USER", ...rejectRule]);
      }
      await execIn(["ipset", "destroy", EGRESS_ALLOW_SET]);
    });
  }

  /**
   * Creates `EGRESS_ALLOW_SET` with the timeout extension it needs, tolerant
   * of it already existing *without* one.
   *
   * `-exist` only reconciles a set created with the exact same options. An
   * earlier revision of this driver (before the timeout redesign above)
   * could leave a plain, non-timeout set behind on the host with a live
   * `ACCEPT` rule still pointing at it by name. Destroying and recreating
   * looks sufficient, but `ipset destroy` itself refuses a set an iptables
   * rule still references, so the accept rule has to be removed *first*.
   * Safe either way: for the instant
   * the set is absent, the accept rule that is about to be reinstalled by
   * the caller matches nothing, so traffic fails closed onto the `REJECT`
   * rules rather than open.
   */
  private async ensureEgressSet(
    execIn: (args: string[]) => Promise<ExecResult>,
    subnet: string,
  ): Promise<void> {
    const args = [
      "ipset",
      "create",
      EGRESS_ALLOW_SET,
      "hash:ip",
      "family",
      "inet",
      "timeout",
      String(EGRESS_ALLOW_TIMEOUT_SECONDS),
      "-exist",
    ];
    const create = await execIn(args);
    if (create.exitCode === 0) return;

    const staleAccept = [
      "-s",
      subnet,
      "-m",
      "set",
      "--match-set",
      EGRESS_ALLOW_SET,
      "dst",
      "-j",
      "ACCEPT",
    ];
    await execIn(["iptables", "-D", "DOCKER-USER", ...staleAccept]);
    await execIn(["ipset", "destroy", EGRESS_ALLOW_SET]);
    const retry = await execIn(args);
    if (retry.exitCode !== 0) {
      throw new ZelyqError(
        "runtime_unavailable",
        `Could not create the egress allowlist set: ${
          firstLine(retry.stderr) || firstLine(create.stderr) || "unknown error"
        }`,
      );
    }
  }

  private async installEgressAllowlist(): Promise<void> {
    const subnet = await this.networkSubnet();
    // Two rules, not one — the same nf_tables requirement that
    // installMetadataBlock hit: `--reject-with` needs a reject type that
    // actually applies to the packet's protocol, so one rule cannot cover
    // both. Left as a single TCP-only rule, this would silently not be a
    // default-deny at all for UDP (DNS-over-UDP does not reach this chain
    // regardless — see the class doc — but QUIC/HTTP3 and anything else over
    // UDP would sail straight through a rule that only matches TCP).
    const rejectRules = [
      ["-s", subnet, "-p", "tcp", "-j", "REJECT", "--reject-with", "tcp-reset"],
      ["-s", subnet, "-p", "udp", "-j", "REJECT", "--reject-with", "icmp-port-unreachable"],
    ];
    const acceptRule = [
      "-s",
      subnet,
      "-m",
      "set",
      "--match-set",
      EGRESS_ALLOW_SET,
      "dst",
      "-j",
      "ACCEPT",
    ];

    await this.withFirewallHelper(async (execIn) => {
      await this.ensureEgressSet(execIn, subnet);

      for (const rejectRule of rejectRules) {
        const rejectCheck = await execIn(["iptables", "-C", "DOCKER-USER", ...rejectRule]);
        if (rejectCheck.exitCode !== 0) {
          const insert = await execIn(["iptables", "-I", "DOCKER-USER", ...rejectRule]);
          if (insert.exitCode !== 0) {
            throw new ZelyqError(
              "runtime_unavailable",
              `Could not install the egress default-deny rule: ${firstLine(insert.stderr) || "unknown error"}`,
            );
          }
        }
      }

      // Checked and inserted after the deny rule exists, so `-I` places it
      // above — this must win the first-match race, not the catch-all.
      const acceptCheck = await execIn(["iptables", "-C", "DOCKER-USER", ...acceptRule]);
      if (acceptCheck.exitCode !== 0) {
        const insert = await execIn(["iptables", "-I", "DOCKER-USER", ...acceptRule]);
        if (insert.exitCode !== 0) {
          throw new ZelyqError(
            "runtime_unavailable",
            `Could not install the egress allow rule: ${firstLine(insert.stderr) || "unknown error"}`,
          );
        }
      }
    });

    await this.refreshEgressAllowlist();

    this.egressRefreshTimer = setInterval(() => {
      this.refreshEgressAllowlist().catch((error: unknown) => {
        this.egressAllowlistFailure = error instanceof Error ? error.message : String(error);
      });
    }, EGRESS_REFRESH_INTERVAL_MS);
    // Never keeps the process alive on its own — dispose() clears it, but a
    // process exiting for an unrelated reason should not be blocked by this.
    this.egressRefreshTimer.unref?.();
  }

  /**
   * Re-resolves every allowed hostname and re-adds whatever it gets back to
   * `EGRESS_ALLOW_SET`, refreshing each address's timeout rather than
   * replacing the set's contents wholesale.
   *
   * This used to swap in a freshly-resolved set each cycle, which is the
   * obviously-correct design right up until a hostname round-robins across
   * more addresses than one resolution happens to return — checked live, not
   * assumed: `github.com` answered three different addresses across three
   * independent queries a few minutes apart, and a wholesale-replace design
   * dropped whichever ones the *next* query didn't happen to repeat, which
   * is indistinguishable from a real address going bad. Letting `ipset`'s
   * own per-entry timeout do the aging instead means an address only drops
   * out after `EGRESS_ALLOW_TIMEOUT_SECONDS` of not being re-seen — three
   * refresh cycles of actual silence, not one cycle's incomplete sample.
   *
   * A hostname that fails to resolve this round is skipped, not fatal — a
   * transient DNS hiccup should not touch addresses this round did not ask
   * about, and it resolves again at the next interval regardless.
   */
  private async refreshEgressAllowlist(): Promise<void> {
    const subnet = await this.networkSubnet();
    await this.withFirewallHelper(async (execIn) => {
      await this.ensureEgressSet(execIn, subnet);

      for (const hostname of this.egressAllowlist) {
        // `dig +short A`, not `getent hosts`: checked live, not assumed —
        // this resolver hands `getent hosts` only the AAAA record for a
        // dual-stack name like registry.npmjs.org, silently dropping every
        // IPv4 address. `+short A` asks for the A records specifically and
        // gets them regardless of the resolver's own address preference.
        const resolved = await execIn(["dig", "+short", "A", hostname]);
        if (resolved.exitCode !== 0) continue;

        // IPv4 only: project containers have no IPv6 route on this network,
        // so an IPv6-only result is not reachable regardless, and
        // `hash:ip family inet` would reject it. The filter also drops a
        // CNAME line `+short` can print ahead of
        // the final A records for a name that is itself an alias.
        const ips = new Set(
          resolved.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((ip): ip is string => /^\d+\.\d+\.\d+\.\d+$/.test(ip)),
        );
        for (const ip of ips) {
          // Re-adding an entry that already exists, with `-exist`, refreshes
          // its timeout rather than erroring — that refresh is the whole
          // mechanism, not an incidental side effect.
          await execIn([
            "ipset",
            "add",
            EGRESS_ALLOW_SET,
            ip,
            "timeout",
            String(EGRESS_ALLOW_TIMEOUT_SECONDS),
            "-exist",
          ]);
        }
      }
    });
    this.egressAllowlistFailure = undefined;
  }

  private async networkSubnet(): Promise<string> {
    const result = await this.engineRun(
      ["network", "inspect", this.network, "--format", "{{(index .IPAM.Config 0).Subnet}}"],
      10_000,
    );
    const subnet = result.stdout.trim();
    if (result.exitCode !== 0 || !subnet) {
      throw new ZelyqError(
        "runtime_unavailable",
        `Could not read the "${this.network}" network's subnet: ${
          firstLine(result.stderr) || "unknown error"
        }`,
      );
    }
    return subnet;
  }

  /**
   * Every flag here is a decision, and the first one is the one that breaks.
   */
  private runArgs(name: string, root: string, publishPort?: number): string[] {
    return [
      "run",
      "--detach",
      "--name",
      name,
      ...(publishPort !== undefined
        ? ["--publish", `${this.previewBindHost}:${publishPort}:${publishPort}`]
        : []),
      // Not the default bridge. One project must not be able to reach
      // another's container — see the class doc and `ensureNetwork`.
      "--network",
      this.network,
      // Files the agent writes must be owned by the user Zelyq runs as. Without
      // this they come out root-owned on the host and Zelyq can no longer read
      // its own workspace — the single most common way this design fails.
      "--user",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      // The project, and nothing else on the host.
      "--volume",
      `${root}:/workspace`,
      "--workdir",
      "/workspace",
      // A runaway build cannot take the machine with it.
      "--memory",
      this.memory,
      "--cpus",
      this.cpus,
      "--pids-limit",
      String(this.pidsLimit),
      // No route from "runs a command" to "is root on the host".
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      // Nothing outside the project survives the container.
      "--read-only",
      "--tmpfs",
      "/tmp:exec,mode=1777,size=512m",
      // A read-only root filesystem still has to leave npm somewhere to write.
      // Both must be under the tmpfs; pointing them at the project would put
      // the package cache in the user's repository.
      "--env",
      "HOME=/tmp",
      "--env",
      "npm_config_cache=/tmp/.npm",
      this.image,
      // Something that stays up so `exec` has a container to enter. `sleep
      // infinity` is a bash builtin loop here, not a binary, so it survives an
      // image without coreutils.
      "/bin/bash",
      "-c",
      "while true; do sleep 3600; done",
    ];
  }

  private async destroyContainer(projectId: string): Promise<void> {
    this.started.delete(projectId);
    this.containerPort.delete(projectId);
    await this.engineRun(["rm", "-f", containerName(projectId)], 60_000);
  }

  private engineRun(args: string[], timeoutMs: number): Promise<ExecResult> {
    return runCaptured(this.engine, args, { timeoutMs, maxOutputBytes: 20_000 });
  }
}

/**
 * Project ids are `prj_` plus hex, so this is already safe for a container
 * name. Sanitised anyway: a name is passed to the engine as an argument, and a
 * rule that holds today because of a format decision elsewhere is not a rule.
 */
export function containerName(projectId: string): string {
  return `zelyq-${projectId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
}

/**
 * A working directory inside the container.
 *
 * The path is resolved against `/workspace`, and anything that climbs out of it
 * is refused rather than clamped. Clamping would silently run the command
 * somewhere the caller did not ask for, and the caller is a language model.
 */
export function containerCwd(cwd?: string): string {
  if (!cwd || cwd === "." || cwd === "./") return "/workspace";
  const parts: string[] = [];
  for (const segment of cwd.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) throw ZelyqError.badRequest(`Path escapes the project: ${cwd}`);
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  if (cwd.startsWith("/")) throw ZelyqError.badRequest(`Path must be relative: ${cwd}`);
  return parts.length ? `/workspace/${parts.join("/")}` : "/workspace";
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * Runs `fn` after every operation already queued under `key` in `map` has
 * settled, and queues `fn` itself for whatever comes next. A prior rejection
 * does not block the next operation — only its own caller sees it — which is
 * why the stored tail swallows errors while the returned promise does not.
 */
function chained<T>(
  map: Map<string, Promise<unknown>>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tail = (map.get(key) ?? Promise.resolve()).catch(() => undefined);
  const run = tail.then(fn);
  map.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}
