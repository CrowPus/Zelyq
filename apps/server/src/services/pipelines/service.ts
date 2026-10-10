import {
  type Approvers,
  newId,
  type PipelineActor,
  type PipelineDetail,
  type PipelineFile,
  type PipelineFileIssue,
  type PipelineRunDetail,
  type PipelineRunSummary,
  type PipelineSummary,
  parsePipelineFile,
  pipelineTarget,
  pipelineVaultNames,
  type Role,
  type RunApproval,
  type RunLogLine,
  type RunStatus,
  type RunStep,
  type RunTrigger,
  resolveToolVersion,
  roleAtLeast,
  type StepKind,
  type StepStatus,
  stepKind,
  stepLabel,
  summariseStages,
  toolReleases,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { PipelineRow, PipelineRunRow, PipelineStepRow, Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";
import type { VaultService } from "../vault.js";
import type { PipelineEngine } from "./engine.js";

/** A run that has not ended yet. */
const ACTIVE = new Set(["queued", "running", "waiting"]);

export interface PipelineCheck {
  ok: boolean;
  issues: PipelineFileIssue[];
  /** Things that will not stop a save but will stop a run. */
  warnings: string[];
}

/**
 * Pipelines: a team's YAML files, and their runs. Viewers see everything;
 * editors write files and start runs; a file that uses a Protected secret can
 * only be saved by an admin (the Vault decides, the same as anywhere else).
 */
export class PipelineService {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly vault: VaultService,
    private readonly engine: PipelineEngine,
  ) {}

  // ------------------------------------------------------------------ files

  async list(user: User, teamId: string): Promise<PipelineSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const rows = await this.store.pipelines.pipelines.listForTeam(teamId);
    const last = await this.store.pipelines.runs.lastForPipelines(rows.map((row) => row.id));
    const steps = await this.store.pipelines.steps.listForRuns(
      [...last.values()].map((run) => run.id),
    );
    const actors = await this.actors(rows.map((row) => row.updatedBy));
    return rows.map((row) => {
      const run = last.get(row.id) ?? null;
      return this.summary(row, run, actors, run ? (steps.get(run.id) ?? []) : []);
    });
  }

  async get(user: User, teamId: string, pipelineId: string): Promise<PipelineDetail> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const row = await this.find(teamId, pipelineId);
    const run = (await this.store.pipelines.runs.lastForPipelines([row.id])).get(row.id) ?? null;
    const steps = run ? await this.store.pipelines.steps.list(run.id) : [];
    const actors = await this.actors([row.createdBy, row.updatedBy]);
    return {
      ...this.summary(row, run, actors, steps),
      source: row.source,
      createdAt: row.createdAt,
      createdBy: row.createdBy ? (actors.get(row.createdBy) ?? null) : null,
    };
  }

  /** What is wrong with a file, before it is saved. */
  async check(user: User, teamId: string, source: string): Promise<PipelineCheck> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const parsed = parsePipelineFile(source);
    if (!parsed.ok) return { ok: false, issues: parsed.issues, warnings: [] };
    return { ok: true, issues: [], warnings: await this.warnings(teamId, parsed.file) };
  }

  async create(user: User, teamId: string, source: string): Promise<PipelineDetail> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const file = await this.validate(user, teamId, source);
    if (await this.store.pipelines.pipelines.findByName(teamId, file.name)) {
      throw new ZelyqError("conflict", `There is already a pipeline called ${file.name}.`);
    }
    const now = new Date().toISOString();
    const row = await this.store.pipelines.pipelines.create({
      id: newId("pipeline"),
      teamId,
      name: file.name,
      source,
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.created",
      detail: { label: row.name },
    });
    return this.get(user, teamId, row.id);
  }

  async update(
    user: User,
    teamId: string,
    pipelineId: string,
    source: string,
  ): Promise<PipelineDetail> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const row = await this.find(teamId, pipelineId);
    const file = await this.validate(user, teamId, source);
    if (file.name !== row.name) {
      const other = await this.store.pipelines.pipelines.findByName(teamId, file.name);
      if (other && other.id !== row.id)
        throw new ZelyqError("conflict", `There is already a pipeline called ${file.name}.`);
    }
    if (source === row.source) return this.get(user, teamId, row.id);
    await this.store.pipelines.pipelines.update(row.id, {
      name: file.name,
      source,
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    });
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.updated",
      detail: { label: file.name, ...(file.name !== row.name ? { previous: row.name } : {}) },
    });
    return this.get(user, teamId, row.id);
  }

  async remove(user: User, teamId: string, pipelineId: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const row = await this.find(teamId, pipelineId);
    const runs = await this.store.pipelines.runs.listForPipeline(row.id, 20);
    if (runs.some((run) => ACTIVE.has(run.status))) {
      throw new ZelyqError("conflict", "This pipeline has a run in progress. Cancel it first.");
    }
    await this.store.pipelines.pipelines.remove(row.id);
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.deleted",
      detail: { label: row.name },
    });
  }

  // ------------------------------------------------------------------- runs

  async startRun(
    user: User,
    teamId: string,
    pipelineId: string,
    options: { ref?: string | null } = {},
  ): Promise<PipelineRunSummary> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const pipeline = await this.find(teamId, pipelineId);
    const run = await this.enqueue(pipeline, {
      trigger: "manual",
      triggeredBy: user.id,
      ref: options.ref ?? null,
    });
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.run_started",
      detail: { label: pipeline.name, run: run.number },
    });
    return run;
  }

  /** Runs the same file again — from the start, or from one stage on. */
  async rerun(
    user: User,
    teamId: string,
    runId: string,
    fromStage: number | null,
  ): Promise<PipelineRunSummary> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const previous = await this.findRun(teamId, runId);
    const pipeline = await this.find(teamId, previous.pipelineId);
    const parsed = parsePipelineFile(previous.source);
    if (!parsed.ok) throw ZelyqError.badRequest("That run's pipeline file is not valid any more.");
    if (fromStage !== null && (fromStage < 0 || fromStage >= parsed.file.stages.length)) {
      throw ZelyqError.badRequest("There is no such stage in that run.");
    }
    const run = await this.enqueue(pipeline, {
      trigger: "rerun",
      triggeredBy: user.id,
      ref: previous.ref,
      fromStage,
      source: previous.source,
    });
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.run_started",
      detail: { label: pipeline.name, run: run.number, rerunOf: previous.number, fromStage },
    });
    return run;
  }

  /**
   * A run started by a trigger, with no person behind it. The file was
   * checked against the Vault when an editor saved it.
   */
  async startTriggered(
    pipelineId: string,
    trigger: Exclude<RunTrigger, "manual" | "rerun">,
    ref: string | null,
    branch: string | null = null,
  ): Promise<PipelineRunSummary> {
    const pipeline = await this.store.pipelines.pipelines.findById(pipelineId);
    if (!pipeline) throw ZelyqError.notFound("Pipeline", pipelineId);
    return this.enqueue(pipeline, { trigger, triggeredBy: null, ref, branch });
  }

  /** A run asked for by a service key with the `pipelines` scope, for its own team only. */
  async startForKey(
    teamId: string,
    pipelineId: string,
    ref: string | null,
  ): Promise<PipelineRunSummary> {
    const pipeline = await this.find(teamId, pipelineId);
    return this.enqueue(pipeline, { trigger: "api", triggeredBy: null, ref });
  }

  async cancel(user: User, teamId: string, runId: string): Promise<PipelineRunSummary> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const run = await this.findRun(teamId, runId);
    if (!ACTIVE.has(run.status)) {
      throw ZelyqError.badRequest("This run has already finished.");
    }
    await this.engine.cancel(run);
    const pipeline = await this.store.pipelines.pipelines.findById(run.pipelineId);
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.run_cancelled",
      detail: { label: pipeline?.name ?? run.pipelineId, run: run.number },
    });
    return this.runSummary(
      (await this.store.pipelines.runs.findById(run.id)) ?? run,
      pipeline?.name ?? "",
      await this.store.pipelines.steps.list(run.id),
    );
  }

  async listRuns(user: User, teamId: string, pipelineId: string): Promise<PipelineRunSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const pipeline = await this.find(teamId, pipelineId);
    const rows = await this.store.pipelines.runs.listForPipeline(pipeline.id, 100);
    const actors = await this.actors(rows.map((row) => row.triggeredBy));
    const steps = await this.store.pipelines.steps.listForRuns(rows.map((row) => row.id));
    return rows.map((row) => this.runSummary(row, pipeline.name, steps.get(row.id) ?? [], actors));
  }

  async getRun(user: User, teamId: string, runId: string): Promise<PipelineRunDetail> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const run = await this.findRun(teamId, runId);
    const pipeline = await this.store.pipelines.pipelines.findById(run.pipelineId);
    const [steps, artifacts, actors] = await Promise.all([
      this.store.pipelines.steps.list(run.id),
      this.store.pipelines.artifacts.list(run.id),
      this.actors([run.triggeredBy]),
    ]);
    return {
      ...this.runSummary(run, pipeline?.name ?? "", steps, actors),
      source: run.source,
      steps: steps.map((step) => ({
        id: step.id,
        stageIndex: step.stageIndex,
        stepIndex: step.stepIndex,
        stage: step.stage,
        name: step.name,
        kind: step.kind as StepKind,
        status: step.status as StepStatus,
        exitCode: step.exitCode,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
      })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        sizeBytes: artifact.sizeBytes,
      })),
      approvals: await this.presentApprovals(user, teamId, run),
    };
  }

  /** The run's approval steps, and whether this person may answer the open one. */
  private async presentApprovals(
    user: User,
    teamId: string,
    run: PipelineRunRow,
  ): Promise<RunApproval[]> {
    const rows = await this.store.pipelines.approvals.listForRun(run.id);
    if (rows.length === 0) return [];
    const role = await this.store.teams.roleOf(teamId, user.id);
    const actors = await this.actors(rows.map((row) => row.decidedBy));
    return rows.map((row) => ({
      id: row.id,
      stepId: row.stepId,
      message: row.message,
      approvers: row.approvers as Approvers,
      allowSelf: row.allowSelf,
      deadline: row.deadline,
      decision: row.decision as RunApproval["decision"],
      decidedBy: row.decidedBy ? (actors.get(row.decidedBy) ?? null) : null,
      comment: row.comment,
      decidedAt: row.decidedAt,
      canDecide: !row.decision && mayApprove(row, run, user, role) === null,
    }));
  }

  /**
   * Answers an approval. Who may answer is checked now, with the person's role
   * today — not when the run started — and only a person can answer, never a
   * service key.
   */
  async decide(
    user: User,
    teamId: string,
    runId: string,
    approvalId: string,
    decision: "approved" | "rejected",
    comment: string | null,
  ): Promise<PipelineRunDetail> {
    const role = await this.access.requireTeamRole(user, teamId, "viewer");
    const run = await this.findRun(teamId, runId);
    const approval = await this.store.pipelines.approvals.findById(approvalId);
    if (!approval || approval.runId !== run.id) throw ZelyqError.notFound("Approval", approvalId);
    if (approval.decision) throw new ZelyqError("conflict", "This has already been answered.");
    if (run.status !== "waiting")
      throw new ZelyqError("conflict", "This run is not waiting for an answer.");
    const refusal = mayApprove(approval, run, user, role);
    if (refusal) throw new ZelyqError("forbidden", refusal);
    const decided = await this.store.pipelines.approvals.decide(
      approval.id,
      decision,
      user.id,
      comment?.trim() || null,
      new Date().toISOString(),
    );
    if (!decided) throw new ZelyqError("conflict", "Someone answered first.");
    this.engine.decided(run.id);
    const pipeline = await this.store.pipelines.pipelines.findById(run.pipelineId);
    await this.access.recordChange(user, {
      teamId,
      action: decision === "approved" ? "pipeline.run_approved" : "pipeline.run_rejected",
      detail: {
        label: pipeline?.name ?? run.pipelineId,
        run: run.number,
        message: approval.message,
      },
    });
    return this.getRun(user, teamId, run.id);
  }

  /** Log lines after a sequence number; `done` once the run has ended and all is read. */
  async logs(
    user: User,
    teamId: string,
    runId: string,
    after: number,
  ): Promise<{ lines: RunLogLine[]; done: boolean }> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const run = await this.findRun(teamId, runId);
    const rows = await this.store.pipelines.logs.after(run.id, after);
    const finished = !ACTIVE.has(run.status);
    return {
      lines: rows.map((row) => ({
        seq: row.seq,
        stepId: row.stepId,
        stream: row.stream as RunLogLine["stream"],
        text: row.text,
        at: row.at,
      })),
      done: finished && rows.length < 2000,
    };
  }

  /** The whole log as plain text, for Download log. */
  async logText(
    user: User,
    teamId: string,
    runId: string,
  ): Promise<{ name: string; text: string }> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const run = await this.findRun(teamId, runId);
    const pipeline = await this.store.pipelines.pipelines.findById(run.pipelineId);
    const parts: string[] = [];
    let after = 0;
    for (;;) {
      const page = await this.store.pipelines.logs.after(run.id, after, 5000);
      for (const line of page)
        parts.push(`${line.at}  ${line.stream === "system" ? "## " : ""}${line.text}`);
      if (page.length < 5000) break;
      after = page[page.length - 1]?.seq ?? after;
    }
    const slug = (pipeline?.name ?? "pipeline").replace(/[^A-Za-z0-9._-]+/g, "-");
    return { name: `${slug}-${run.number}.log`, text: `${parts.join("\n")}\n` };
  }

  async artifact(
    user: User,
    teamId: string,
    artifactId: string,
  ): Promise<{ name: string; path: string; size: number }> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const artifact = await this.store.pipelines.artifacts.findById(artifactId);
    const run = artifact ? await this.store.pipelines.runs.findById(artifact.runId) : null;
    if (!artifact || !run || run.teamId !== teamId)
      throw ZelyqError.notFound("Artifact", artifactId);
    return {
      name: `${artifact.name}.tar.gz`,
      path: artifact.storagePath,
      size: artifact.sizeBytes,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async enqueue(
    pipeline: PipelineRow,
    input: {
      trigger: RunTrigger;
      triggeredBy: string | null;
      ref: string | null;
      /** The branch a run is for, which its caches belong to. */
      branch?: string | null;
      fromStage?: number | null;
      source?: string;
    },
  ): Promise<PipelineRunSummary> {
    const source = input.source ?? pipeline.source;
    const parsed = parsePipelineFile(source);
    if (!parsed.ok)
      throw ZelyqError.badRequest(
        `The pipeline file is not valid: ${parsed.issues[0]?.message ?? ""}`,
      );
    const run = await this.store.pipelines.runs.create(
      {
        id: newId("pipelineRun"),
        pipelineId: pipeline.id,
        teamId: pipeline.teamId,
        status: "queued",
        trigger: input.trigger,
        triggeredBy: input.triggeredBy,
        runnerId: null,
        runnerName: null,
        source,
        ref: input.ref,
        branch: input.branch ?? null,
        fromStage: input.fromStage ?? null,
        error: null,
        logBytes: 0,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
      },
      parsed.file.stages.flatMap((stage, stageIndex) =>
        stage.steps.map((step, stepIndex) => ({
          id: newId("pipelineStep"),
          stageIndex,
          stepIndex,
          stage: stage.name,
          name: stepLabel(step),
          kind: stepKind(step),
          status: "pending",
          exitCode: null,
          startedAt: null,
          finishedAt: null,
        })),
      ),
    );
    this.engine.wake();
    const actors = await this.actors([input.triggeredBy]);
    return this.runSummary(
      run,
      pipeline.name,
      await this.store.pipelines.steps.list(run.id),
      actors,
    );
  }

  /** Parses, then checks every Vault secret the file uses — as the person saving it. */
  private async validate(user: User, teamId: string, source: string): Promise<PipelineFile> {
    const parsed = parsePipelineFile(source);
    if (!parsed.ok) {
      const issue = parsed.issues[0];
      throw ZelyqError.badRequest(
        issue
          ? `${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}`
          : "The pipeline file is not valid.",
        { issues: parsed.issues },
      );
    }
    for (const name of pipelineVaultNames(parsed.file)) {
      await this.vault.requireUse(user, { kind: "team", teamId }, name);
    }
    return parsed.file;
  }

  private async warnings(teamId: string, file: PipelineFile): Promise<string[]> {
    const warnings: string[] = [];
    for (const name of pipelineVaultNames(file)) {
      if (!(await this.store.vault.findByName(teamId, name)))
        warnings.push(`${name} is not in the team's Vault yet.`);
    }
    const app = file.source?.app;
    if (app) {
      const projects = await this.store.projects.listForTeams([teamId], 1000);
      const found = projects.filter(
        (project) => project.id === app || project.name.toLowerCase() === app.toLowerCase(),
      );
      if (found.length === 0) warnings.push(`There is no app called ${app} in this team.`);
      if (found.length > 1) warnings.push(`Two apps are called ${app}; use the app's id instead.`);
    }
    const steps = file.stages.flatMap((stage) => stage.steps);
    for (const step of steps) {
      if (step.setup?.version && !resolveToolVersion(step.setup.tool, step.setup.version)) {
        warnings.push(
          `${step.setup.tool} ${step.setup.version} is not on the approved tools list. Approved: ${toolReleases(
            step.setup.tool,
          )
            .map((release) => release.version)
            .join(", ")}.`,
        );
      }
    }
    if (pipelineTarget(file).kind === "local" && steps.some((step) => step.docker)) {
      warnings.push(
        "docker steps need a machine with Docker; the local runner's container has none. Use an SSH runner (runs-on: [docker]).",
      );
    }
    const target = pipelineTarget(file);
    if (
      target.kind === "name" &&
      !(await this.store.pipelines.runners.findByName(teamId, target.name))
    ) {
      warnings.push(`There is no runner called ${target.name} yet. Add it in Runners.`);
    }
    return warnings;
  }

  private async find(teamId: string, pipelineId: string): Promise<PipelineRow> {
    const row = await this.store.pipelines.pipelines.findById(pipelineId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Pipeline", pipelineId);
    return row;
  }

  private async findRun(teamId: string, runId: string): Promise<PipelineRunRow> {
    const row = await this.store.pipelines.runs.findById(runId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Run", runId);
    return row;
  }

  private async actors(ids: (string | null)[]): Promise<Map<string, PipelineActor>> {
    const found = new Map<string, PipelineActor>();
    for (const id of new Set(ids.filter((id): id is string => Boolean(id)))) {
      const user = await this.store.users.findById(id);
      if (user) found.set(id, { id: user.id, name: user.name });
    }
    return found;
  }

  private summary(
    row: PipelineRow,
    last: PipelineRunRow | null,
    actors: Map<string, PipelineActor>,
    lastSteps: PipelineStepRow[],
  ): PipelineSummary {
    const parsed = parsePipelineFile(row.source);
    const target = parsed.ok ? pipelineTarget(parsed.file) : null;
    return {
      id: row.id,
      teamId: row.teamId,
      name: row.name,
      runsOn: !target
        ? ""
        : target.kind === "labels"
          ? target.labels.join(", ")
          : target.kind === "local"
            ? "local"
            : target.name,
      lastRun: last
        ? {
            id: last.id,
            number: last.number,
            status: last.status as RunStatus,
            createdAt: last.createdAt,
            stages: summariseStages(lastSteps as RunStep[]),
          }
        : null,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ? (actors.get(row.updatedBy) ?? null) : null,
    };
  }

  private runSummary(
    row: PipelineRunRow,
    pipelineName: string,
    steps: PipelineStepRow[],
    actors: Map<string, PipelineActor> = new Map(),
  ): PipelineRunSummary {
    return {
      id: row.id,
      pipelineId: row.pipelineId,
      pipelineName,
      number: row.number,
      status: row.status as RunStatus,
      trigger: row.trigger as RunTrigger,
      triggeredBy: row.triggeredBy ? (actors.get(row.triggeredBy) ?? null) : null,
      runner: row.runnerName || null,
      error: row.error,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      stages: summariseStages(steps as RunStep[]),
    };
  }
}

/** Why this person may not answer this approval, or null when they may. */
function mayApprove(
  approval: { approvers: string; allowSelf: boolean },
  run: { triggeredBy: string | null },
  user: User,
  role: Role | null,
): string | null {
  const needed: Role = approval.approvers === "editors" ? "editor" : "admin";
  if (!role || !roleAtLeast(role, needed)) {
    return approval.approvers === "editors"
      ? "Only editors, admins and owners can answer this."
      : "Only the team's admins and owners can answer this.";
  }
  if (!approval.allowSelf && run.triggeredBy === user.id) {
    return "This one needs someone other than the person who started the run.";
  }
  return null;
}
