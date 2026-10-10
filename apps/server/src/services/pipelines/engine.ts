import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  newId,
  type PipelineCondition,
  type PipelineFile,
  type PipelineShell,
  type PipelineStep,
  parsePipelineFile,
  pipelineTarget,
  pipelineVaultNames,
  type RunnerOs,
  type RunStatus,
  roleAtLeast,
  type StepStatus,
  vaultReferenceName,
} from "@zelyq/core";
import type { PipelineLogRow, PipelineRunRow, PipelineStepRow, RunnerRow, Store } from "@zelyq/db";
import {
  containerEngineAvailable,
  hostPipelineMachine,
  type PipelineExecOptions,
  type PipelineMachine,
  type RuntimeDriver,
  removeStalePipelineContainers,
  startPipelineContainer,
} from "@zelyq/runtime";
import type { SettingsService } from "../settings.js";
import type { VaultService } from "../vault.js";
import { Masker } from "./mask.js";
import { sendNotification } from "./notify.js";
import { parseList, type RunnerService } from "./runners.js";
import {
  checkoutCommands,
  cleanupCommand,
  defaultShell,
  packCommand,
  prepareCommand,
  shellCommand,
  stepScript,
  stopCommand,
  unpackCommand,
  workspacePath,
} from "./scripts.js";
import { probeMachine, SshSession } from "./ssh.js";

/**
 * The pipeline engine: takes queued runs, finds each a runner with room, and
 * runs it — stage by stage, step by step — on that machine.
 *
 * One server process runs it; a run's log has exactly one writer, which is
 * what makes its line numbers simple. If the server stops mid-run, the run is
 * marked failed when it starts again: a step half-done on a machine nobody is
 * watching any more must not be reported as anything else.
 */

const TICK_MS = 2000;
const DEFAULT_RUN_TIMEOUT_S = 60 * 60;
/** After this much log a run keeps going, but stops recording output. */
const MAX_LOG_BYTES = 20 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
/** Between asking a step to stop and forcing it. */
const STOP_GRACE_MS = 5000;

export interface EngineDeps {
  store: Store;
  vault: VaultService;
  runners: RunnerService;
  settings: SettingsService;
  runtime: RuntimeDriver;
  artifactsDir: string;
  log: { info(message: string): void; error(object: unknown, message: string): void };
  /** The public address, for links in notifications. */
  publicUrl?: string;
}

type EndReason = "cancelled" | "timed_out";

interface ActiveRun {
  controller: AbortController;
  reason: EndReason | null;
  runnerKey: string;
}

/** What a step is called in the run's list, when the file does not name it. */
export function stepLabel(step: PipelineStep): string {
  if (step.name) return step.name;
  if (step.checkout) return "Checkout";
  const first = (step.run ?? "").trim().split("\n")[0] ?? "";
  return first.length > 60 ? `${first.slice(0, 57)}…` : first || "Run";
}

class RunError extends Error {}

export class PipelineEngine {
  private readonly active = new Map<string, ActiveRun>();
  /** Running runs per runner ("local" or a runner id). */
  private readonly busy = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private again = false;
  private closed = false;
  private docker: { at: number; ok: boolean } | null = null;

  constructor(private readonly deps: EngineDeps) {}

  /** Recovers from a previous process, then starts taking runs. */
  async start(): Promise<void> {
    const now = new Date().toISOString();
    for (const run of await this.deps.store.pipelines.runs.listByStatus("running")) {
      await this.finishSteps(run.id, "failed");
      await this.deps.store.pipelines.runs.update(run.id, {
        status: "failed",
        error: "Zelyq restarted while this run was in progress.",
        finishedAt: now,
      });
    }
    await removeStalePipelineContainers().catch(() => 0);
    this.timer = setInterval(() => this.wake(), TICK_MS);
    this.wake();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const run of this.active.values()) {
      run.reason = "cancelled";
      run.controller.abort();
    }
    const deadline = Date.now() + STOP_GRACE_MS * 3;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Looks at the queue now rather than at the next tick. */
  wake(): void {
    if (this.closed) return;
    if (this.ticking) {
      this.again = true;
      return;
    }
    this.ticking = true;
    void this.tick()
      .catch((error) => this.deps.log.error(error, "pipeline scheduler failed"))
      .finally(() => {
        this.ticking = false;
        if (this.again) {
          this.again = false;
          this.wake();
        }
      });
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  /** Stops a run. A queued run ends at once; a running one stops its step first. */
  async cancel(run: PipelineRunRow): Promise<void> {
    const active = this.active.get(run.id);
    if (active) {
      active.reason ??= "cancelled";
      active.controller.abort();
      return;
    }
    // Claimed the same way a runner claims it, so it cannot start as well.
    const now = new Date().toISOString();
    if (
      run.status === "queued" &&
      (await this.deps.store.pipelines.runs.claim(run.id, null, "", now))
    ) {
      await this.deps.store.pipelines.runs.update(run.id, {
        status: "cancelled",
        runnerName: null,
        startedAt: null,
        finishedAt: now,
      });
      await this.finishSteps(run.id, "cancelled");
    }
  }

  // ------------------------------------------------------------- scheduling

  private async tick(): Promise<void> {
    const queued = await this.deps.store.pipelines.runs.listByStatus("queued");
    for (const run of queued) {
      if (this.closed) return;
      const parsed = parsePipelineFile(run.source);
      if (!parsed.ok) {
        await this.failQueued(
          run,
          `The pipeline file is not valid: ${parsed.issues[0]?.message ?? ""}`,
        );
        continue;
      }
      const placement = await this.place(run, parsed.file).catch((error: Error) => ({
        fail: error.message,
      }));
      if ("wait" in placement) continue;
      if ("fail" in placement) {
        await this.failQueued(run, placement.fail);
        continue;
      }
      const claimed = await this.deps.store.pipelines.runs.claim(
        run.id,
        placement.runner?.id ?? null,
        placement.runner?.name ?? "local",
        new Date().toISOString(),
      );
      if (!claimed) continue;
      const key = placement.runner?.id ?? "local";
      this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
      const active: ActiveRun = { controller: new AbortController(), reason: null, runnerKey: key };
      this.active.set(run.id, active);
      void this.execute(claimed, parsed.file, placement.runner, active)
        .catch((error) => this.deps.log.error(error, `pipeline run ${run.id} failed unexpectedly`))
        .finally(() => {
          this.active.delete(run.id);
          this.busy.set(key, Math.max(0, (this.busy.get(key) ?? 1) - 1));
          this.wake();
        });
    }
  }

  /** Which runner takes this run: one with room now, later, or none at all. */
  private async place(
    run: PipelineRunRow,
    file: PipelineFile,
  ): Promise<{ runner: RunnerRow | null } | { wait: true } | { fail: string }> {
    const target = pipelineTarget(file);
    if (target.kind === "local") {
      const mode = await this.deps.settings.value("pipelineLocalRunner");
      if (mode === "off") {
        return {
          fail: "The local runner is off on this instance. Add an SSH runner and name it in runs-on.",
        };
      }
      if (mode !== "host" && !(await this.dockerAvailable())) {
        return {
          fail: "The local runner needs Docker on the Zelyq server, and Docker is not available. Add an SSH runner, or ask an instance admin.",
        };
      }
      const limit = Math.max(1, await this.deps.settings.numberValue("pipelineLocalConcurrency"));
      return (this.busy.get("local") ?? 0) < limit ? { runner: null } : { wait: true };
    }
    const runners = await this.deps.store.pipelines.runners.listForTeam(run.teamId);
    if (target.kind === "name") {
      const runner = runners.find((candidate) => candidate.name === target.name);
      if (!runner) return { fail: `There is no runner called ${target.name} in this team.` };
      if (!runner.enabled) return { fail: `${runner.name} is turned off.` };
      if (!runner.hostKey)
        return { fail: `${runner.name}'s fingerprint has not been confirmed. Test it in Runners.` };
      return this.hasRoom(runner) ? { runner } : { wait: true };
    }
    const wanted = target.labels.map((label) => label.toLowerCase());
    const matching = runners.filter((runner) => {
      if (!runner.enabled || !runner.hostKey) return false;
      const has = new Set([
        ...parseList(runner.labels),
        ...(runner.os ? [runner.os] : []),
        ...parseList(runner.tools),
      ]);
      return wanted.every((label) => has.has(label));
    });
    if (matching.length === 0) {
      return { fail: `No confirmed, turned-on runner has all of: ${wanted.join(", ")}.` };
    }
    const free = matching
      .filter((runner) => this.hasRoom(runner))
      .sort((a, b) => (this.busy.get(a.id) ?? 0) - (this.busy.get(b.id) ?? 0));
    return free[0] ? { runner: free[0] } : { wait: true };
  }

  private hasRoom(runner: RunnerRow): boolean {
    return (this.busy.get(runner.id) ?? 0) < runner.maxConcurrent;
  }

  private async dockerAvailable(): Promise<boolean> {
    if (this.docker && Date.now() - this.docker.at < 60_000) return this.docker.ok;
    const ok = await containerEngineAvailable();
    this.docker = { at: Date.now(), ok };
    return ok;
  }

  private async failQueued(run: PipelineRunRow, error: string): Promise<void> {
    const now = new Date().toISOString();
    const claimed = await this.deps.store.pipelines.runs.claim(
      run.id,
      null,
      run.runnerName ?? "",
      now,
    );
    if (!claimed) return;
    await this.finishSteps(run.id, "skipped");
    await this.deps.store.pipelines.runs.update(run.id, {
      status: "failed",
      error,
      finishedAt: now,
    });
    const log = new RunLog(
      this.deps.store,
      run.id,
      await this.deps.store.pipelines.logs.lastSeq(run.id),
    );
    log.add(null, "system", error);
    await log.close();
  }

  // -------------------------------------------------------------- execution

  private async execute(
    run: PipelineRunRow,
    file: PipelineFile,
    runner: RunnerRow | null,
    active: ActiveRun,
  ): Promise<void> {
    const store = this.deps.store;
    const log = new RunLog(store, run.id, await store.pipelines.logs.lastSeq(run.id));
    const steps = await store.pipelines.steps.list(run.id);
    let machine: (PipelineMachine & { shells: string[] | null }) | null = null;
    let status: RunStatus = "passed";
    let error: string | null = null;
    let masker = new Masker([]);
    const timeout = setTimeout(
      () => {
        active.reason ??= "timed_out";
        active.controller.abort();
      },
      (file.timeout ?? DEFAULT_RUN_TIMEOUT_S) * 1000,
    );
    const deadline = Date.now() + (file.timeout ?? DEFAULT_RUN_TIMEOUT_S) * 1000;

    try {
      const secrets = await this.resolveSecrets(run, file);
      const sensitive = [...secrets.values()];
      const token = file.source?.token
        ? secrets.get(vaultReferenceName(file.source.token) ?? "")
        : undefined;
      if (token)
        sensitive.push(
          checkoutCommands({ shell: "bash", repo: "", ref: null }).env(token).GIT_CONFIG_VALUE_0 ??
            "",
        );
      masker = new Masker(sensitive);

      log.add(
        null,
        "system",
        `Run #${run.number} on ${runner ? runner.name : "the local runner"}.`,
      );
      if (!runner && (await this.deps.settings.value("pipelineLocalRunner")) !== "host") {
        const image = (await this.deps.settings.value("pipelineLocalImage")) || "node:22-bookworm";
        log.add(null, "system", `Starting a container from ${image} (the first run downloads it).`);
      } else if (runner) {
        log.add(null, "system", `Connecting to ${runner.username}@${runner.host}:${runner.port}.`);
      }
      await log.flush();
      machine = await this.openMachine(run, runner);
      if (active.controller.signal.aborted) throw new RunError("Stopped before the first step.");
      const prepared = await machine.exec(prepareCommand(machine.os, machine.workspace));
      if (prepared.code !== 0)
        throw new RunError(`Could not create the run's folder ${machine.workspace}.`);

      let failed = false;
      for (const [stageIndex, stage] of file.stages.entries()) {
        const stageRows = steps.filter((row) => row.stageIndex === stageIndex);
        const beforeRerun = run.fromStage !== null && stageIndex < run.fromStage;
        const stageRuns = !active.controller.signal.aborted && conditionHolds(stage.if, failed);
        for (const [stepIndex, step] of stage.steps.entries()) {
          const row = stageRows.find((candidate) => candidate.stepIndex === stepIndex);
          if (!row) continue;
          // On a re-run from a later stage, earlier stages only fetch the source again.
          const skip =
            !stageRuns ||
            active.controller.signal.aborted ||
            (beforeRerun && !step.checkout) ||
            // A step follows its stage's condition unless it has its own.
            !conditionHolds(step.if ?? stage.if, failed);
          if (skip) {
            await store.pipelines.steps.update(row.id, { status: "skipped" });
            continue;
          }
          const outcome = await this.runStep({
            run,
            file,
            step,
            row,
            stageName: stage.name,
            machine,
            secrets,
            masker,
            log,
            active,
            deadline,
          });
          if (outcome === "failed" && !step["continue-on-error"]) failed = true;
          if (outcome === "timed_out" || outcome === "cancelled") failed = true;
        }
      }
      status = active.reason ?? (failed ? "failed" : "passed");
      if (active.reason === "timed_out") error = `The run took longer than its timeout.`;
    } catch (caught) {
      status = active.reason ?? "failed";
      error = masker.mask(caught instanceof Error ? caught.message : String(caught));
      log.add(null, "system", error);
    } finally {
      clearTimeout(timeout);
    }

    if (machine) {
      if (file.artifacts?.length) await this.collectArtifacts(run, file, machine, log);
      if (status === "passed") {
        await machine.exec(cleanupCommand(machine.os, machine.workspace)).catch(() => undefined);
      } else if (runner) {
        log.add(
          null,
          "system",
          `The run's folder is kept on ${runner.name} for a look: ${machine.workspace}`,
        );
      }
      await machine.close().catch(() => undefined);
    }

    await this.finishSteps(run.id, status === "cancelled" ? "cancelled" : "skipped");
    log.add(null, "system", `Run ${STATUS_WORDS[status]}.`);
    await log.close();
    const finished = await store.pipelines.runs.update(run.id, {
      status,
      error,
      finishedAt: new Date().toISOString(),
    });
    if (finished && file.notify) {
      await this.notify(finished, file).catch((caught) =>
        this.deps.log.error(caught, `pipeline run ${run.id}: notification failed`),
      );
    }
  }

  private async runStep(input: {
    run: PipelineRunRow;
    file: PipelineFile;
    step: PipelineStep;
    row: PipelineStepRow;
    stageName: string;
    machine: PipelineMachine & { shells: string[] | null };
    secrets: Map<string, string>;
    masker: Masker;
    log: RunLog;
    active: ActiveRun;
    deadline: number;
  }): Promise<StepStatus> {
    const { run, file, step, row, machine, log, active } = input;
    const store = this.deps.store;
    await store.pipelines.steps.update(row.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    log.add(row.id, "system", `${input.stageName} › ${row.name}`);

    const finish = async (status: StepStatus, exitCode: number | null) => {
      await store.pipelines.steps.update(row.id, {
        status,
        exitCode,
        finishedAt: new Date().toISOString(),
      });
      return status;
    };

    const shell: PipelineShell = step.shell ?? defaultShell(machine.os);
    if (machine.shells && !machine.shells.includes(shell)) {
      log.add(
        row.id,
        "system",
        `${shell} is not installed on this machine (found: ${machine.shells.join(", ") || "none"}).`,
      );
      return finish("failed", null);
    }
    const sep = machine.os === "windows" ? "\\" : "/";
    const dir = step["working-directory"]
      ? `${machine.workspace}${sep}${step["working-directory"].replaceAll(/[\\/]/g, sep)}`
      : machine.workspace;

    const env: Record<string, string> = {
      ZELYQ_RUN_ID: run.id,
      ZELYQ_RUN_NUMBER: String(run.number),
      ZELYQ_PIPELINE: file.name,
      ZELYQ_WORKSPACE: machine.workspace,
    };
    for (const [name, value] of Object.entries({ ...file.env, ...step.env })) {
      const secret = vaultReferenceName(value);
      env[name] = secret ? (input.secrets.get(secret) ?? "") : value;
    }

    let command: string;
    let stdin: string | Buffer;
    if (step.checkout && file.source?.app) {
      const archive = await this.deps.runtime.archive(await this.appId(run, file.source.app));
      await machine.exec(prepareCommand(machine.os, dir));
      command = unpackCommand(machine.os, dir);
      stdin = archive;
      log.add(row.id, "system", `Copying ${file.source.app} (${formatBytes(archive.length)}).`);
    } else if (step.checkout && file.source?.repo) {
      await machine.exec(prepareCommand(machine.os, dir));
      const checkout = checkoutCommands({
        shell,
        repo: file.source.repo,
        ref: run.ref ?? file.source.ref ?? null,
      });
      const tokenName = file.source.token ? vaultReferenceName(file.source.token) : null;
      Object.assign(env, checkout.env(tokenName ? (input.secrets.get(tokenName) ?? null) : null));
      log.add(
        row.id,
        "system",
        `Fetching ${file.source.repo}${(run.ref ?? file.source.ref) ? ` at ${run.ref ?? file.source.ref}` : ""}.`,
      );
      command = shellCommand(shell);
      stdin = stepScript({
        shell,
        workspace: machine.workspace,
        workingDirectory: step["working-directory"],
        env,
        commands: checkout.commands,
      });
    } else {
      command = shellCommand(shell);
      stdin = stepScript({
        shell,
        workspace: machine.workspace,
        workingDirectory: step["working-directory"],
        env,
        commands: step.run ?? "",
      });
    }

    const out = input.masker.fork();
    const err = input.masker.fork();
    let ended: EndReason | null = null;
    let done = false;
    const channel = new AbortController();
    const stop = async (why: EndReason) => {
      if (ended || done) return;
      ended = why;
      log.add(
        row.id,
        "system",
        why === "timed_out" ? "Timed out — stopping the step." : "Cancelled — stopping the step.",
      );
      await machine.exec(stopCommand(machine.os, machine.workspace, false)).catch(() => undefined);
      await sleep(STOP_GRACE_MS);
      if (done) return;
      await machine.exec(stopCommand(machine.os, machine.workspace, true)).catch(() => undefined);
      await sleep(STOP_GRACE_MS);
      if (!done) channel.abort();
    };
    const stepSeconds = Math.min(
      step.timeout ?? Number.POSITIVE_INFINITY,
      (input.deadline - Date.now()) / 1000,
    );
    const stepTimer = setTimeout(() => void stop("timed_out"), Math.max(0, stepSeconds * 1000));
    const onAbort = () => void stop(active.reason ?? "cancelled");
    active.controller.signal.addEventListener("abort", onAbort, { once: true });
    if (active.controller.signal.aborted) onAbort();

    const options: PipelineExecOptions = {
      stdin,
      signal: channel.signal,
      onStdout: (chunk) => {
        for (const line of out.push(chunk)) log.add(row.id, "out", line);
      },
      onStderr: (chunk) => {
        for (const line of err.push(chunk)) log.add(row.id, "err", line);
      },
    };
    let code: number | null = null;
    try {
      code = (await machine.exec(command, options)).code;
    } catch (caught) {
      log.add(
        row.id,
        "system",
        input.masker.mask(caught instanceof Error ? caught.message : String(caught)),
      );
    } finally {
      done = true;
      clearTimeout(stepTimer);
      active.controller.signal.removeEventListener("abort", onAbort);
    }
    for (const line of out.flush()) log.add(row.id, "out", line);
    for (const line of err.flush()) log.add(row.id, "err", line);

    if (ended) return finish(ended, code);
    if (code === 0) return finish("passed", 0);
    if (code === null) {
      log.add(row.id, "system", "The connection to the machine was lost during this step.");
    } else {
      log.add(row.id, "system", `Exited with code ${code}.`);
    }
    return finish("failed", code);
  }

  /** Every Vault secret the file names, read once at the start of the run. */
  private async resolveSecrets(
    run: PipelineRunRow,
    file: PipelineFile,
  ): Promise<Map<string, string>> {
    const names = pipelineVaultNames(file);
    if (names.length === 0) return new Map();
    const values = await this.deps.vault.resolve(run.teamId, names);
    const missing = names.filter((name) => !values.has(name));
    if (missing.length > 0) throw new RunError(`Not in the team's Vault: ${missing.join(", ")}.`);
    // A Protected secret is only for a pipeline whose last editor is an admin
    // now — an editor cannot reach one by changing a file an admin wrote.
    const pipeline = await this.deps.store.pipelines.pipelines.findById(run.pipelineId);
    const role = pipeline?.updatedBy
      ? await this.deps.store.teams.roleOf(run.teamId, pipeline.updatedBy)
      : null;
    for (const name of names) {
      const entry = await this.deps.store.vault.findByName(run.teamId, name);
      if (entry?.protected && !(role && roleAtLeast(role, "admin"))) {
        throw new RunError(
          `${name} is Protected: only a pipeline last saved by an admin may use it.`,
        );
      }
    }
    return values;
  }

  private async openMachine(
    run: PipelineRunRow,
    runner: RunnerRow | null,
  ): Promise<PipelineMachine & { shells: string[] | null }> {
    if (!runner) {
      const mode = await this.deps.settings.value("pipelineLocalRunner");
      if (mode === "host") {
        const short = run.id.replace(/^[a-z]+_/, "").slice(0, 12);
        return {
          ...(await hostPipelineMachine(
            path.join(this.deps.artifactsDir, "..", "pipeline-runs", short),
          )),
          shells: null,
        };
      }
      const image = (await this.deps.settings.value("pipelineLocalImage")) || "node:22-bookworm";
      return { ...(await startPipelineContainer({ runId: run.id, image })), shells: null };
    }
    const session = await SshSession.open(await this.deps.runners.target(runner));
    try {
      const facts = await probeMachine(session);
      await this.deps.store.pipelines.runners.update(runner.id, {
        os: facts.os,
        shells: JSON.stringify(facts.shells),
        tools: JSON.stringify(facts.tools),
        acceptedKeyFingerprint: session.acceptedKeyFingerprint,
      });
      return {
        os: facts.os as RunnerOs,
        workspace: workspacePath(facts.os, facts.home, run.id),
        shells: facts.shells,
        exec: (command, options = {}) => session.exec(command, options),
        close: async () => session.close(),
      };
    } catch (error) {
      session.close();
      throw error;
    }
  }

  /** The app a file's `source: app:` names, in the run's team, by name or id. */
  private async appId(run: PipelineRunRow, app: string): Promise<string> {
    const projects = await this.deps.store.projects.listForTeams([run.teamId], 1000);
    const byId = projects.find((project) => project.id === app);
    if (byId) return byId.id;
    const named = projects.filter((project) => project.name.toLowerCase() === app.toLowerCase());
    if (named.length === 1 && named[0]) return named[0].id;
    if (named.length > 1)
      throw new RunError(`Two apps are called ${app}; use the app's id instead.`);
    throw new RunError(`There is no app called ${app} in this team.`);
  }

  private async collectArtifacts(
    run: PipelineRunRow,
    file: PipelineFile,
    machine: PipelineMachine,
    log: RunLog,
  ): Promise<void> {
    const dir = path.join(this.deps.artifactsDir, run.id);
    await fs.mkdir(dir, { recursive: true });
    for (const artifact of file.artifacts ?? []) {
      const id = newId("pipelineArtifact");
      const target = path.join(dir, `${id}.tar.gz`);
      const output = createWriteStream(target);
      let size = 0;
      const tooBig = new AbortController();
      const result = await machine
        .exec(packCommand(machine.os, machine.workspace, artifact.path), {
          signal: tooBig.signal,
          onStdout: (chunk) => {
            size += chunk.length;
            if (size > MAX_ARTIFACT_BYTES) tooBig.abort();
            else output.write(chunk);
          },
        })
        .catch(() => ({ code: null }));
      await new Promise((resolve) => output.end(resolve));
      if (result.code !== 0 || tooBig.signal.aborted) {
        await fs.rm(target, { force: true });
        log.add(
          null,
          "system",
          tooBig.signal.aborted
            ? `Artifact ${artifact.name} is larger than 512 MB and was not kept.`
            : `Artifact ${artifact.name}: nothing at ${artifact.path}.`,
        );
        continue;
      }
      await this.deps.store.pipelines.artifacts.create({
        id,
        runId: run.id,
        name: artifact.name,
        storagePath: target,
        sizeBytes: size,
        createdAt: new Date().toISOString(),
      });
      log.add(null, "system", `Kept artifact ${artifact.name} (${formatBytes(size)}).`);
    }
  }

  /** The address is read from Vault only now, when it is sent. */
  private async notify(run: PipelineRunRow, file: PipelineFile): Promise<void> {
    const notify = file.notify;
    const name = notify ? vaultReferenceName(notify.webhook) : null;
    if (!notify || !name) return;
    const on = notify.on ?? ["passed", "failed", "cancelled", "timed_out"];
    if (!(on as string[]).includes(run.status)) return;
    const url = (await this.deps.vault.resolve(run.teamId, [name])).get(name);
    if (!url) return;
    await sendNotification(url, {
      pipeline: file.name,
      run: run.number,
      status: run.status as RunStatus,
      trigger: run.trigger,
      link: this.deps.publicUrl
        ? `${this.deps.publicUrl.replace(/\/$/, "")}/pipelines/${run.pipelineId}/runs/${run.id}`
        : null,
    });
  }

  /** Marks every step still pending or running with the run's ending. */
  private async finishSteps(runId: string, status: StepStatus): Promise<void> {
    const now = new Date().toISOString();
    for (const step of await this.deps.store.pipelines.steps.list(runId)) {
      if (step.status === "pending")
        await this.deps.store.pipelines.steps.update(step.id, { status });
      if (step.status === "running") {
        await this.deps.store.pipelines.steps.update(step.id, {
          status: status === "skipped" ? "failed" : status,
          finishedAt: now,
        });
      }
    }
  }
}

const STATUS_WORDS: Record<RunStatus, string> = {
  queued: "queued",
  running: "running",
  passed: "passed",
  failed: "failed",
  cancelled: "cancelled",
  timed_out: "timed out",
};

function conditionHolds(condition: PipelineCondition | undefined, failed: boolean): boolean {
  switch (condition ?? "success()") {
    case "always()":
      return true;
    case "failure()":
      return failed;
    default:
      return !failed;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A run's log: lines numbered in order and written in small batches, so a
 * chatty build does not become one database write per line.
 */
class RunLog {
  private pending: Omit<PipelineLogRow, "runId">[] = [];
  private pendingBytes = 0;
  private total = 0;
  private truncated = false;
  private writing: Promise<void> = Promise.resolve();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly store: Store,
    private readonly runId: string,
    private seq: number,
  ) {
    this.timer = setInterval(() => void this.flush(), 300);
  }

  add(stepId: string | null, stream: "out" | "err" | "system", text: string): void {
    if (this.truncated && stream !== "system") return;
    const bytes = Buffer.byteLength(text);
    if (this.total + bytes > MAX_LOG_BYTES && stream !== "system") {
      this.truncated = true;
      this.push(
        stepId,
        "system",
        "The log reached 20 MB; further output is not recorded. The run keeps going.",
        0,
      );
      return;
    }
    this.push(stepId, stream, text, bytes);
    if (this.pending.length >= 500) void this.flush();
  }

  private push(stepId: string | null, stream: string, text: string, bytes: number): void {
    this.total += bytes;
    this.pendingBytes += bytes;
    this.seq += 1;
    this.pending.push({
      id: newId("event"),
      seq: this.seq,
      stepId,
      stream,
      text,
      at: new Date().toISOString(),
    });
  }

  flush(): Promise<void> {
    const lines = this.pending;
    const bytes = this.pendingBytes;
    this.pending = [];
    this.pendingBytes = 0;
    this.writing = this.writing.then(() =>
      lines.length > 0 ? this.store.pipelines.logs.append(this.runId, lines, bytes) : undefined,
    );
    return this.writing;
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
