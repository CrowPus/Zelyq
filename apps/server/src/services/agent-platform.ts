import { createHash } from "node:crypto";
import type { DeploymentSummary, PipelineRunDetail, Project, Role, User } from "@zelyq/core";
import { ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { AccessControl } from "./access.js";
import type { DeployService } from "./deploy.js";
import type { RunnerService } from "./pipelines/runners.js";
import type { PipelineService } from "./pipelines/service.js";
import { appSlug } from "./pipelines/steps.js";

/**
 * What the build agent may see and do with Zelyq's own pipelines and deploys,
 * for the one app it is building.
 *
 * Every call acts as the person in the chat, with their role in the team: a
 * viewer can look, an editor can save and run, and nothing here can approve a
 * deploy to a protected environment, change an environment, add a trigger,
 * roll back or promote. Those stay with people (and Ops). The agent only ever
 * touches pipelines whose source is this app, so a chat about one app cannot
 * change or start another app's pipeline.
 */

/** A pipeline file's fingerprint: an update must name the version it was written against. */
export function pipelineBase(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

const ENDED = new Set(["passed", "failed", "cancelled", "timed_out"]);
const LOG_TAIL = 60;

export interface PlatformOverview {
  app: { name: string; id: string };
  role: Role;
  localRunner: { available: boolean; busy: number; places: number };
  runners: { name: string; os: string | null; labels: string[]; online: boolean | null }[];
  environments: {
    name: string;
    protected: boolean;
    frozen: boolean;
    frozenReason: string | null;
    machine: string | null;
    domain: string | null;
    address: string | null;
    variables: string[];
    /** This app on it, when it is live there. */
    thisApp: { url: string | null; number: number; status: string; at: string } | null;
    otherApps: number;
  }[];
  pipelines: {
    name: string;
    base: string;
    source: string;
    runsOn: string;
    deploysTo: string[];
    keptInRepository: string | null;
    triggers: { kind: string; enabled: boolean }[];
    lastRun: { number: number; status: string; at: string } | null;
  }[];
}

export interface PlatformRun {
  pipeline: string;
  number: number;
  runId: string;
  status: string;
  error: string | null;
  stages: { name: string; status: string }[];
  failedStep: { stage: string; name: string; exitCode: number | null } | null;
  /** The last lines of the failed step's output, or of the run when no step failed. */
  logTail: string[];
  waitingFor: { message: string }[];
  queue: string | null;
  deployed: {
    environment: string;
    app: string;
    status: string;
    url: string | null;
    error: string | null;
  }[];
  ended: boolean;
}

export class AgentPlatform {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly pipelines: PipelineService,
    private readonly runners: RunnerService,
    private readonly deploys: DeployService,
  ) {}

  private async who(grant: { projectId: string; userId: string }) {
    const user = await this.store.users.findById(grant.userId);
    if (!user) throw new ZelyqError("unauthorized", "That user no longer exists");
    // Membership is checked now, not when the grant was minted.
    const { project, role } = await this.access.requireProject(user, grant.projectId, "viewer");
    return { user, project, role };
  }

  /** Whether a pipeline file's `source: app:` is this project (by id or name). */
  private isThisApp(app: string | null | undefined, project: Project): boolean {
    if (!app) return false;
    return app === project.id || app.trim().toLowerCase() === project.name.trim().toLowerCase();
  }

  /** This app's pipelines: the ones whose source is this project. */
  private async ownPipelines(user: User, project: Project) {
    const rows = await this.store.pipelines.pipelines.listForTeam(project.teamId);
    const own = [];
    for (const row of rows) {
      const targets = await this.pipelines.targets(user, project.teamId, row.source);
      if (targets && this.isThisApp(targets.app, project)) own.push({ row, targets });
    }
    return own;
  }

  private async ownPipeline(user: User, project: Project, name: string) {
    const own = await this.ownPipelines(user, project);
    const found = own.find((entry) => entry.row.name.toLowerCase() === name.trim().toLowerCase());
    if (!found) {
      throw ZelyqError.badRequest(
        `${name} is not one of this app's pipelines. zelyq_platform lists them: ${
          own.map((entry) => entry.row.name).join(", ") || "there are none yet"
        }.`,
      );
    }
    return found;
  }

  async overview(grant: { projectId: string; userId: string }): Promise<PlatformOverview> {
    const { user, project, role } = await this.who(grant);
    const teamId = project.teamId;
    const [local, runners, environments, own] = await Promise.all([
      this.pipelines.localRunner(user, teamId),
      this.runners.list(user, teamId),
      this.deploys.list(user, teamId),
      this.ownPipelines(user, project),
    ]);
    const ownIds = new Set(own.map((entry) => entry.row.id));
    const slug = appSlug(project.name);
    const last = await this.store.pipelines.runs.lastForPipelines(own.map((entry) => entry.row.id));
    const pipelines = [];
    for (const { row, targets } of own) {
      const triggers = await this.store.pipelines.triggers.list(row.id);
      const run = last.get(row.id);
      pipelines.push({
        name: row.name,
        base: pipelineBase(row.source),
        source: row.source,
        runsOn: /^runs-on:\s*(.+)$/m.exec(row.source)?.[1]?.trim() ?? "",
        deploysTo: targets.environments,
        keptInRepository: row.repoPath,
        triggers: triggers.map((trigger) => ({ kind: trigger.kind, enabled: trigger.enabled })),
        lastRun: run ? { number: run.number, status: run.status, at: run.createdAt } : null,
      });
    }
    const mine = (deployment: DeploymentSummary) =>
      (deployment.run !== null && ownIds.has(deployment.run.pipelineId)) || deployment.app === slug;
    return {
      app: { name: project.name, id: project.id },
      role,
      localRunner: { available: !local.off, busy: local.busy, places: local.places },
      runners: runners
        .filter((runner) => runner.enabled)
        .map((runner) => ({
          name: runner.name,
          os: runner.os,
          labels: runner.labels,
          online: runner.kind === "agent" ? runner.online : null,
        })),
      environments: environments.map((environment) => {
        const live = environment.live.find(mine) ?? null;
        return {
          name: environment.name,
          protected: environment.protected,
          frozen: environment.frozen,
          frozenReason: environment.frozenReason,
          machine: environment.runner?.name ?? null,
          domain: environment.domain,
          address: environment.address,
          variables: environment.variables.map((variable) => variable.name),
          thisApp: live
            ? {
                url: live.url,
                number: live.number,
                status: live.status,
                at: live.finishedAt ?? live.createdAt,
              }
            : null,
          otherApps: environment.live.filter((deployment) => !mine(deployment)).length,
        };
      }),
      pipelines,
    };
  }

  /**
   * Checks a pipeline file as Zelyq will run it; with `save`, saves it too
   * (a new pipeline, or a new version of this app's pipeline of that name).
   */
  async save(
    grant: { projectId: string; userId: string },
    input: { source: string; base?: string | null; save: boolean },
  ): Promise<{
    ok: boolean;
    issues: { line?: number; message: string }[];
    warnings: string[];
    saved: null | { name: string; created: boolean; base: string; deploysTo: string[] };
  }> {
    const { user, project } = await this.who(grant);
    const teamId = project.teamId;
    const check = await this.pipelines.check(user, teamId, input.source);
    const issues = check.issues.map(({ line, message }) => ({
      ...(line ? { line } : {}),
      message,
    }));
    const warnings = check.warnings;
    if (!check.ok) return { ok: false, issues, warnings, saved: null };
    const targets = await this.pipelines.targets(user, teamId, input.source);
    if (!targets || !this.isThisApp(targets.app, project)) {
      issues.push({
        message: `The file's source must be this app: \`source: {app: ${project.name}}\`. The agent only writes pipelines for the app it is building.`,
      });
      return { ok: false, issues, warnings, saved: null };
    }
    if (!input.save) return { ok: true, issues, warnings, saved: null };

    const name = /^name:\s*(.+)$/m
      .exec(input.source)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
    const existing = name ? await this.store.pipelines.pipelines.findByName(teamId, name) : null;
    if (existing) {
      const existingTargets = await this.pipelines.targets(user, teamId, existing.source);
      if (!existingTargets || !this.isThisApp(existingTargets.app, project)) {
        issues.push({
          message: `There is already a pipeline called ${existing.name}, and it belongs to something else. Give this one another name.`,
        });
        return { ok: false, issues, warnings, saved: null };
      }
      if (existing.source !== input.source && input.base !== pipelineBase(existing.source)) {
        issues.push({
          message: `${existing.name} changed in Zelyq since you read it (someone edited it). Call zelyq_platform, start from the file it shows, and pass its base.`,
        });
        return { ok: false, issues, warnings, saved: null };
      }
      const updated = await this.pipelines.update(user, teamId, existing.id, input.source, {
        note: "Saved by the build agent",
      });
      return {
        ok: true,
        issues,
        warnings,
        saved: {
          name: updated.name,
          created: false,
          base: pipelineBase(updated.source),
          deploysTo: targets.environments,
        },
      };
    }
    const created = await this.pipelines.create(user, teamId, input.source, {
      note: "Saved by the build agent",
    });
    return {
      ok: true,
      issues,
      warnings,
      saved: {
        name: created.name,
        created: true,
        base: pipelineBase(created.source),
        deploysTo: targets.environments,
      },
    };
  }

  /** Starts one of this app's pipelines. */
  async run(
    grant: { projectId: string; userId: string },
    input: { pipeline: string },
  ): Promise<PlatformRun> {
    const { user, project } = await this.who(grant);
    const { row } = await this.ownPipeline(user, project, input.pipeline);
    const started = await this.pipelines.startRun(user, project.teamId, row.id);
    return this.describe(
      user,
      project,
      await this.pipelines.getRun(user, project.teamId, started.id),
    );
  }

  /** Where one run of this app's pipelines is: by its id, or a pipeline's run number (latest when absent). */
  async runStatus(
    grant: { projectId: string; userId: string },
    input: { runId?: string; pipeline?: string; number?: number },
  ): Promise<PlatformRun> {
    const { user, project } = await this.who(grant);
    let runId = input.runId;
    if (!runId) {
      if (!input.pipeline) throw ZelyqError.badRequest("Name the pipeline, or give the run's id.");
      const { row } = await this.ownPipeline(user, project, input.pipeline);
      const runs = await this.pipelines.listRuns(user, project.teamId, row.id);
      const run =
        input.number === undefined ? runs[0] : runs.find((entry) => entry.number === input.number);
      if (!run) {
        throw ZelyqError.badRequest(
          input.number === undefined
            ? `${row.name} has not run yet.`
            : `${row.name} has no run #${input.number}.`,
        );
      }
      runId = run.id;
    }
    const detail = await this.pipelines.getRun(user, project.teamId, runId);
    const own = await this.ownPipelines(user, project);
    if (!own.some((entry) => entry.row.id === detail.pipelineId)) {
      throw ZelyqError.badRequest("That run is not one of this app's pipelines.");
    }
    return this.describe(user, project, detail);
  }

  private async describe(
    user: User,
    project: Project,
    run: PipelineRunDetail,
  ): Promise<PlatformRun> {
    const ended = ENDED.has(run.status);
    const failed =
      run.steps.find((step) => step.status === "failed" || step.status === "timed_out") ?? null;
    let logTail: string[] = [];
    if (ended && run.status !== "passed") {
      const lines: { stepId: string | null; text: string }[] = [];
      for (let after = 0; ; ) {
        const page = await this.pipelines.logs(user, project.teamId, run.id, after);
        lines.push(...page.lines);
        const lastSeq = page.lines.at(-1)?.seq;
        if (page.done || lastSeq === undefined || page.lines.length === 0) break;
        after = lastSeq;
        if (lines.length > 20_000) break;
      }
      const ofStep = failed ? lines.filter((line) => line.stepId === failed.id) : [];
      logTail = (ofStep.length > 0 ? ofStep : lines).slice(-LOG_TAIL).map((line) => line.text);
    }
    const deployed: PlatformRun["deployed"] = [];
    if (run.steps.some((step) => step.kind === "deploy")) {
      for (const environment of await this.deploys.list(user, project.teamId)) {
        const history = await this.deploys.history(user, project.teamId, environment.id, null);
        for (const deployment of history.filter((entry) => entry.run?.id === run.id)) {
          deployed.push({
            environment: environment.name,
            app: deployment.app,
            status: deployment.status,
            url: deployment.url,
            error: deployment.error,
          });
        }
      }
    }
    return {
      pipeline: run.pipelineName,
      number: run.number,
      runId: run.id,
      status: run.status,
      error: run.error,
      stages: run.stages.map((stage) => ({ name: stage.name, status: stage.status })),
      failedStep: failed
        ? { stage: failed.stage, name: failed.name, exitCode: failed.exitCode }
        : null,
      logTail,
      waitingFor: run.approvals
        .filter((approval) => approval.decision === null)
        .map((approval) => ({ message: approval.message })),
      queue: run.queue
        ? `Queued: ${
            run.queue.reason === "machine"
              ? `waiting for ${run.queue.machine ?? "a machine"} (place ${run.queue.position} in line)`
              : run.queue.reason === "earlier"
                ? "an earlier run of this pipeline goes first"
                : run.queue.reason === "plan"
                  ? "the team's plan allows no more runs at once right now"
                  : "Zelyq is being updated; it starts once that is done"
          }.`
        : null,
      deployed,
      ended,
    };
  }

  /** This app as it runs on one environment now: state, CPU, memory, its latest output. */
  async appStatus(grant: { projectId: string; userId: string }, input: { environment: string }) {
    const { user, project } = await this.who(grant);
    const environment = await this.store.deploy.environments.findByName(
      project.teamId,
      input.environment.trim(),
    );
    if (!environment || environment.teamId !== project.teamId) {
      throw ZelyqError.badRequest(`There is no environment called ${input.environment}.`);
    }
    const own = new Set((await this.ownPipelines(user, project)).map((entry) => entry.row.id));
    const slug = appSlug(project.name);
    const [summary] = (await this.deploys.list(user, project.teamId)).filter(
      (entry) => entry.id === environment.id,
    );
    const live = summary?.live.find(
      (deployment) =>
        (deployment.run !== null && own.has(deployment.run.pipelineId)) || deployment.app === slug,
    );
    if (!live) {
      return { live: false as const, environment: environment.name };
    }
    const status = await this.deploys.appStatus(
      user,
      project.teamId,
      environment.id,
      live.app,
      null,
    );
    return {
      live: true as const,
      environment: environment.name,
      app: live.app,
      url: live.url,
      number: live.number,
      state: status.state,
      restarts: status.restarts,
      startedAt: status.startedAt,
      cpuPercent: status.cpuPercent,
      memoryBytes: status.memoryBytes,
      logs: status.logs.slice(-LOG_TAIL).map((line) => line.text),
    };
  }
}
