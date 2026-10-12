import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import {
  appAddress,
  type DeploymentDetail,
  type DeploymentStatus,
  type DeploymentSummary,
  type EnvironmentHttps,
  type EnvironmentInput,
  type EnvironmentSummary,
  type EnvironmentUpdate,
  environmentInputSchema,
  environmentUpdateSchema,
  newId,
  type PipelineActor,
  type User,
  vaultReferenceName,
  ZelyqError,
} from "@zelyq/core";
import type { DeployEnvironmentRow, DeploymentRow, RunnerRow, Store } from "@zelyq/db";
import type { AccessControl } from "./access.js";
import { Masker } from "./pipelines/mask.js";
import type { RunnerService } from "./pipelines/runners.js";
import { shellCommand } from "./pipelines/scripts.js";
import { SshSession } from "./pipelines/ssh.js";
import type { SecretBox } from "./secrets.js";
import type { VaultService } from "./vault.js";

/**
 * Deploy (docs/deploy-plan.md): an app runs as a Docker container on an
 * environment's machine — one of the team's SSH runners — built there from the
 * app's own Dockerfile. A deploy swaps the container and checks the app
 * answers; if it does not, the previous container comes back by itself.
 */

/** Images of an app kept on a machine, for roll back. */
const KEEP_IMAGES = 3;
const DEFAULT_HEALTH_TIMEOUT_S = 60;
/** The proxy in front of apps on a machine with a domain. Pinned: a new Caddy is a deliberate change. */
const PROXY_IMAGE = "caddy:2.8.4-alpine";
const PROXY = "zelyq-proxy";
const NETWORK = "zelyq";

type StoredVariable = { vault: string } | { value: string };

export interface DeployRequest {
  teamId: string;
  environment: DeployEnvironmentRow;
  app: string;
  port: number;
  hostPort: number;
  healthPath: string;
  healthTimeoutS: number;
  url: string | null;
  /** The app's own name on an environment with a domain, instead of <app>.<domain>. */
  domain: string | null;
  runId: string | null;
  triggeredBy: string | null;
  /** The app's files as a gzipped tar; null to reuse an image already on the machine. */
  source: Readable | null;
  /** For a roll back: the deploy whose image to start again. */
  reuse: DeploymentRow | null;
  /** Every line of what happened, masked. */
  onLine(stream: "out" | "err" | "system", text: string): void;
  /** Called as soon as the deploy has its number, before the work starts. */
  onCreated?(deployment: DeploymentRow): void;
  signal?: AbortSignal;
}

function sq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export class DeployService {
  /** One deploy at a time per environment and app. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly box: SecretBox,
    private readonly vault: VaultService,
    private readonly runners: RunnerService,
  ) {}

  /** A deploy cut short by a restart is not left "deploying" for ever. */
  async recover(): Promise<void> {
    for (const row of await this.store.deploy.deployments.listByStatus("deploying")) {
      await this.store.deploy.deployments.update(row.id, {
        status: "failed",
        error: "Zelyq restarted during this deploy. Check the app, then deploy again or roll back.",
        finishedAt: new Date().toISOString(),
      });
    }
  }

  // ------------------------------------------------------------ environments

  async list(user: User, teamId: string): Promise<EnvironmentSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const rows = await this.store.deploy.environments.listForTeam(teamId);
    const live = await this.store.deploy.deployments.live(rows.map((row) => row.id));
    return Promise.all(
      rows.map((row) =>
        this.present(
          row,
          live.filter((d) => d.environmentId === row.id),
        ),
      ),
    );
  }

  async create(user: User, teamId: string, raw: EnvironmentInput): Promise<EnvironmentSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const input = environmentInputSchema.parse(raw);
    if (await this.store.deploy.environments.findByName(teamId, input.name)) {
      throw new ZelyqError("conflict", `There is already an environment called ${input.name}.`);
    }
    await this.checkRunner(teamId, input.runnerId);
    await this.checkProxyPorts(teamId, null, {
      runnerId: input.runnerId,
      domain: input.domain ?? null,
      httpPort: input.httpPort ?? 80,
      httpsPort: input.httpsPort ?? 443,
    });
    const now = new Date().toISOString();
    const row = await this.store.deploy.environments.create({
      id: newId("deployEnvironment"),
      teamId,
      name: input.name,
      runnerId: input.runnerId,
      address: input.address ?? null,
      domain: input.domain ?? null,
      https: input.https ?? "auto",
      httpPort: input.httpPort ?? 80,
      httpsPort: input.httpsPort ?? 443,
      protected: input.protected ?? false,
      frozen: false,
      frozenReason: null,
      variables: JSON.stringify(await this.storeVariables(user, teamId, input.variables ?? {}, {})),
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await this.access.recordChange(user, {
      teamId,
      action: "environment.created",
      detail: { label: row.name },
    });
    return this.present(row, []);
  }

  async update(
    user: User,
    teamId: string,
    environmentId: string,
    raw: EnvironmentUpdate,
  ): Promise<EnvironmentSummary> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const input = environmentUpdateSchema.parse(raw);
    const row = await this.find(teamId, environmentId);
    if (
      input.name &&
      input.name !== row.name &&
      (await this.store.deploy.environments.findByName(teamId, input.name))
    ) {
      throw new ZelyqError("conflict", `There is already an environment called ${input.name}.`);
    }
    if (input.runnerId) await this.checkRunner(teamId, input.runnerId);
    await this.checkProxyPorts(teamId, row.id, {
      runnerId: input.runnerId ?? row.runnerId,
      domain: input.domain === undefined ? row.domain : input.domain,
      httpPort: input.httpPort ?? row.httpPort,
      httpsPort: input.httpsPort ?? row.httpsPort,
    });
    const patch: Partial<DeployEnvironmentRow> = {
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.runnerId !== undefined) patch.runnerId = input.runnerId;
    if (input.address !== undefined) patch.address = input.address ?? null;
    if (input.domain !== undefined) patch.domain = input.domain ?? null;
    if (input.https !== undefined) patch.https = input.https;
    if (input.httpPort !== undefined) patch.httpPort = input.httpPort;
    if (input.httpsPort !== undefined) patch.httpsPort = input.httpsPort;
    if (input.protected !== undefined) patch.protected = input.protected;
    if (input.frozen !== undefined) {
      patch.frozen = input.frozen;
      patch.frozenReason = input.frozen ? (input.frozenReason ?? null) : null;
    }
    if (input.variables !== undefined) {
      patch.variables = JSON.stringify(
        await this.storeVariables(user, teamId, input.variables, JSON.parse(row.variables)),
      );
    }
    const updated = (await this.store.deploy.environments.update(
      row.id,
      patch,
    )) as DeployEnvironmentRow;
    await this.access.recordChange(user, {
      teamId,
      action: "environment.updated",
      detail: { label: updated.name, fields: Object.keys(input) },
    });
    const live = await this.store.deploy.deployments.live([row.id]);
    return this.present(updated, live);
  }

  async remove(user: User, teamId: string, environmentId: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.find(teamId, environmentId);
    if ((await this.store.deploy.deployments.live([row.id])).length > 0) {
      throw new ZelyqError(
        "conflict",
        `Apps are still deployed to ${row.name}. Their containers keep running on the machine; remove them there first, then the environment.`,
      );
    }
    await this.store.deploy.environments.remove(row.id);
    await this.access.recordChange(user, {
      teamId,
      action: "environment.deleted",
      detail: { label: row.name },
    });
  }

  async history(
    user: User,
    teamId: string,
    environmentId: string,
    app: string | null,
  ): Promise<DeploymentSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const row = await this.find(teamId, environmentId);
    return this.presentDeployments(await this.store.deploy.deployments.listFor(row.id, app, 100));
  }

  /** One deploy, with its log. */
  async detail(user: User, teamId: string, deploymentId: string): Promise<DeploymentDetail> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const row = await this.store.deploy.deployments.findById(deploymentId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Deployment", deploymentId);
    const [summary] = await this.presentDeployments([row]);
    const log = row.log
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as { s: "out" | "err" | "system"; t: string };
          return [{ stream: parsed.s, text: parsed.t }];
        } catch {
          return [];
        }
      });
    return { ...(summary as DeploymentSummary), log };
  }

  // -------------------------------------------------------------- deploying

  /** The environment a deploy step names, or why it cannot deploy there now. */
  async environmentFor(
    teamId: string,
    name: string,
  ): Promise<DeployEnvironmentRow | { error: string }> {
    const row = await this.store.deploy.environments.findByName(teamId, name);
    if (!row)
      return { error: `There is no environment called ${name}. An admin adds it in Deployments.` };
    if (row.frozen) {
      return {
        error: `${row.name} is frozen${row.frozenReason ? `: ${row.frozenReason}` : ""}. No deploys until an admin unfreezes it.`,
      };
    }
    return row;
  }

  /**
   * Checks again whether people can open a live app behind the proxy. The
   * proxy is asked to try for missing certificates right away, instead of
   * waiting for its next attempt (minutes after a failed one).
   */
  async checkAgain(user: User, teamId: string, deploymentId: string): Promise<DeploymentSummary> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const row = await this.store.deploy.deployments.findById(deploymentId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Deployment", deploymentId);
    const environment = await this.find(teamId, row.environmentId);
    if (row.status !== "live" || row.hostPort !== 0 || !row.url || !environment.domain) {
      throw ZelyqError.badRequest("Only a live app behind an environment's domain is checked.");
    }
    const runner = environment.runnerId
      ? await this.store.pipelines.runners.findById(environment.runnerId)
      : null;
    if (!runner) throw ZelyqError.badRequest(`${environment.name} has no machine.`);
    const session = await SshSession.open(await this.runners.target(runner));
    try {
      await session.exec(shellCommand("sh"), {
        stdin: `docker exec ${PROXY} caddy reload --force --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true\n`,
      });
    } finally {
      session.close();
    }
    const host = new URL(row.url).hostname;
    const problem =
      (await dnsHint(host, environment)) ??
      (await reachProblem(
        host,
        environment.address ?? runner.host,
        proxiedOf(environment),
        runner.name,
      ));
    const updated = (await this.store.deploy.deployments.update(row.id, {
      error: problem,
    })) as DeploymentRow;
    const [summary] = await this.presentDeployments([updated]);
    return summary as DeploymentSummary;
  }

  /** Rolls an app back to an earlier deploy whose image is still on the machine. */
  async rollBack(user: User, teamId: string, deploymentId: string): Promise<DeploymentSummary> {
    const target = await this.store.deploy.deployments.findById(deploymentId);
    if (!target || target.teamId !== teamId) throw ZelyqError.notFound("Deployment", deploymentId);
    const environment = await this.find(teamId, target.environmentId);
    await this.access.requireTeamRole(user, teamId, environment.protected ? "admin" : "editor");
    if (environment.frozen) {
      throw new ZelyqError("conflict", `${environment.name} is frozen. Unfreeze it to roll back.`);
    }
    if (!(await this.keptImages(environment.id, target.app)).has(target.image)) {
      throw ZelyqError.badRequest(
        `#${target.number}'s image is no longer on the machine; only the last ${KEEP_IMAGES} are kept.`,
      );
    }
    // Starts now and goes on in the background; the page follows its log.
    let created: (row: DeploymentRow) => void = () => undefined;
    const started = new Promise<DeploymentRow>((resolve) => {
      created = resolve;
    });
    const done = this.deploy({
      teamId,
      environment,
      app: target.app,
      port: target.port,
      hostPort: target.hostPort,
      healthPath: target.healthPath,
      healthTimeoutS: DEFAULT_HEALTH_TIMEOUT_S,
      url: target.url,
      domain: null,
      runId: null,
      triggeredBy: user.id,
      source: null,
      reuse: target,
      onLine: () => undefined,
      onCreated: (row) => created(row),
    });
    void done
      .then((result) =>
        this.access.recordChange(user, {
          teamId,
          action: "deploy.rolled_back",
          detail: {
            label: `${target.app} on ${environment.name}`,
            to: target.number,
            ok: result.ok,
          },
        }),
      )
      .catch(() => undefined);
    const row = await Promise.race([started, done.then((result) => result.deployment)]);
    const [summary] = await this.presentDeployments([row]);
    return summary as DeploymentSummary;
  }

  /**
   * Builds (or reuses) the image, swaps the container, checks the app answers,
   * and puts the previous container back if it does not.
   */
  async deploy(request: DeployRequest): Promise<{ ok: boolean; deployment: DeploymentRow }> {
    const key = `${request.environment.id}/${request.app}`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.deployNow(request));
    this.locks.set(
      key,
      run.catch(() => undefined),
    );
    return run;
  }

  private async deployNow(
    request: DeployRequest,
  ): Promise<{ ok: boolean; deployment: DeploymentRow }> {
    const { environment, app } = request;
    const runner = environment.runnerId
      ? await this.store.pipelines.runners.findById(environment.runnerId)
      : null;
    const reused = request.reuse;
    const proxied = environment.domain !== null;
    // Behind the proxy: the app's own name, the one it had (a roll back), or <app>.<domain>.
    const host = proxied
      ? (request.domain ??
        (reused && reused.hostPort === 0 && reused.url ? new URL(reused.url).hostname : null) ??
        `${app}.${environment.domain}`)
      : null;
    const deployment = await this.store.deploy.deployments.create({
      id: newId("deployment"),
      teamId: request.teamId,
      environmentId: environment.id,
      app,
      status: "deploying",
      kind: reused ? "rollback" : "deploy",
      image: reused?.image ?? "",
      rolledBackTo: reused?.number ?? null,
      runId: request.runId,
      triggeredBy: request.triggeredBy,
      url: host
        ? appAddress(proxiedOf(environment), app, host)
        : (request.url ??
          (environment.address ? `http://${environment.address}:${request.hostPort}` : null)),
      port: request.port,
      // 0: not published on the machine; reached through the proxy.
      hostPort: proxied ? 0 : request.hostPort,
      healthPath: request.healthPath,
      error: null,
      log: "",
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    const image = reused?.image ?? `zelyq-${app}-${environment.name}:${deployment.number}`;
    await this.store.deploy.deployments.update(deployment.id, { image });
    // Every line also goes into the deploy's own log, in small batches.
    const writer = new DeployLogWriter(this.store, deployment.id);
    const shown = request.onLine;
    const logged: DeployRequest = {
      ...request,
      onLine: (stream, text) => {
        shown(stream, text);
        writer.add(stream, text);
      },
    };
    request.onCreated?.({ ...deployment, image });
    try {
      return await this.deployWork(logged, deployment, image, runner, reused, host);
    } finally {
      await writer.close();
    }
  }

  private async deployWork(
    request: DeployRequest,
    deployment: DeploymentRow,
    image: string,
    runner: RunnerRow | null,
    reused: DeploymentRow | null,
    host: string | null,
  ): Promise<{ ok: boolean; deployment: DeploymentRow }> {
    const { environment, app } = request;

    const fail = async (error: string) => {
      request.onLine("system", error);
      const row = await this.store.deploy.deployments.update(deployment.id, {
        status: "failed",
        error,
        finishedAt: new Date().toISOString(),
      });
      return { ok: false, deployment: row ?? deployment };
    };
    if (!runner)
      return fail(`${environment.name} has no machine. An admin chooses one in Deployments.`);
    if (!runner.hostKey) return fail(`${runner.name}'s fingerprint has not been confirmed.`);
    if (runner.os === "windows") return fail("Deploys need a Linux or macOS machine with Docker.");

    // The app's variables for this environment, resolved now; masked wherever they appear.
    const variables = await this.resolveVariables(environment);
    if ("error" in variables) return fail(variables.error);
    const masker = new Masker(Object.values(variables.values));
    const out = masker.fork();
    const err = masker.fork();
    const emit = (stream: "out" | "err", chunk: Buffer) => {
      for (const line of (stream === "out" ? out : err).push(chunk)) request.onLine(stream, line);
    };

    let session: SshSession;
    try {
      session = await SshSession.open(await this.runners.target(runner));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    const sh = (script: string) =>
      session.exec(shellCommand("sh"), {
        stdin: script,
        onStdout: (chunk) => emit("out", chunk),
        onStderr: (chunk) => emit("err", chunk),
        signal: request.signal,
      });
    const name = `zelyq-${app}-${environment.name}`;
    const folder = `"$HOME/zelyq/deploy/${environment.name}/${app}/${deployment.number}"`;

    try {
      const docker = await sh(
        'command -v docker >/dev/null 2>&1 || { echo "Docker is not installed on this machine." >&2; exit 1; }\n' +
          'docker info >/dev/null 2>&1 || { echo "This user cannot use Docker: add it to the docker group (run the machine setup command again)." >&2; exit 1; }\n',
      );
      if (docker.code !== 0) return fail(`Docker is not usable on ${runner.name}.`);

      if (!reused) {
        if (!request.source) return fail("Nothing to deploy.");
        request.onLine("system", `Sending the app to ${runner.name}.`);
        const sent = await session.exec(
          `sh -c ${sq(`mkdir -p ${folder} && tar -xzf - -C ${folder}`)}`,
          {
            stdin: request.source,
            onStderr: (chunk) => emit("err", chunk),
            signal: request.signal,
          },
        );
        if (sent.code !== 0) return fail("Could not copy the app onto the machine.");
        request.onLine("system", `Building ${image}.`);
        const built = await sh(
          [
            `cd ${folder}`,
            '[ -f Dockerfile ] || { echo "There is no Dockerfile in the app. Ask the agent to add one (\\"add a Dockerfile that serves the app\\")." >&2; exit 1; }',
            `docker build -t ${sq(image)} --label zelyq.app=${sq(app)} .`,
          ].join("\n"),
        );
        // The source is only needed to build.
        await sh(`rm -rf ${folder}`);
        if (built.code !== 0) return fail("The image could not be built.");
      } else {
        request.onLine("system", `Rolling back to #${reused.number} (${image}).`);
      }

      if (host) {
        return await this.switchOver(request, deployment, image, host, sh, variables.values, fail);
      }

      // Swap: the running container steps aside, the new one starts with the variables.
      request.onLine("system", `Starting ${name} on port ${request.hostPort}.`);
      const env = Object.entries(variables.values);
      const swapped = await sh(
        [
          "set -e",
          `n=${sq(name)}`,
          'docker rm -f "$n-previous" >/dev/null 2>&1 || true',
          'if docker container inspect "$n" >/dev/null 2>&1; then docker rename "$n" "$n-previous"; docker stop "$n-previous" >/dev/null; fi',
          ...env.map(([k, v]) => `export ${k}=${sq(v)}`),
          [
            'if ! out=$(docker run -d --name "$n" --restart unless-stopped',
            `-p ${request.hostPort}:${request.port}`,
            ...env.map(([k]) => `-e ${k}`),
            `--label zelyq.deployment=${sq(deployment.id)}`,
            sq(image),
            "2>&1); then",
          ].join(" "),
          '  echo "$out" >&2',
          // Exit 5: something else already uses the port on the machine.
          '  case "$out" in *"port is already allocated"*|*"address already in use"*) exit 5;; esac',
          "  exit 1",
          "fi",
        ].join("\n"),
      );
      const healthy =
        swapped.code === 0 &&
        (
          await sh(
            this.healthScript(name, request.hostPort, request.healthPath, request.healthTimeoutS),
          )
        ).code === 0;

      if (!healthy) {
        if (swapped.code !== 5) {
          request.onLine("system", "The new version did not come up. Its last lines:");
          await sh(`docker logs --tail 50 ${sq(name)} 2>&1 || true`);
        }
        // Exit 3: there was no earlier version to put back.
        const restored = await sh(
          [
            `n=${sq(name)}`,
            'docker rm -f "$n" >/dev/null 2>&1 || true',
            'if docker container inspect "$n-previous" >/dev/null 2>&1; then docker rename "$n-previous" "$n" && docker start "$n" >/dev/null; else exit 3; fi',
          ].join("\n"),
        );
        const why =
          swapped.code === 5
            ? `Port ${request.hostPort} on ${runner.name} is already used by something else (another container or program). Choose another host-port, or stop what uses it.`
            : "The new version did not come up.";
        return fail(
          restored.code === 0
            ? `${why} Rolled back automatically: the previous version is running again.`
            : restored.code === 3
              ? `${why} Nothing was running here before it.`
              : `${why} The previous version could not be started again; check the machine.`,
        );
      }

      await sh(`docker rm -f ${sq(`${name}-previous`)} >/dev/null 2>&1 || true`);
      const row = (await this.store.deploy.deployments.update(deployment.id, {
        status: "live",
        finishedAt: new Date().toISOString(),
      })) as DeploymentRow;
      await this.store.deploy.deployments.replaceOthers(environment.id, app, deployment.id);
      await this.pruneImages(environment.id, app, sh);
      request.onLine(
        "system",
        `${app} #${deployment.number} is live on ${environment.name}${row.url ? `: ${row.url}` : "."}`,
      );
      return { ok: true, deployment: row };
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    } finally {
      session.close();
    }
  }

  /**
   * Behind the proxy, without downtime: the new version starts beside the
   * running one, is checked from the proxy, and only then does the proxy send
   * people to it. If it does not come up, nobody notices: the running version
   * was never touched.
   */
  private async switchOver(
    request: DeployRequest,
    deployment: DeploymentRow,
    image: string,
    host: string,
    sh: (script: string) => Promise<{ code: number | null }>,
    values: Record<string, string>,
    fail: (error: string) => Promise<{ ok: boolean; deployment: DeploymentRow }>,
  ): Promise<{ ok: boolean; deployment: DeploymentRow }> {
    const { environment, app } = request;
    const settings = proxiedOf(environment);
    const machine = environment.runnerId
      ? await this.store.pipelines.runners.findById(environment.runnerId)
      : null;
    const runnerName = machine?.name ?? "the machine";

    const proxy = await sh(proxyScript(settings));
    if (proxy.code === 5) {
      return fail(
        `Ports ${settings.httpPort} and ${settings.httpsPort} on ${runnerName} are used by something else (another web server, such as nginx). Free them, or give ${environment.name} other proxy ports in Deployments.`,
      );
    }
    if (proxy.code !== 0) return fail(`The proxy could not be started on ${runnerName}.`);

    const container = `zelyq-${app}-${environment.name}-${deployment.number}`;
    const site = `${environment.name}--${app}.caddy`;
    const env = Object.entries(values);
    request.onLine("system", `Starting ${container} beside the running version.`);
    const started = await sh(
      [
        "set -e",
        `c=${sq(container)}`,
        'docker rm -f "$c" >/dev/null 2>&1 || true',
        ...env.map(([k, v]) => `export ${k}=${sq(v)}`),
        [
          'docker run -d --name "$c" --restart unless-stopped',
          `--network ${NETWORK}`,
          ...env.map(([k]) => `-e ${k}`),
          `--label zelyq.app=${sq(app)}`,
          `--label zelyq.environment=${sq(environment.name)}`,
          `--label zelyq.deployment=${sq(deployment.id)}`,
          sq(image),
          ">/dev/null",
        ].join(" "),
      ].join("\n"),
    );
    const healthy =
      started.code === 0 &&
      (
        await sh(
          proxiedHealthScript(container, request.port, request.healthPath, request.healthTimeoutS),
        )
      ).code === 0;
    const removeNew = () => sh(`docker rm -f ${sq(container)} >/dev/null 2>&1 || true`);
    if (!healthy) {
      request.onLine("system", "The new version did not come up. Its last lines:");
      await sh(`docker logs --tail 50 ${sq(container)} 2>&1 || true`);
      await removeNew();
      const before = await this.store.deploy.deployments.live([environment.id]);
      return fail(
        before.some((row) => row.app === app)
          ? "The new version did not come up. The running version was not touched: people kept using it the whole time."
          : "The new version did not come up. Nothing was running here before it.",
      );
    }

    // People go to the new version: the proxy reloads without dropping a connection.
    request.onLine("system", `Sending ${host} to the new version.`);
    const switched = await sh(siteScript(site, host, settings.https, container, request.port));
    if (switched.code === 7) {
      await removeNew();
      return fail(
        `${host} is already used by another app on ${runnerName}. Give this one its own domain: in the deploy step.`,
      );
    }
    if (switched.code !== 0) {
      await removeNew();
      return fail("The proxy did not accept the new address. The running version was not touched.");
    }

    // The versions before it, after a moment for requests still on their way.
    await sh(
      [
        "sleep 2",
        `docker ps -aq --filter label=zelyq.app=${sq(app)} --filter label=zelyq.environment=${sq(environment.name)} | while read -r id; do`,
        `  [ "$(docker inspect -f '{{.Name}}' "$id")" = ${sq(`/${container}`)} ] || docker rm -f "$id" >/dev/null 2>&1 || true`,
        "done",
        // Started before the proxy, on a port of its own.
        `docker rm -f ${sq(`zelyq-${app}-${environment.name}`)} ${sq(`zelyq-${app}-${environment.name}-previous`)} >/dev/null 2>&1 || true`,
      ].join("\n"),
    );
    await this.store.deploy.deployments.replaceOthers(environment.id, app, deployment.id);
    await this.pruneImages(environment.id, app, sh);

    // Running is not the same as reachable: open the address the way a visitor
    // would, and say plainly what stops it (DNS, a firewall, the certificate).
    request.onLine("system", `Opening ${deployment.url} from outside the machine.`);
    const address = environment.address ?? machine?.host ?? null;
    const problem =
      (await dnsHint(host, environment)) ??
      (address ? await reachProblem(host, address, settings, runnerName) : null);
    const row = (await this.store.deploy.deployments.update(deployment.id, {
      status: "live",
      error: problem,
      finishedAt: new Date().toISOString(),
    })) as DeploymentRow;
    request.onLine(
      "system",
      problem
        ? `${app} #${deployment.number} is running on ${runnerName}, but ${row.url} cannot be opened yet. ${problem}`
        : `${app} #${deployment.number} is live on ${environment.name}: ${row.url}`,
    );
    return { ok: true, deployment: row };
  }

  /** Environments on one machine share its proxy, so they listen on the same ports. */
  private async checkProxyPorts(
    teamId: string,
    self: string | null,
    wanted: { runnerId: string | null; domain: string | null; httpPort: number; httpsPort: number },
  ): Promise<void> {
    if (!wanted.domain || !wanted.runnerId) return;
    if (wanted.httpPort === wanted.httpsPort) {
      throw ZelyqError.badRequest("The proxy's HTTP and HTTPS ports must differ.");
    }
    for (const other of await this.store.deploy.environments.listForTeam(teamId)) {
      if (other.id === self || !other.domain || other.runnerId !== wanted.runnerId) continue;
      if (other.httpPort !== wanted.httpPort || other.httpsPort !== wanted.httpsPort) {
        throw ZelyqError.badRequest(
          `${other.name} uses the same machine with proxy ports ${other.httpPort} and ${other.httpsPort}; one proxy serves both, so use the same ports.`,
        );
      }
    }
  }

  /** Waits until the app answers (2xx or 3xx) and its container keeps running. */
  private healthScript(name: string, hostPort: number, path: string, timeoutS: number): string {
    const url = `http://127.0.0.1:${hostPort}${path}`;
    return [
      `n=${sq(name)}`,
      `end=$(( $(date +%s) + ${timeoutS} ))`,
      'while [ "$(date +%s)" -lt "$end" ]; do',
      '  [ "$(docker inspect -f "{{.State.Running}}" "$n" 2>/dev/null)" = true ] || { echo "The container stopped." >&2; exit 2; }',
      "  if command -v curl >/dev/null 2>&1; then",
      `    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 ${sq(url)} || true)`,
      "  elif command -v wget >/dev/null 2>&1; then",
      `    code=$(wget -q -O /dev/null -S --timeout=5 ${sq(url)} 2>&1 | awk '/HTTP\\//{c=$2} END{print c}')`,
      "  else",
      '    sleep 10; [ "$(docker inspect -f "{{.State.Running}}" "$n")" = true ] && { echo "Running (no curl or wget to check the address)."; exit 0; }; exit 2',
      "  fi",
      `  case "$code" in 2*|3*) echo "Healthy: ${url} answered $code."; exit 0;; esac`,
      "  sleep 2",
      "done",
      `echo "No answer from ${url} within ${timeoutS}s." >&2`,
      "exit 1",
      "",
    ].join("\n");
  }

  /** Keeps the images of the last few good deploys; removes older ones. */
  private async pruneImages(
    environmentId: string,
    app: string,
    sh: (script: string) => Promise<{ code: number | null }>,
  ): Promise<void> {
    const keep = await this.keptImages(environmentId, app);
    const rows = await this.store.deploy.deployments.listFor(environmentId, app, 200);
    const old = [...new Set(rows.map((row) => row.image))].filter(
      (image) => image && !keep.has(image),
    );
    if (old.length > 0) await sh(`docker rmi ${old.map(sq).join(" ")} >/dev/null 2>&1 || true`);
  }

  /** Images of the newest good deploys (live or replaced), which are kept for roll back. */
  private async keptImages(environmentId: string, app: string): Promise<Set<string>> {
    const rows = await this.store.deploy.deployments.listFor(environmentId, app, 200);
    const kept = new Set<string>();
    for (const row of rows) {
      if (row.kind !== "deploy" || (row.status !== "live" && row.status !== "replaced")) continue;
      kept.add(row.image);
      if (kept.size >= KEEP_IMAGES) break;
    }
    const live = rows.find((row) => row.status === "live");
    if (live) kept.add(live.image);
    return kept;
  }

  // -------------------------------------------------------------- variables

  /** Typed values are encrypted; Vault references are checked as the person saving them. */
  private async storeVariables(
    user: User,
    teamId: string,
    input: Record<string, string>,
    existing: Record<string, StoredVariable>,
  ): Promise<Record<string, StoredVariable>> {
    const stored: Record<string, StoredVariable> = {};
    for (const [name, value] of Object.entries(input)) {
      const vault = vaultReferenceName(value);
      if (vault) {
        await this.vault.requireUse(user, { kind: "team", teamId }, vault);
        stored[name] = { vault };
      } else if (value === "" && existing[name]) {
        // An empty value in an update keeps what is there (values are never sent back).
        stored[name] = existing[name] as StoredVariable;
      } else {
        stored[name] = { value: this.box.encrypt(value) };
      }
    }
    return stored;
  }

  private async resolveVariables(
    environment: DeployEnvironmentRow,
  ): Promise<{ values: Record<string, string> } | { error: string }> {
    const stored = JSON.parse(environment.variables) as Record<string, StoredVariable>;
    const names = Object.values(stored).flatMap((entry) => ("vault" in entry ? [entry.vault] : []));
    const fromVault = names.length
      ? await this.vault.resolve(environment.teamId, names)
      : new Map<string, string>();
    const values: Record<string, string> = {};
    for (const [name, entry] of Object.entries(stored)) {
      if ("vault" in entry) {
        const value = fromVault.get(entry.vault);
        if (value === undefined)
          return { error: `${entry.vault} is not in the team's Vault (needed by ${name}).` };
        values[name] = value;
      } else {
        values[name] = this.box.decrypt(entry.value) ?? "";
      }
    }
    return { values };
  }

  // ---------------------------------------------------------------- helpers

  private async find(teamId: string, environmentId: string): Promise<DeployEnvironmentRow> {
    const row = await this.store.deploy.environments.findById(environmentId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Environment", environmentId);
    return row;
  }

  private async checkRunner(teamId: string, runnerId: string): Promise<RunnerRow> {
    const runner = await this.store.pipelines.runners.findById(runnerId);
    if (!runner || runner.teamId !== teamId)
      throw ZelyqError.badRequest("Choose one of the team's runners.");
    if (runner.os === "windows")
      throw ZelyqError.badRequest("Deploys need a Linux or macOS machine with Docker.");
    return runner;
  }

  private async present(
    row: DeployEnvironmentRow,
    live: DeploymentRow[],
  ): Promise<EnvironmentSummary> {
    const runner = row.runnerId ? await this.store.pipelines.runners.findById(row.runnerId) : null;
    const stored = JSON.parse(row.variables) as Record<string, StoredVariable>;
    return {
      id: row.id,
      name: row.name,
      runner: runner ? { id: runner.id, name: runner.name, host: runner.host } : null,
      address: row.address,
      domain: row.domain,
      https: httpsOf(row.https),
      httpPort: row.httpPort,
      httpsPort: row.httpsPort,
      protected: row.protected,
      frozen: row.frozen,
      frozenReason: row.frozenReason,
      variables: Object.entries(stored).map(([name, entry]) => ({
        name,
        fromVault: "vault" in entry,
      })),
      live: await this.presentDeployments(live),
      updatedAt: row.updatedAt,
    };
  }

  private async presentDeployments(rows: DeploymentRow[]): Promise<DeploymentSummary[]> {
    const actors = new Map<string, PipelineActor>();
    const runs = new Map<string, DeploymentSummary["run"]>();
    const kept = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.triggeredBy && !actors.has(row.triggeredBy)) {
        const user = await this.store.users.findById(row.triggeredBy);
        if (user) actors.set(user.id, { id: user.id, name: user.name });
      }
      if (row.runId && !runs.has(row.runId)) {
        const run = await this.store.pipelines.runs.findById(row.runId);
        runs.set(
          row.runId,
          run ? { id: run.id, pipelineId: run.pipelineId, number: run.number, ref: run.ref } : null,
        );
      }
      const keyOf = `${row.environmentId}/${row.app}`;
      if (!kept.has(keyOf)) kept.set(keyOf, await this.keptImages(row.environmentId, row.app));
    }
    return rows.map((row) => ({
      id: row.id,
      environmentId: row.environmentId,
      app: row.app,
      number: row.number,
      status: row.status as DeploymentStatus,
      kind: row.kind === "rollback" ? "rollback" : "deploy",
      url: row.url,
      run: row.runId ? (runs.get(row.runId) ?? null) : null,
      rolledBackTo: row.rolledBackTo,
      by: row.triggeredBy ? (actors.get(row.triggeredBy) ?? null) : null,
      error: row.error,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      canRollBackTo:
        row.status === "replaced" &&
        kept.get(`${row.environmentId}/${row.app}`)?.has(row.image) === true,
    }));
  }
}

/** A deploy's log, written in small batches (at most 256 KB). */
class DeployLogWriter {
  private pending = "";
  private size = 0;
  private writing: Promise<void> = Promise.resolve();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly store: Store,
    private readonly id: string,
  ) {
    this.timer = setInterval(() => void this.flush(), 500);
  }

  add(stream: "out" | "err" | "system", text: string): void {
    const line = `${JSON.stringify({ s: stream, t: text })}\n`;
    if (this.size + line.length > 256 * 1024 && stream !== "system") return;
    this.size += line.length;
    this.pending += line;
  }

  flush(): Promise<void> {
    const text = this.pending;
    this.pending = "";
    this.writing = this.writing.then(() =>
      text ? this.store.deploy.deployments.appendLog(this.id, text) : undefined,
    );
    return this.writing;
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}

function httpsOf(value: string): EnvironmentHttps {
  return value === "internal" || value === "off" ? value : "auto";
}

function proxiedOf(environment: DeployEnvironmentRow) {
  return {
    domain: environment.domain,
    https: httpsOf(environment.https),
    httpPort: environment.httpPort,
    httpsPort: environment.httpsPort,
  };
}

/**
 * The machine's proxy: one Caddy container on the `zelyq` network, listening
 * on the environment's ports, with a file per app in its own volume
 * (/etc/caddy/sites). Nothing is read from the machine's folders, so it works
 * the same wherever Docker runs. Started once, and again only when its ports
 * change. Exit 5: a port is taken.
 */
export function proxyScript(settings: { httpPort: number; httpsPort: number }): string {
  const label = `${PROXY_IMAGE} ${settings.httpPort} ${settings.httpsPort}`;
  const caddyfile = `{\n\thttp_port ${settings.httpPort}\n\thttps_port ${settings.httpsPort}\n}\nimport sites/*.caddy`;
  return [
    "set -e",
    `docker network inspect ${NETWORK} >/dev/null 2>&1 || docker network create ${NETWORK} >/dev/null`,
    `want=${sq(label)}`,
    `have=$(docker inspect -f '{{index .Config.Labels "zelyq.proxy"}}' ${PROXY} 2>/dev/null || true)`,
    'if [ "$have" != "$want" ]; then',
    `  docker rm -f ${PROXY} >/dev/null 2>&1 || true`,
    `  export ZELYQ_CADDYFILE=${sq(caddyfile)}`,
    [
      `  if ! out=$(docker run -d --name ${PROXY} --restart unless-stopped --network ${NETWORK}`,
      `-p ${settings.httpPort}:${settings.httpPort} -p ${settings.httpsPort}:${settings.httpsPort}`,
      '--label zelyq.proxy="$want" -e ZELYQ_CADDYFILE',
      "-v zelyq-proxy-sites:/etc/caddy/sites -v zelyq-proxy-data:/data -v zelyq-proxy-config:/config",
      PROXY_IMAGE,
      "sh -c",
      sq(
        'printf "%s\\n" "$ZELYQ_CADDYFILE" > /etc/caddy/Caddyfile && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile',
      ),
      "2>&1); then",
    ].join(" "),
    '    echo "$out" >&2',
    `    docker rm -f ${PROXY} >/dev/null 2>&1 || true`,
    '    case "$out" in *"port is already allocated"*|*"address already in use"*) exit 5;; esac',
    "    exit 1",
    "  fi",
    `elif [ "$(docker inspect -f '{{.State.Running}}' ${PROXY})" != true ]; then`,
    `  docker start ${PROXY} >/dev/null`,
    "fi",
    // Ready when Caddy answers its own admin address.
    "i=0",
    `until docker exec ${PROXY} wget -q -O /dev/null http://127.0.0.1:2019/config/ 2>/dev/null; do`,
    '  i=$((i + 1)); [ "$i" -lt 30 ] || { echo "The proxy did not start." >&2; exit 1; }; sleep 1',
    "done",
    "",
  ].join("\n");
}

/**
 * Points the app's name at a container and reloads the proxy, inside the
 * proxy itself; the old file comes back if Caddy refuses the new one.
 * Exit 7: the name is another app's.
 */
export function siteScript(
  site: string,
  host: string,
  https: EnvironmentHttps,
  container: string,
  port: number,
): string {
  const address = https === "off" ? `http://${host}` : host;
  const inside = [
    "d=/etc/caddy/sites",
    `f="$d/"${sq(site)}`,
    'for other in "$d"/*.caddy; do',
    '  [ -e "$other" ] && [ "$other" != "$f" ] || continue',
    `  if grep -qxF ${sq(`${address} {`)} "$other"; then echo "Used by $(basename "$other" .caddy)." >&2; exit 7; fi`,
    "done",
    'if [ -f "$f" ]; then cp "$f" "$f.bak"; else rm -f "$f.bak"; fi',
    "cat > \"$f\" <<'ZELYQ'",
    `${address} {`,
    ...(https === "internal" ? ["\ttls internal"] : []),
    `\treverse_proxy ${container}:${port}`,
    "}",
    "ZELYQ",
    "if ! caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1; then",
    '  if [ -f "$f.bak" ]; then mv "$f.bak" "$f"; else rm -f "$f"; fi',
    "  exit 1",
    "fi",
    'rm -f "$f.bak"',
  ].join("\n");
  return `docker exec -i ${PROXY} sh -s <<'ZELYQ_SITE'\n${inside}\nZELYQ_SITE\n`;
}

/** Waits until the app answers from inside the proxy (2xx or 3xx) and keeps running. */
function proxiedHealthScript(
  container: string,
  port: number,
  path: string,
  timeoutS: number,
): string {
  const url = `http://${container}:${port}${path}`;
  return [
    `c=${sq(container)}`,
    `end=$(( $(date +%s) + ${timeoutS} ))`,
    'while [ "$(date +%s)" -lt "$end" ]; do',
    '  [ "$(docker inspect -f "{{.State.Running}}" "$c" 2>/dev/null)" = true ] || { echo "The container stopped." >&2; exit 2; }',
    `  code=$(docker exec ${PROXY} wget -q -O /dev/null -S --timeout=5 ${sq(url)} 2>&1 | awk '/HTTP\\//{c=$2} END{print c}')`,
    `  case "$code" in 2*|3*) echo "Healthy: ${path} answered $code."; exit 0;; esac`,
    "  sleep 2",
    "done",
    `echo "No answer from ${path} within ${timeoutS}s." >&2`,
    "exit 1",
    "",
  ].join("\n");
}

/** A hint when the app's name does not lead to the machine yet; null when it does or cannot tell. */
async function dnsHint(host: string, environment: DeployEnvironmentRow): Promise<string | null> {
  const wildcard = environment.domain && host.endsWith(`.${environment.domain}`);
  const record = wildcard ? `*.${environment.domain}` : host;
  const target = environment.address;
  if (!target) return null;
  const resolve = async (name: string) => {
    try {
      const found = await Promise.race([
        lookup(name, { all: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("slow")), 3000)),
      ]);
      return new Set(found.map((entry) => entry.address));
    } catch {
      return null;
    }
  };
  const [names, machine] = await Promise.all([resolve(host), resolve(target)]);
  if (!machine) return null;
  if (names && [...names].some((address) => machine.has(address))) return null;
  return `${host} does not lead to this machine yet. Add a DNS record: ${record} → ${[...machine][0]} (an A record).`;
}

type Attempt = "ok" | "refused" | "blocked" | "certificate" | "other";

/** One visit to the app's address on the machine, by its name, the way a browser makes it. */
function visit(
  host: string,
  address: string,
  port: number,
  secure: boolean,
  checkCertificate: boolean,
): Promise<Attempt> {
  return new Promise((resolve) => {
    const options = {
      host: address,
      port,
      path: "/",
      method: "GET",
      headers: { host: port === (secure ? 443 : 80) ? host : `${host}:${port}` },
      timeout: 5000,
      ...(secure ? { servername: host, rejectUnauthorized: checkCertificate } : {}),
    };
    const call = (secure ? httpsRequest : httpRequest)(options, (response) => {
      response.resume();
      resolve("ok");
    });
    call.on("timeout", () => {
      call.destroy();
      resolve("blocked");
    });
    call.on("error", (error: NodeJS.ErrnoException) => {
      const code = error.code ?? "";
      if (code === "ECONNREFUSED") resolve("refused");
      else if (["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ECONNRESET"].includes(code))
        resolve("blocked");
      else if (
        /CERT|SELF_SIGNED|ERR_TLS|SSL/i.test(code) ||
        /certificate|ssl|tls/i.test(error.message)
      )
        resolve("certificate");
      else resolve("other");
    });
    call.end();
  });
}

/**
 * Why people cannot open the app yet, or null when they can. A new
 * certificate takes a little while, so HTTPS is tried for half a minute.
 */
export async function reachProblem(
  host: string,
  address: string,
  settings: { https: EnvironmentHttps; httpPort: number; httpsPort: number },
  machine: string,
): Promise<string | null> {
  const secure = settings.https !== "off";
  const port = secure ? settings.httpsPort : settings.httpPort;
  const ports =
    settings.https === "auto" ? `${settings.httpPort} and ${settings.httpsPort}` : String(port);
  const firewall = `Open port${ports.includes(" and ") ? "s" : ""} ${ports} on ${machine}: in its own firewall and the cloud's (Google Cloud: VPC network → Firewall; AWS: Security group; Azure: Network security group). Then open the address again; no new deploy is needed.`;
  const deadline = Date.now() + (settings.https === "auto" ? 30_000 : 6_000);
  let last: Attempt = "other";
  for (;;) {
    last = await visit(host, address, port, secure, settings.https === "auto");
    if (last === "ok" || last === "blocked" || last === "refused") break;
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (last === "ok") return null;
  if (last === "blocked")
    return `Port ${port} on ${address} does not answer: a firewall blocks it. ${firewall}`;
  if (last === "refused") return `Nothing answers on port ${port} on ${address}. ${firewall}`;
  if (last === "certificate") {
    return `The HTTPS certificate is not ready. It comes by itself once ${host} leads to the machine and ports ${settings.httpPort} and ${settings.httpsPort} are open to the internet.`;
  }
  return `It did not answer from outside the machine.`;
}
