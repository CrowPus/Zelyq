import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  fillRunValues,
  newId,
  onOwnMachine,
  type PipelineCondition,
  type PipelineFile,
  type PipelineShell,
  type PipelineStage,
  type PipelineStep,
  type PluginManifest,
  parsePipelineFile,
  pipelineTarget,
  pipelineVaultNames,
  type RunnerOs,
  type RunStatus,
  roleAtLeast,
  type StepStatus,
  stageGroups,
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
  startServiceContainers,
} from "@zelyq/runtime";
import type { DeployService } from "../deploy.js";
import type { SettingsService } from "../settings.js";
import type { VaultService } from "../vault.js";
import { addJunit, emptySummary } from "./junit.js";
import { Masker } from "./mask.js";
import { sendNotification } from "./notify.js";
import {
  outputFileScript,
  parseOutputs,
  safeTestPattern,
  splitTestFiles,
  testFilesScript,
} from "./results.js";
import { parseList, type RunnerService } from "./runners.js";
import {
  checkoutCommands,
  cleanupCommand,
  defaultShell,
  packCommand,
  posixQuote,
  prepareCommand,
  shellCommand,
  stepScript,
  stopCommand,
  unpackCommand,
  workspacePath,
} from "./scripts.js";
import { probeMachine, SshSession } from "./ssh.js";
import { type ReportState, reportStatus, type StatusTarget } from "./status.js";
import {
  applyTool,
  type Machine,
  type RunState,
  runStepKind,
  type StepContext,
  type StepResult,
} from "./steps.js";
import type { ToolService } from "./tools.js";

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
  /** Where setup gets tools. */
  tools: ToolService;
  /** The local runner's caches, on this server. */
  cacheDir: string;
  deploys: DeployService;
  /** The plugins a team installed. */
  plugins?: {
    find(
      teamId: string,
      pluginId: string,
      version: string,
    ): Promise<{ manifest: PluginManifest; path: string } | null>;
  };
}

type EndReason = "cancelled" | "timed_out";

interface ActiveRun {
  controller: AbortController;
  reason: EndReason | null;
  runnerKey: string;
  /** Whether the run counts against its runner now (not while it waits for a person). */
  holding: boolean;
  /** True while it waits for an approval: a shutdown leaves it waiting. */
  waiting?: boolean;
}

/** Step states that are over: on a resume they are not run again. */
const FINISHED = new Set<StepStatus>(["passed", "failed", "skipped", "cancelled", "timed_out"]);

/** Whether a step's ending makes the rest of the run "after a failure". */
function isFailure(status: StepStatus, step: PipelineStep): boolean {
  if (status === "timed_out" || status === "cancelled") return true;
  return status === "failed" && !step["continue-on-error"];
}

/** The run's time limit, which stands still while the run waits for a person. */
class RunClock {
  private left: number;
  private since: number | null = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    limitMs: number,
    private readonly onTimeout: () => void,
  ) {
    this.left = limitMs;
    this.arm();
  }

  remainingMs(): number {
    return Math.max(0, this.left - (this.since === null ? 0 : Date.now() - this.since));
  }

  pause(): void {
    if (this.since === null) return;
    this.left = this.remainingMs();
    this.since = null;
    if (this.timer) clearTimeout(this.timer);
  }

  resume(): void {
    if (this.since !== null) return;
    this.since = Date.now();
    this.arm();
  }

  stop(): void {
    this.since = null;
    if (this.timer) clearTimeout(this.timer);
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.onTimeout, this.left);
  }
}

class RunError extends Error {}

/** Leaves a waiting run as it is: Zelyq is shutting down, and the next start resumes it. */
class Suspended extends Error {}

export class PipelineEngine {
  private readonly active = new Map<string, ActiveRun>();
  /** Running runs per runner ("local" or a runner id). */
  private readonly busy = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private again = false;
  private closed = false;
  private docker: { at: number; ok: boolean } | null = null;
  /** Set by the server: how a `pipeline` step starts another pipeline, and who hears a run ended. */
  hooks: {
    startChild?: (
      parent: PipelineRunRow,
      name: string,
      inputs: Record<string, string>,
    ) => Promise<PipelineRunRow>;
    runFinished?: (run: PipelineRunRow) => Promise<unknown>;
  } = {};
  private cleaner: NodeJS.Timeout | null = null;
  /** Wakes a run waiting for an approval, by run id. */
  private readonly waiters = new Map<string, () => void>();

  /** This Zelyq's identity on the host: its data folder, hashed. */
  private readonly instance: string;
  /** Sends a run's ✓ / ✗ to GitHub or GitLab; tests put a fake here. */
  reporter: (target: StatusTarget, state: ReportState) => Promise<void> = reportStatus;

  constructor(private readonly deps: EngineDeps) {
    this.instance = createHash("sha256")
      .update(path.resolve(deps.artifactsDir))
      .digest("hex")
      .slice(0, 16);
  }

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
    await removeStalePipelineContainers(this.instance).catch(() => 0);
    // A run waiting for a person keeps waiting across a restart.
    for (const run of await this.deps.store.pipelines.runs.listByStatus("waiting")) {
      await this.resumeWaiting(run).catch((error) =>
        this.deps.log.error(error, `pipeline run ${run.id} could not resume`),
      );
    }
    this.timer = setInterval(() => this.wake(), TICK_MS);
    // Keeping runs: once an hour, and once shortly after start.
    const clean = () =>
      void this.cleanUp().catch((error) => this.deps.log.error(error, "pipeline clean-up failed"));
    this.cleaner = setInterval(clean, 60 * 60 * 1000);
    setTimeout(clean, 60_000).unref();
    this.wake();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.cleaner) clearInterval(this.cleaner);
    // A run waiting for a person is doing nothing: it stays waiting, and the
    // next start picks it up. Everything else is stopped.
    for (const wake of this.waiters.values()) wake();
    for (const run of this.active.values()) {
      if (run.waiting) continue;
      run.reason = "cancelled";
      run.controller.abort();
    }
    const deadline = Date.now() + STOP_GRACE_MS * 3;
    while ([...this.active.values()].some((run) => !run.waiting) && Date.now() < deadline) {
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
      const parsed = parsePipelineFile(run.source, runInputs(run));
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
      const active: ActiveRun = {
        controller: new AbortController(),
        reason: null,
        runnerKey: key,
        holding: true,
      };
      this.launch(claimed, parsed.file, placement.runner, active, false);
    }
  }

  private launch(
    run: PipelineRunRow,
    file: PipelineFile,
    runner: RunnerRow | null,
    active: ActiveRun,
    resume: boolean,
  ): void {
    this.active.set(run.id, active);
    void this.execute(run, file, runner, active, resume)
      .catch((error) => this.deps.log.error(error, `pipeline run ${run.id} failed unexpectedly`))
      .finally(() => {
        this.active.delete(run.id);
        this.release(active);
        this.wake();
      });
  }

  /** Picks a waiting run up again after a restart, holding nothing until approved. */
  private async resumeWaiting(run: PipelineRunRow): Promise<void> {
    const parsed = parsePipelineFile(run.source, runInputs(run));
    const runner = run.runnerId
      ? await this.deps.store.pipelines.runners.findById(run.runnerId)
      : null;
    const lost = !parsed.ok
      ? "The pipeline file is not valid any more."
      : run.runnerId && !runner
        ? "Its runner was removed while it waited."
        : !run.runnerId && (await this.deps.settings.value("pipelineLocalRunner")) !== "host"
          ? "Its local container was lost when Zelyq restarted; run it again."
          : null;
    if (lost || !parsed.ok) {
      await this.finishSteps(run.id, "skipped");
      await this.deps.store.pipelines.runs.update(run.id, {
        status: "failed",
        error: lost,
        finishedAt: new Date().toISOString(),
      });
      return;
    }
    this.launch(
      run,
      parsed.file,
      runner,
      {
        controller: new AbortController(),
        reason: null,
        runnerKey: runner?.id ?? "local",
        holding: false,
      },
      true,
    );
  }

  /** Which runner takes this run: one with room now, later, or none at all. */
  private async place(
    run: PipelineRunRow,
    file: PipelineFile,
  ): Promise<{ runner: RunnerRow | null } | { wait: true } | { fail: string }> {
    // one-at-a-time: earlier runs of this pipeline go first.
    if (file.concurrency === "one-at-a-time") {
      const active = await this.deps.store.pipelines.runs.listActiveForPipeline(run.pipelineId);
      const ahead = active.find(
        (other) =>
          other.id !== run.id && (other.status !== "queued" || other.createdAt < run.createdAt),
      );
      if (ahead) return { wait: true };
    }
    return this.pick(run, file);
  }

  /** A runner for this target with room now, later, or none at all. */
  private async pick(
    run: PipelineRunRow,
    file: { "runs-on": string | string[] },
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

  /**
   * A machine's place for a stage that runs on its own: waits for room on a
   * runner of the stage's target, and counts the stage against it.
   */
  private async acquire(
    run: PipelineRunRow,
    target: string | string[],
    stageName: string,
    active: ActiveRun,
    log: RunLog,
  ): Promise<{ runner: RunnerRow | null; key: string }> {
    let announced = false;
    for (;;) {
      if (active.controller.signal.aborted)
        throw new RunError("Stopped while waiting for a runner.");
      const picked = await this.pick(run, { "runs-on": target });
      if ("fail" in picked) throw new RunError(picked.fail);
      if ("runner" in picked) {
        const key = picked.runner?.id ?? "local";
        this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
        return { runner: picked.runner, key };
      }
      if (!announced) {
        announced = true;
        log.add(null, "system", `${stageName}: waiting for a free runner.`);
      }
      await sleep(TICK_MS);
    }
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
    resume = false,
  ): Promise<void> {
    const store = this.deps.store;
    const log = new RunLog(store, run.id, await store.pipelines.logs.lastSeq(run.id));
    const steps = await store.pipelines.steps.list(run.id);
    const state: RunState = { path: [], env: {}, post: [], outputs: {}, services: {} };
    // Service containers of this run, started with the machine and removed at the end.
    let stopServices: ((current: Machine | null) => Promise<void>) | null = null;
    let status: RunStatus = "passed";
    let statusTarget: StatusTarget | null = null;
    const report = async (reportState: ReportState) => {
      if (!statusTarget) return;
      await this.reporter(statusTarget, reportState).catch((caught: Error) =>
        log.add(null, "system", `Could not report the status to the repository: ${caught.message}`),
      );
    };
    let machine: Machine | null = null;
    let error: string | null = null;
    let masker = new Masker([]);
    const clock = new RunClock((file.timeout ?? DEFAULT_RUN_TIMEOUT_S) * 1000, () => {
      active.reason ??= "timed_out";
      active.controller.abort();
    });

    /** The machine, opened the first time a step needs it, and again after a wait. */
    const ensureMachine = async (): Promise<Machine> => {
      if (machine) {
        if (!active.holding) await this.reacquire(run, runner, active);
        return machine;
      }
      if (!active.holding) await this.reacquire(run, runner, active);
      if (runner) {
        log.add(null, "system", `Connecting to ${runner.username}@${runner.host}:${runner.port}.`);
      } else if ((await this.deps.settings.value("pipelineLocalRunner")) !== "host") {
        const image = (await this.deps.settings.value("pipelineLocalImage")) || "node:22-bookworm";
        log.add(null, "system", `Starting a container from ${image} (the first run downloads it).`);
      }
      await log.flush();
      const opened = await this.openMachine(run, runner);
      const prepared = await opened.exec(prepareCommand(opened.os, opened.workspace));
      if (prepared.code !== 0) {
        await opened.close().catch(() => undefined);
        throw new RunError(`Could not create the run's folder ${opened.workspace}.`);
      }
      machine = opened;
      if (file.services && !stopServices) {
        stopServices = await this.startServices(run, runner, file, opened, secretsFor, log, state);
      }
      return opened;
    };
    let secretsFor = new Map<string, string>();
    /** Gives the runner back while the run waits for a person. A local
     * container is kept (its files are the run's), but stops counting. */
    const releaseMachine = async () => {
      if (machine && runner) {
        await machine.close().catch(() => undefined);
        machine = null;
      }
      this.release(active);
    };

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
      secretsFor = secrets;
      // ✓ / ✗ on the commit, when the file asks and the run is for a commit.
      if (
        file.source?.repo &&
        file.source["report-status"] &&
        token &&
        /^[0-9a-f]{40}$/i.test(run.ref ?? "")
      ) {
        statusTarget = {
          repo: file.source.repo,
          sha: run.ref as string,
          token,
          context: `zelyq/${file.name}`,
          description: `Run #${run.number}`,
          url: this.deps.publicUrl
            ? `${this.deps.publicUrl.replace(/\/$/, "")}/pipelines/${run.pipelineId}/runs/${run.id}`
            : null,
        };
        await report("pending");
      }

      log.add(
        null,
        "system",
        resume
          ? `Run #${run.number} continues after Zelyq restarted.`
          : `Run #${run.number} on ${runner ? runner.name : "the local runner"}.`,
      );

      /** One stage's steps, on the run's machine or (lane) one of its own. Returns whether the run has failed. */
      const runStage = async (
        stageIndex: number,
        failedBefore: boolean,
        lane: { machine: Machine; state: RunState } | null,
      ): Promise<boolean> => {
        const stage = file.stages[stageIndex] as PipelineStage;
        let failed = failedBefore;
        const stageRows = steps.filter((row) => row.stageIndex === stageIndex);
        const beforeRerun = run.fromStage !== null && stageIndex < run.fromStage;
        const stageRuns =
          !active.controller.signal.aborted && conditionHolds(stage.if, failedBefore);
        for (const [stepIndex, step] of stage.steps.entries()) {
          const row = stageRows.find((candidate) => candidate.stepIndex === stepIndex);
          if (!row) continue;
          // After a restart, what already happened stands.
          if (resume && FINISHED.has(row.status as StepStatus)) {
            if (isFailure(row.status as StepStatus, step)) failed = true;
            if (step.id) state.outputs[step.id] = JSON.parse(row.outputs) as Record<string, string>;
            if (row.status === "passed" && step.setup && !lane) {
              await this.restoreSetup(step, await ensureMachine(), state);
            }
            continue;
          }
          // On a re-run from a later stage, earlier stages only fetch the source again.
          const skip =
            !stageRuns ||
            active.controller.signal.aborted ||
            (beforeRerun && (lane !== null || !step.checkout)) ||
            // A step follows its stage's condition unless it has its own.
            !conditionHolds(step.if ?? stage.if, failed);
          if (skip) {
            await store.pipelines.steps.update(row.id, { status: "skipped" });
            continue;
          }
          let outcome: StepStatus | null = null;
          // A protected environment: an admin approves every deploy first.
          if (step.deploy) {
            const environment = await this.deps.deploys.environmentFor(run.teamId, step.deploy.to);
            if (!("error" in environment) && environment.protected && lane) {
              // Waiting for an admin would hold this stage's machine for hours.
              log.add(
                row.id,
                "system",
                `${environment.name} needs an approval; deploy to it from a stage on the run's own machine.`,
              );
              await store.pipelines.steps.update(row.id, {
                status: "failed",
                finishedAt: new Date().toISOString(),
              });
              outcome = "failed";
            } else if (!("error" in environment) && environment.protected) {
              const asked = await this.awaitApproval({
                run,
                file,
                row,
                stageName: stage.name,
                approval: {
                  message: `Deploy to ${environment.name}?`,
                  approvers: "admins",
                  timeout: 24 * 60 * 60,
                  allowSelf: true,
                },
                log,
                active,
                clock,
                release: releaseMachine,
              });
              if (asked !== "passed") outcome = asked;
            }
          }
          if (outcome !== null) {
            // Not approved: the deploy does not happen.
          } else if (step.pipeline) {
            outcome = await this.awaitChild({
              run,
              row,
              stageName: stage.name,
              spec: step.pipeline,
              log,
              active,
              clock,
              release: releaseMachine,
            });
          } else if (step.approval) {
            outcome = await this.awaitApproval({
              run,
              file,
              row,
              stageName: stage.name,
              approval: step.approval,
              log,
              active,
              clock,
              release: releaseMachine,
            });
          } else {
            outcome = await this.runStep({
              run,
              file,
              step,
              row,
              stageName: stage.name,
              machine: lane ? lane.machine : await ensureMachine(),
              secrets,
              masker,
              log,
              active,
              clock,
              state: lane ? lane.state : state,
            });
          }
          if (isFailure(outcome, step)) failed = true;
        }
        return failed;
      };

      /** A stage on a machine of its own: found, opened, used and given back. */
      const runLane = async (stageIndex: number, failedBefore: boolean): Promise<boolean> => {
        const stage = file.stages[stageIndex] as PipelineStage;
        const rows = steps.filter((row) => row.stageIndex === stageIndex);
        const failure = (row: PipelineStepRow) =>
          isFailure(row.status as StepStatus, stage.steps[row.stepIndex] as PipelineStep);
        if (resume && rows.every((row) => FINISHED.has(row.status as StepStatus))) {
          for (const row of rows) {
            const step = stage.steps[row.stepIndex];
            if (step?.id)
              state.outputs[step.id] = JSON.parse(row.outputs) as Record<string, string>;
          }
          return failedBefore || rows.some(failure);
        }
        const beforeRerun = run.fromStage !== null && stageIndex < run.fromStage;
        if (
          beforeRerun ||
          active.controller.signal.aborted ||
          !conditionHolds(stage.if, failedBefore)
        ) {
          for (const row of rows) await store.pipelines.steps.update(row.id, { status: "skipped" });
          return failedBefore;
        }
        let place: { runner: RunnerRow | null; key: string } | null = null;
        let laneMachine: Machine | null = null;
        let stopLaneServices: ((current: Machine | null) => Promise<void>) | null = null;
        let failed = failedBefore;
        try {
          place = await this.acquire(
            run,
            stage["runs-on"] ?? file["runs-on"],
            stage.name,
            active,
            log,
          );
          log.add(
            null,
            "system",
            `${stage.name} on ${place.runner ? place.runner.name : "the local runner"}.`,
          );
          await log.flush();
          const opened = await this.openMachine(run, place.runner, stageIndex);
          laneMachine = opened;
          const prepared = await opened.exec(prepareCommand(opened.os, opened.workspace));
          if (prepared.code !== 0) {
            throw new RunError(`Could not create the stage's folder ${opened.workspace}.`);
          }
          // Its own PATH and services; step outputs are the run's, shared.
          const laneState: RunState = {
            path: [],
            env: {},
            post: [],
            outputs: state.outputs,
            services: {},
          };
          if (file.services) {
            stopLaneServices = await this.startServices(
              { ...run, id: `${run.id}-s${stageIndex}` },
              place.runner,
              file,
              opened,
              secretsFor,
              log,
              laneState,
            );
          }
          failed = await runStage(stageIndex, failedBefore, { machine: opened, state: laneState });
          if (!failed && !active.controller.signal.aborted) {
            for (const work of laneState.post) await work(opened, log);
          }
        } catch (caught) {
          log.add(
            null,
            "system",
            `${stage.name}: ${masker.mask(caught instanceof Error ? caught.message : String(caught))}`,
          );
          for (const row of await store.pipelines.steps.list(run.id)) {
            if (row.stageIndex === stageIndex && !FINISHED.has(row.status as StepStatus)) {
              await store.pipelines.steps.update(row.id, { status: "skipped" });
            }
          }
          failed = true;
        } finally {
          const opened = laneMachine as Machine | null;
          const stopping = stopLaneServices as ((current: Machine | null) => Promise<void>) | null;
          if (stopping) await stopping(opened).catch(() => undefined);
          if (opened) {
            if (!failed) {
              await opened.exec(cleanupCommand(opened.os, opened.workspace)).catch(() => undefined);
            }
            await opened.close().catch(() => undefined);
          }
          if (place) {
            this.busy.set(place.key, Math.max(0, (this.busy.get(place.key) ?? 1) - 1));
            this.wake();
          }
        }
        return failed;
      };

      let failed = false;
      for (const group of stageGroups(file)) {
        const [first] = group;
        if (first === undefined) continue;
        if (group.length === 1 && !onOwnMachine(file, first)) {
          failed = await runStage(first, failed, null);
          continue;
        }
        // The run's own runner is not needed meanwhile; give it back, so a
        // stage can take it, and take it again afterwards.
        await releaseMachine();
        const before = failed;
        const results = await Promise.all(group.map((index) => runLane(index, before)));
        failed = before || results.some(Boolean);
      }
      if (!failed && !active.controller.signal.aborted && machine) {
        for (const work of state.post) await work(machine, log);
      }
      status = active.reason ?? (failed ? "failed" : "passed");
      if (active.reason === "timed_out") error = `The run took longer than its timeout.`;
    } catch (caught) {
      if (caught instanceof Suspended) {
        clock.stop();
        log.add(null, "system", "Zelyq is restarting; the run keeps waiting.");
        await log.close();
        const kept = machine as Machine | null;
        const services = stopServices as ((current: Machine | null) => Promise<void>) | null;
        if (services) await services(kept).catch(() => undefined);
        if (kept) await kept.close().catch(() => undefined);
        return;
      }
      status = active.reason ?? "failed";
      error = masker.mask(caught instanceof Error ? caught.message : String(caught));
      log.add(null, "system", error);
    } finally {
      clock.stop();
    }

    const finalMachine = machine as Machine | null;
    const stopping = stopServices as ((current: Machine | null) => Promise<void>) | null;
    if (stopping) await stopping(finalMachine).catch(() => undefined);
    if (statusTarget) {
      await report(
        status === "passed" ? "success" : status === "cancelled" ? "cancelled" : "failure",
      );
    }
    if (finalMachine) {
      if (file.artifacts?.length) await this.collectArtifacts(run, file, finalMachine, log);
      if (status === "passed") {
        await finalMachine
          .exec(cleanupCommand(finalMachine.os, finalMachine.workspace))
          .catch(() => undefined);
      } else if (runner) {
        log.add(
          null,
          "system",
          `The run's folder is kept on ${runner.name} for a look: ${finalMachine.workspace}`,
        );
      }
      await finalMachine.close().catch(() => undefined);
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
    // A run waiting on this one (a `pipeline` step) goes on; "after" triggers fire.
    this.waiters.get(`child:${run.id}`)?.();
    if (finished && this.hooks.runFinished) {
      await this.hooks
        .runFinished(finished)
        .catch((caught) =>
          this.deps.log.error(
            caught,
            `pipeline run ${run.id}: downstream pipelines failed to start`,
          ),
        );
    }
  }

  /**
   * A `pipeline` step: starts the other pipeline and, if asked, waits for it —
   * holding no runner meanwhile — and takes its result. After a restart it
   * finds the run it had started instead of starting another.
   */
  private async awaitChild(input: {
    run: PipelineRunRow;
    row: PipelineStepRow;
    stageName: string;
    spec: NonNullable<PipelineStep["pipeline"]>;
    log: RunLog;
    active: ActiveRun;
    clock: RunClock;
    release: () => Promise<void>;
  }): Promise<StepStatus> {
    const { run, row, spec, log, active } = input;
    const store = this.deps.store;
    const finish = async (status: StepStatus) => {
      await store.pipelines.steps.update(row.id, { status, finishedAt: new Date().toISOString() });
      return status;
    };
    let child = row.childRunId ? await store.pipelines.runs.findById(row.childRunId) : null;
    if (!child) {
      await store.pipelines.steps.update(row.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      log.add(row.id, "system", `${input.stageName} › ${row.name}`);
      if (!this.hooks.startChild) {
        log.add(row.id, "system", "Pipelines cannot start other pipelines here.");
        return finish("failed");
      }
      try {
        child = await this.hooks.startChild(run, spec.run, spec.with);
      } catch (caught) {
        log.add(row.id, "system", caught instanceof Error ? caught.message : String(caught));
        return finish("failed");
      }
      await store.pipelines.steps.update(row.id, { childRunId: child.id });
      log.add(row.id, "system", `Started ${spec.run} #${child.number}.`);
      if (!spec.wait) return finish("passed");
    }

    // Wait for it like for an approval: no runner held, the clock paused, kept across a restart.
    await store.pipelines.steps.update(row.id, { status: "waiting" });
    await store.pipelines.runs.update(run.id, { status: "waiting" });
    await log.flush();
    await input.release();
    input.clock.pause();
    active.waiting = true;
    for (;;) {
      const current = await store.pipelines.runs.findById(child.id);
      if (!current || !["queued", "running", "waiting"].includes(current.status)) {
        child = current ?? child;
        break;
      }
      if (active.controller.signal.aborted) {
        // Cancelling this run cancels the one it is waiting for.
        await this.cancel(current);
        child = current;
        break;
      }
      if (this.closed) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 15_000);
        const onAbort = () => done();
        function done() {
          clearTimeout(timer);
          active.controller.signal.removeEventListener("abort", onAbort);
          resolve();
        }
        active.controller.signal.addEventListener("abort", onAbort, { once: true });
        this.waiters.set(`child:${child?.id}`, done);
      });
      this.waiters.delete(`child:${child.id}`);
    }
    active.waiting = false;
    if (this.closed && ["queued", "running", "waiting"].includes(child.status))
      throw new Suspended();
    input.clock.resume();
    await store.pipelines.runs.update(run.id, { status: "running" });
    if (active.controller.signal.aborted) return finish(active.reason ?? "cancelled");
    log.add(
      row.id,
      "system",
      `${spec.run} #${child.number} ${STATUS_WORDS[child.status as RunStatus] ?? child.status}.`,
    );
    return finish(child.status === "passed" ? "passed" : "failed");
  }

  /** The artifact a `download` step asks for: from the run that started this one, or another pipeline's newest passing run. */
  private async findArtifact(
    run: PipelineRunRow,
    from: string,
    name: string,
  ): Promise<{ path: string; label: string } | { error: string }> {
    const store = this.deps.store;
    let source: PipelineRunRow | null;
    let pipelineName: string;
    if (from === "upstream") {
      if (!run.upstreamRunId) {
        return {
          error:
            "This run was not started by another pipeline. Name the pipeline instead: download: {artifact: …, from: Shop build}.",
        };
      }
      source = await store.pipelines.runs.findById(run.upstreamRunId);
      pipelineName = source
        ? ((await store.pipelines.pipelines.findById(source.pipelineId))?.name ?? "")
        : "";
    } else {
      const pipeline = await store.pipelines.pipelines.findByName(run.teamId, from);
      if (!pipeline) return { error: `There is no pipeline called ${from} in this team.` };
      source = await store.pipelines.runs.lastPassed(pipeline.id);
      pipelineName = pipeline.name;
      if (!source) return { error: `${from} has no run that passed yet.` };
    }
    if (!source) return { error: "The run that started this one no longer exists." };
    const artifact = (await store.pipelines.artifacts.list(source.id)).find((a) => a.name === name);
    if (!artifact)
      return { error: `${pipelineName} #${source.number} kept no artifact called ${name}.` };
    return { path: artifact.storagePath, label: `${name} from ${pipelineName} #${source.number}` };
  }

  /**
   * Keeping runs: the newest N finished runs of each pipeline (the file's
   * `keep.runs`, else the instance setting), and artifacts younger than their
   * limit. The newest run, a run still going, and a run a live deploy came
   * from are never deleted.
   */
  async cleanUp(now = new Date()): Promise<{ runs: number; artifacts: number }> {
    const store = this.deps.store;
    const defaultRuns = Math.max(1, await this.deps.settings.numberValue("pipelineKeepRuns"));
    const defaultDays = Math.max(
      1,
      await this.deps.settings.numberValue("pipelineKeepArtifactsDays"),
    );
    let removedRuns = 0;
    let removedArtifacts = 0;
    const artifactLimit = new Map<string, number>();
    for (const pipeline of await store.pipelines.pipelines.listAll()) {
      const parsed = parsePipelineFile(pipeline.source);
      const keep = parsed.ok ? parsed.file.keep : undefined;
      artifactLimit.set(pipeline.id, (keep?.artifacts ?? defaultDays * 86_400) * 1000);
      const finished = await store.pipelines.runs.listFinishedForPipeline(pipeline.id);
      const beyond = finished.slice(Math.max(1, keep?.runs ?? defaultRuns));
      if (beyond.length === 0) continue;
      const liveRuns = new Set(
        (await store.deploy.deployments.listByStatus("live")).map((deployment) => deployment.runId),
      );
      const doomed = beyond.filter((candidate) => !liveRuns.has(candidate.id));
      for (const artifact of await store.pipelines.artifacts.listForRuns(doomed.map((r) => r.id))) {
        await fs.rm(artifact.storagePath, { force: true }).catch(() => undefined);
      }
      for (const old of doomed) {
        await fs
          .rm(path.join(this.deps.artifactsDir, old.id), { recursive: true, force: true })
          .catch(() => undefined);
      }
      await store.pipelines.runs.removeMany(doomed.map((r) => r.id));
      removedRuns += doomed.length;
    }
    // Artifacts past their pipeline's limit.
    const oldest = Math.min(...[...artifactLimit.values(), defaultDays * 86_400_000]);
    for (const artifact of await store.pipelines.artifacts.listOlderThan(
      new Date(now.getTime() - oldest).toISOString(),
    )) {
      const run = await store.pipelines.runs.findById(artifact.runId);
      const limit = (run && artifactLimit.get(run.pipelineId)) ?? defaultDays * 86_400_000;
      if (now.getTime() - Date.parse(artifact.createdAt) < limit) continue;
      await fs.rm(artifact.storagePath, { force: true }).catch(() => undefined);
      await store.pipelines.artifacts.remove(artifact.id);
      removedArtifacts += 1;
    }
    return { runs: removedRuns, artifacts: removedArtifacts };
  }

  /** Stops counting a run against its runner (it is waiting for a person). */
  private release(active: ActiveRun): void {
    if (!active.holding) return;
    active.holding = false;
    this.busy.set(active.runnerKey, Math.max(0, (this.busy.get(active.runnerKey) ?? 1) - 1));
    this.wake();
  }

  /** Counts the run against its runner again, waiting for room on that same
   * runner: the run's files are there. */
  private async reacquire(
    run: PipelineRunRow,
    runner: RunnerRow | null,
    active: ActiveRun,
  ): Promise<void> {
    if (active.holding) return;
    if (runner) {
      let announced = false;
      for (;;) {
        if (active.controller.signal.aborted)
          throw new RunError("Stopped while waiting for a runner.");
        const fresh = await this.deps.store.pipelines.runners.findById(runner.id);
        if (!fresh) throw new RunError(`${runner.name} was removed while this run waited.`);
        if ((this.busy.get(runner.id) ?? 0) < fresh.maxConcurrent) break;
        if (!announced) {
          announced = true;
          const log = new RunLog(
            this.deps.store,
            run.id,
            await this.deps.store.pipelines.logs.lastSeq(run.id),
          );
          log.add(null, "system", `Waiting for room on ${runner.name}.`);
          await log.close();
        }
        await sleep(TICK_MS);
      }
    }
    this.busy.set(active.runnerKey, (this.busy.get(active.runnerKey) ?? 0) + 1);
    active.holding = true;
  }

  /** Called once an approval has been answered (or the server learns it was). */
  decided(runId: string): void {
    this.waiters.get(runId)?.();
  }

  private async awaitApproval(input: {
    run: PipelineRunRow;
    file: PipelineFile;
    row: PipelineStepRow;
    stageName: string;
    approval: NonNullable<PipelineStep["approval"]>;
    log: RunLog;
    active: ActiveRun;
    clock: RunClock;
    release: () => Promise<void>;
  }): Promise<StepStatus> {
    const { run, row, approval, log, active } = input;
    const store = this.deps.store;
    const now = new Date();
    let record = await store.pipelines.approvals.findByStep(row.id);
    if (!record) {
      record = await store.pipelines.approvals.create({
        id: newId("pipelineApproval"),
        runId: run.id,
        stepId: row.id,
        message: approval.message,
        approvers: approval.approvers,
        allowSelf: approval.allowSelf,
        deadline: new Date(now.getTime() + approval.timeout * 1000).toISOString(),
        decision: null,
        decidedBy: null,
        comment: null,
        createdAt: now.toISOString(),
        decidedAt: null,
      });
      log.add(row.id, "system", `${input.stageName} › ${row.name}`);
      log.add(
        row.id,
        "system",
        `Waiting for approval: "${approval.message}" — ${approval.approvers === "editors" ? "editors, admins and owners" : "admins and owners"} can answer${approval.allowSelf ? "" : ", but not the person who started the run"}.`,
      );
    }
    await store.pipelines.steps.update(row.id, {
      status: "waiting",
      startedAt: row.startedAt ?? now.toISOString(),
    });
    const waitingRun = await store.pipelines.runs.update(run.id, { status: "waiting" });
    await log.flush();
    if (waitingRun && input.file.notify && !record.decision) {
      await this.notify(waitingRun, input.file).catch((caught) =>
        this.deps.log.error(caught, `pipeline run ${run.id}: notification failed`),
      );
    }
    await input.release();
    input.clock.pause();
    active.waiting = true;

    // Until someone answers, the time runs out, or the run is cancelled.
    const deadline = Date.parse(record.deadline);
    for (;;) {
      const current = await store.pipelines.approvals.findById(record.id);
      if (current?.decision) {
        record = current;
        break;
      }
      if (active.controller.signal.aborted || this.closed) break;
      if (Date.now() >= deadline) {
        record =
          (await store.pipelines.approvals.decide(
            record.id,
            "timed_out",
            null,
            null,
            new Date().toISOString(),
          )) ??
          (await store.pipelines.approvals.findById(record.id)) ??
          record;
        break;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(deadline - Date.now(), 30_000));
        const onAbort = () => done();
        function done() {
          clearTimeout(timer);
          active.controller.signal.removeEventListener("abort", onAbort);
          resolve();
        }
        active.controller.signal.addEventListener("abort", onAbort, { once: true });
        this.waiters.set(run.id, done);
      });
      this.waiters.delete(run.id);
    }
    active.waiting = false;
    if (this.closed && !record.decision) throw new Suspended();
    input.clock.resume();
    await store.pipelines.runs.update(run.id, { status: "running" });

    const finish = async (status: StepStatus) => {
      await store.pipelines.steps.update(row.id, { status, finishedAt: new Date().toISOString() });
      return status;
    };
    if (active.controller.signal.aborted && !record.decision)
      return finish(active.reason ?? "cancelled");
    const by = record.decidedBy ? await store.users.findById(record.decidedBy) : null;
    const note = record.comment ? `: ${record.comment}` : ".";
    switch (record.decision) {
      case "approved":
        log.add(row.id, "system", `Approved by ${by?.name ?? "someone"}${note}`);
        return finish("passed");
      case "rejected":
        log.add(row.id, "system", `Rejected by ${by?.name ?? "someone"}${note}`);
        return finish("failed");
      default:
        log.add(row.id, "system", "Nobody answered in time.");
        return finish("timed_out");
    }
  }

  private async runStep(input: {
    run: PipelineRunRow;
    file: PipelineFile;
    step: PipelineStep;
    row: PipelineStepRow;
    stageName: string;
    machine: Machine;
    secrets: Map<string, string>;
    masker: Masker;
    log: RunLog;
    active: ActiveRun;
    clock: RunClock;
    state: RunState;
  }): Promise<StepStatus> {
    const { run, row, machine, log } = input;
    const store = this.deps.store;
    await store.pipelines.steps.update(row.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    log.add(row.id, "system", `${input.stageName} › ${row.name}`);
    // Values earlier steps wrote, and where the services answer.
    const missing: string[] = [];
    const step = fillRunValues(input.step, input.state, missing);
    const file = { ...input.file, env: fillRunValues(input.file.env, input.state, missing) };

    const finish = async (status: StepStatus, exitCode: number | null) => {
      await store.pipelines.steps.update(row.id, {
        status,
        exitCode,
        finishedAt: new Date().toISOString(),
      });
      return status;
    };
    if (missing.length) {
      log.add(
        row.id,
        "system",
        `Not known when this step starts: ${[...new Set(missing)].join(", ")}. A step's id and output name must match a step that ran before it.`,
      );
      return finish("failed", null);
    }

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
      ...Object.fromEntries(
        Object.entries(runInputs(run)).map(([name, value]) => [
          `ZELYQ_INPUT_${name.toUpperCase()}`,
          value,
        ]),
      ),
      ...input.state.env,
    };
    const outputFile = step.id ? `${machine.workspace}${sep}.zelyq-output` : null;
    if (outputFile) env.ZELYQ_OUTPUT = outputFile;
    for (const [name, value] of Object.entries({ ...file.env, ...step.env })) {
      const secret = vaultReferenceName(value);
      env[name] = secret ? (input.secrets.get(secret) ?? "") : value;
    }

    const context: StepContext = {
      run,
      file,
      step,
      stepId: row.id,
      machine,
      shell,
      dir,
      env,
      state: input.state,
      secrets: input.secrets,
      system: (text) => log.add(row.id, "system", text),
      exec: (command, stdin, options) =>
        this.execInStep({ ...input, command, stdin, quiet: options?.quiet ?? false }),
      script: (commands, extra = {}, use = shell) =>
        this.execInStep({
          ...input,
          command: shellCommand(use),
          stdin: stepScript({
            shell: use,
            workspace: machine.workspace,
            workingDirectory: step["working-directory"],
            env: { ...env, ...extra },
            path: input.state.path,
            commands,
          }),
          quiet: false,
        }),
      tools: this.deps.tools,
      cacheDir: this.deps.cacheDir,
      deploys: this.deps.deploys,
      line: (stream, text) => log.add(row.id, stream, text),
      signal: input.active.controller.signal,
      archive: (projectId) => this.deps.runtime.archive(projectId),
      appId: (app) => this.appId(run, app),
      findArtifact: (from, name) => this.findArtifact(run, from, name),
      findPlugin: async (pluginId, version) =>
        (await this.deps.plugins?.find(run.teamId, pluginId, version)) ?? null,
    };

    const leftovers = async (read: boolean) =>
      outputFile
        ? context.exec(
            shellCommand(machine.os === "windows" ? "powershell" : "sh"),
            outputFileScript(machine.os, outputFile, read),
            { quiet: true },
          )
        : null;
    await leftovers(false);

    // A failed step is tried again, up to `retry` more times; a cancelled or timed-out one is not.
    const attempts = 1 + (step.retry ?? 0);
    let result: StepResult = { code: 1, ended: null };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        log.add(row.id, "system", `Attempt ${attempt} of ${attempts}.`);
        await store.pipelines.steps.update(row.id, { attempt });
      }
      try {
        result = await runStepKind(context);
      } catch (caught) {
        log.add(
          row.id,
          "system",
          input.masker.mask(caught instanceof Error ? caught.message : String(caught)),
        );
        result = { code: null, ended: null };
        if (attempt === attempts) return finish("failed", null);
      }
      if (result.ended || result.code === 0 || attempt === attempts) break;
      if (input.active.controller.signal.aborted) break;
      log.add(
        row.id,
        "system",
        result.code === null ? "The step failed." : `The step failed with code ${result.code}.`,
      );
    }
    if (result.ended) return finish(result.ended, result.code);
    await this.collectStepResults(context, row, input.masker, leftovers);
    if (result.code === 0) return finish("passed", 0);
    if (result.code === null) {
      log.add(row.id, "system", "The connection to the machine was lost during this step.");
    } else {
      log.add(row.id, "system", `Exited with code ${result.code}.`);
    }
    return finish("failed", result.code);
  }

  /**
   * Starts the file's service containers on the run's machine and waits until
   * each port answers. Returns how to remove them again.
   */
  private async startServices(
    run: PipelineRunRow,
    runner: RunnerRow | null,
    file: PipelineFile,
    machine: Machine,
    secrets: Map<string, string>,
    log: RunLog,
    state: RunState,
  ): Promise<(current: Machine | null) => Promise<void>> {
    if (machine.os === "windows") {
      throw new RunError("Services need Docker on a Linux or macOS runner, not Windows.");
    }
    const services = Object.entries(file.services ?? {}).map(([name, service]) => ({
      name,
      image: service.image,
      port: service.port,
      env: Object.fromEntries(
        Object.entries(service.env ?? {}).map(([key, value]) => {
          const secret = vaultReferenceName(value);
          return [key, secret ? (secrets.get(secret) ?? "") : value];
        }),
      ),
    }));
    log.add(
      null,
      "system",
      `Starting services: ${services.map((s) => `${s.name} (${s.image})`).join(", ")}.`,
    );
    await log.flush();

    let hosts: Record<string, { host: string; port: number }>;
    let stop: (current: Machine | null) => Promise<void>;
    if (machine.kind === "ssh") {
      const label = `zelyq.pipeline-run=${run.id}`;
      const removeAll = `ids=$(docker ps -aq --filter ${posixQuote(`label=${label}`)}); [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1; true\n`;
      let out = "";
      const started = await machine.exec(shellCommand("sh"), {
        stdin: [
          removeAll,
          ...services.flatMap((service) => {
            const name = `zelyq-svc-${run.id.slice(-12)}-${service.name}`;
            return [
              ...Object.entries(service.env).map(
                ([key, value]) => `export ${key}=${posixQuote(value)}`,
              ),
              `docker run -d --rm --name ${name} --label ${posixQuote(label)} -p 127.0.0.1::${service.port} ${Object.keys(
                service.env,
              )
                .map((key) => `-e ${key}`)
                .join(
                  " ",
                )} ${posixQuote(service.image)} >/dev/null 2>&1 || { echo "FAILED ${service.name}"; exit 3; }`,
              `echo "PORT ${service.name} $(docker port ${name} ${service.port}/tcp | head -n 1 | sed 's/.*://')"`,
            ];
          }),
          "",
        ].join("\n"),
        onStdout: (chunk) => {
          out += chunk.toString("utf8");
        },
      });
      stop = async (current) => {
        const target = current ?? (await this.openMachine(run, runner));
        await target.exec(shellCommand("sh"), { stdin: removeAll }).catch(() => undefined);
        if (!current) await target.close().catch(() => undefined);
      };
      if (started.code !== 0) {
        await stop(machine);
        const failed = /FAILED (\S+)/.exec(out)?.[1];
        throw new RunError(
          failed
            ? `The service ${failed} did not start. Is Docker installed on the runner, and may its user use it?`
            : "Could not start the services: Docker did not answer on the runner.",
        );
      }
      hosts = {};
      for (const [, name, port] of out.matchAll(/^PORT (\S+) (\d+)$/gm)) {
        hosts[name as string] = { host: "127.0.0.1", port: Number(port) };
      }
    } else {
      const started = await startServiceContainers({
        runId: run.id,
        ...(machine.container ? { runContainer: machine.container } : {}),
        instance: this.instance,
        services,
      }).catch((caught: Error) => {
        throw new RunError(caught.message);
      });
      hosts = started.hosts;
      stop = () => started.stop();
    }

    // Each port must answer before the first step: up to 60 seconds.
    const waitScript = [
      "if command -v bash >/dev/null 2>&1; then",
      ...Object.values(hosts).map(
        ({ host, port }) =>
          `  bash -c 'for i in $(seq 60); do (exec 3<>/dev/tcp/${host}/${port}) 2>/dev/null && exit 0; sleep 1; done; exit 1' || exit 4`,
      ),
      "else sleep 10; fi",
      "",
    ].join("\n");
    const waited = await machine.exec(shellCommand("sh"), { stdin: waitScript });
    if (waited.code !== 0) {
      await stop(machine);
      throw new RunError("A service did not open its port within 60 seconds.");
    }
    for (const [name, where] of Object.entries(hosts)) {
      state.services[name] = where;
      state.env[`ZELYQ_SERVICE_${name.toUpperCase()}_HOST`] = where.host;
      state.env[`ZELYQ_SERVICE_${name.toUpperCase()}_PORT`] = String(where.port);
    }
    log.add(null, "system", "Services are ready.");
    return stop;
  }

  /** After a step: what it wrote to $ZELYQ_OUTPUT, and its test report. */
  private async collectStepResults(
    context: StepContext,
    row: PipelineStepRow,
    masker: Masker,
    leftovers: (read: boolean) => Promise<{ stdout: string; ended: unknown } | null>,
  ): Promise<void> {
    const { step, machine } = context;
    const store = this.deps.store;
    const written = await leftovers(true);
    if (step.id && written && !written.ended) {
      const values = parseOutputs(written.stdout);
      context.state.outputs[step.id] = values;
      const names = Object.keys(values);
      if (names.length) {
        await store.pipelines.steps.update(row.id, {
          outputs: JSON.stringify(
            Object.fromEntries(names.map((name) => [name, masker.mask(values[name] as string)])),
          ),
        });
        context.system(`Outputs: ${names.join(", ")}.`);
      }
    }
    if (!step.tests) return;
    if (!safeTestPattern(step.tests)) {
      context.system(`tests: ${step.tests} — use only letters, digits, . _ - / * and ?.`);
      return;
    }
    const bash = machine.os !== "windows" && (machine.shells?.includes("bash") ?? true);
    const read = await context.exec(
      shellCommand(machine.os === "windows" ? "powershell" : bash ? "bash" : "sh"),
      testFilesScript(machine.os, context.dir, step.tests, bash),
      { quiet: true },
    );
    if (read.ended) return;
    const { files, big } = splitTestFiles(read.stdout);
    for (const name of big) context.system(`${name} is larger than 5 MB; not read.`);
    if (files.length === 0) {
      context.system(`No test report matches ${step.tests}.`);
      return;
    }
    const summary = emptySummary();
    for (const found of files) {
      try {
        addJunit(summary, found.xml);
      } catch {
        context.system(`${found.name} is not a JUnit XML report.`);
      }
    }
    for (const failure of summary.failures) {
      failure.message = masker.mask(failure.message);
      failure.details = masker.mask(failure.details);
    }
    await store.pipelines.steps.update(row.id, { tests: JSON.stringify(summary) });
    context.system(
      `Tests: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.`,
    );
  }

  /** Runs one command for a step: output streamed (masked) into the step's
   * log, and stopped — with everything it started — on timeout or Cancel. */
  private async execInStep(input: {
    step: PipelineStep;
    row: PipelineStepRow;
    machine: Machine;
    masker: Masker;
    log: RunLog;
    active: ActiveRun;
    clock: RunClock;
    command: string;
    stdin: PipelineExecOptions["stdin"];
    quiet: boolean;
  }): Promise<StepResult & { stdout: string }> {
    const { step, row, machine, log, active } = input;
    const out = input.masker.fork();
    const err = input.masker.fork();
    let stdout = "";
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
      input.clock.remainingMs() / 1000,
    );
    const stepTimer = setTimeout(() => void stop("timed_out"), Math.max(0, stepSeconds * 1000));
    const onAbort = () => void stop(active.reason ?? "cancelled");
    active.controller.signal.addEventListener("abort", onAbort, { once: true });
    if (active.controller.signal.aborted) onAbort();

    const options: PipelineExecOptions = {
      stdin: input.stdin,
      signal: channel.signal,
      onStdout: (chunk) => {
        if (input.quiet) {
          stdout += chunk.toString("utf8");
          return;
        }
        for (const line of out.push(chunk)) log.add(row.id, "out", line);
      },
      onStderr: (chunk) => {
        for (const line of err.push(chunk)) log.add(row.id, "err", line);
      },
    };
    let code: number | null = null;
    try {
      code = (await machine.exec(input.command, options)).code;
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
    return { code, ended, stdout };
  }

  /** After a restart: a setup step that already passed puts its tool back on PATH. */
  private async restoreSetup(step: PipelineStep, machine: Machine, state: RunState): Promise<void> {
    if (!step.setup) return;
    const found = await this.deps.tools.locate(step.setup, machine);
    if (found) applyTool(found, machine, state);
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

  /** `lane`: a stage on a machine of its own gets its own folder and container. */
  private async openMachine(
    run: PipelineRunRow,
    runner: RunnerRow | null,
    lane: number | null = null,
  ): Promise<Machine> {
    const key = lane === null ? run.id : `${run.id}-s${lane}`;
    if (!runner) {
      const mode = await this.deps.settings.value("pipelineLocalRunner");
      if (mode === "host") {
        const short = `${run.id.replace(/^[a-z]+_/, "").slice(0, 12)}${lane === null ? "" : `-s${lane}`}`;
        const pipelinesDir = path.join(this.deps.artifactsDir, "..");
        return {
          ...(await hostPipelineMachine(path.join(pipelinesDir, "pipeline-runs", short))),
          kind: "host",
          shells: null,
          zelyqDir: path.join(pipelinesDir, "host"),
        };
      }
      const image = (await this.deps.settings.value("pipelineLocalImage")) || "node:22-bookworm";
      return {
        ...(await startPipelineContainer({ runId: key, image, instance: this.instance })),
        kind: "container",
        shells: null,
        zelyqDir: "/zelyq",
      };
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
        workspace: workspacePath(facts.os, facts.home, run.id, lane),
        kind: "ssh",
        zelyqDir: facts.os === "windows" ? `${facts.home}\\zelyq` : `${facts.home}/zelyq`,
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
      if (step.status === "pending" || step.status === "waiting")
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
  waiting: "waiting",
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

/** The input values a run was started with. */
function runInputs(run: PipelineRunRow): Record<string, string> {
  try {
    return JSON.parse(run.inputs) as Record<string, string>;
  } catch {
    return {};
  }
}
