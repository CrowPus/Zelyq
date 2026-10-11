import type { Readable } from "node:stream";
import {
  type DeploymentDetail,
  type DeploymentStatus,
  type DeploymentSummary,
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
    const now = new Date().toISOString();
    const row = await this.store.deploy.environments.create({
      id: newId("deployEnvironment"),
      teamId,
      name: input.name,
      runnerId: input.runnerId,
      address: input.address ?? null,
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
    const patch: Partial<DeployEnvironmentRow> = {
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.runnerId !== undefined) patch.runnerId = input.runnerId;
    if (input.address !== undefined) patch.address = input.address ?? null;
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
      url:
        request.url ??
        (environment.address ? `http://${environment.address}:${request.hostPort}` : null),
      port: request.port,
      hostPort: request.hostPort,
      healthPath: request.healthPath,
      error: null,
      log: "",
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    const image = reused?.image ?? `zelyq-${app}:${deployment.number}`;
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
      return await this.deployWork(logged, deployment, image, runner, reused);
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
