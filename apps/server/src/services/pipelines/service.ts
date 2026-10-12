import {
  type Approvers,
  expandTemplates,
  newId,
  type PipelineActor,
  type PipelineDetail,
  type PipelineFile,
  type PipelineFileIssue,
  type PipelineRunDetail,
  type PipelineRunSummary,
  type PipelineStats,
  type PipelineSummary,
  parsePipelineFile,
  parsePluginRef,
  pipelineTarget,
  pipelineVaultNames,
  pluginInputProblems,
  type Role,
  type RunApproval,
  type RunLogLine,
  type RunPullRequest,
  type RunStatus,
  type RunStep,
  type RunTrigger,
  repoPathSchema,
  resolveRunInputs,
  resolveToolVersion,
  roleAtLeast,
  type StepKind,
  type StepStatus,
  stageGroups,
  stepKind,
  stepLabel,
  summariseStages,
  type TestSummary,
  toolReleases,
  type User,
  vaultReferenceName,
  ZelyqError,
} from "@zelyq/core";
import type { PipelineRow, PipelineRunRow, PipelineStepRow, Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";
import type { VaultService } from "../vault.js";
import type { PipelineEngine } from "./engine.js";
import type { PipelinePluginService } from "./plugins.js";
import { RepoFiles } from "./repo-files.js";
import { appSlug } from "./steps.js";

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
  /** The team's installed plugins, for checking `plugin:` steps. */
  plugins: Pick<PipelinePluginService, "find"> | null = null;
  /** Reads a pipeline file kept in its repository. */
  repoFiles: Pick<RepoFiles, "read" | "defaultBranch"> = new RepoFiles();

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
    const starred = await this.store.pipelines.favorites.listForUser(user.id);
    return rows.map((row) => {
      const run = last.get(row.id) ?? null;
      return {
        ...this.summary(row, run, actors, run ? (steps.get(run.id) ?? []) : []),
        favorite: starred.has(row.id),
      };
    });
  }

  /** How the team's pipelines went over the last `days` days. */
  async stats(user: User, teamId: string, days: number): Promise<PipelineStats> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const span = Math.min(90, Math.max(1, Math.round(days)));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - (span - 1) * 86_400_000);
    const pipelines = await this.store.pipelines.pipelines.listForTeam(teamId);
    const names = new Map(pipelines.map((row) => [row.id, row.name]));
    const runs = (
      await this.store.pipelines.runs.listForTeamSince(teamId, start.toISOString())
    ).filter((run) => names.has(run.pipelineId));
    const failedStatus = (status: string) => status === "failed" || status === "timed_out";
    const took = (run: PipelineRunRow) =>
      run.startedAt && run.finishedAt
        ? Date.parse(run.finishedAt) - Date.parse(run.startedAt)
        : null;
    const rate = (passed: number, failed: number) =>
      passed + failed > 0 ? passed / (passed + failed) : null;
    const average = (values: number[]) =>
      values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;

    const daily = Array.from({ length: span }, (_, offset) => ({
      day: new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10),
      passed: 0,
      failed: 0,
      other: 0,
    }));
    for (const run of runs) {
      const entry = daily.find((day) => day.day === run.createdAt.slice(0, 10));
      if (!entry) continue;
      if (run.status === "passed") entry.passed += 1;
      else if (failedStatus(run.status)) entry.failed += 1;
      else entry.other += 1;
    }

    const durations = runs
      .map(took)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    const passed = runs.filter((run) => run.status === "passed").length;
    const failed = runs.filter((run) => failedStatus(run.status)).length;
    const newest = await this.store.pipelines.runs.lastForPipelines(pipelines.map((row) => row.id));

    const perPipeline = pipelines.map((row) => {
      const own = runs.filter((run) => run.pipelineId === row.id);
      const ownPassed = own.filter((run) => run.status === "passed").length;
      const ownFailed = own.filter((run) => failedStatus(run.status)).length;
      const last = newest.get(row.id) ?? null;
      return {
        id: row.id,
        name: row.name,
        runs: own.length,
        passed: ownPassed,
        failed: ownFailed,
        successRate: rate(ownPassed, ownFailed),
        averageMs: average(own.map(took).filter((value): value is number => value !== null)),
        last: last
          ? {
              id: last.id,
              number: last.number,
              status: last.status as RunStatus,
              createdAt: last.createdAt,
            }
          : null,
      };
    });

    // A stage's time in a run: from its first step's start to its last step's end.
    const steps = await this.store.pipelines.steps.listForRuns(runs.map((run) => run.id));
    const stageTimes = new Map<string, { pipelineId: string; stage: string; times: number[] }>();
    for (const run of runs) {
      const spans = new Map<string, { from: number; to: number }>();
      for (const step of steps.get(run.id) ?? []) {
        if (!step.startedAt || !step.finishedAt) continue;
        const from = Date.parse(step.startedAt);
        const to = Date.parse(step.finishedAt);
        const current = spans.get(step.stage);
        spans.set(step.stage, {
          from: Math.min(current?.from ?? from, from),
          to: Math.max(current?.to ?? to, to),
        });
      }
      for (const [stage, { from, to }] of spans) {
        const key = `${run.pipelineId}\u0000${stage}`;
        const entry = stageTimes.get(key) ?? { pipelineId: run.pipelineId, stage, times: [] };
        entry.times.push(to - from);
        stageTimes.set(key, entry);
      }
    }
    const slowStages = [...stageTimes.values()]
      .map((entry) => ({
        pipelineId: entry.pipelineId,
        pipelineName: names.get(entry.pipelineId) ?? "",
        stage: entry.stage,
        averageMs: average(entry.times) ?? 0,
        runs: entry.times.length,
      }))
      .sort((a, b) => b.averageMs - a.averageMs)
      .slice(0, 8);

    return {
      days: span,
      totals: {
        runs: runs.length,
        passed,
        failed,
        successRate: rate(passed, failed),
        medianMs: durations.length ? (durations[Math.floor(durations.length / 2)] ?? null) : null,
        failingNow: perPipeline.filter(
          (pipeline) => pipeline.last && failedStatus(pipeline.last.status),
        ).length,
      },
      daily,
      pipelines: perPipeline.sort(
        (a, b) => b.failed - a.failed || b.runs - a.runs || a.name.localeCompare(b.name),
      ),
      slowStages,
    };
  }

  /** Stars or unstars a pipeline for the person asking; anyone who can see it may. */
  async setFavorite(
    user: User,
    teamId: string,
    pipelineId: string,
    favorite: boolean,
  ): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const row = await this.find(teamId, pipelineId);
    await this.store.pipelines.favorites.set(user.id, row.id, favorite);
  }

  async get(user: User, teamId: string, pipelineId: string): Promise<PipelineDetail> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const row = await this.find(teamId, pipelineId);
    const run = (await this.store.pipelines.runs.lastForPipelines([row.id])).get(row.id) ?? null;
    const steps = run ? await this.store.pipelines.steps.list(run.id) : [];
    const actors = await this.actors([row.createdBy, row.updatedBy]);
    return {
      ...this.summary(row, run, actors, steps),
      favorite: (await this.store.pipelines.favorites.listForUser(user.id)).has(row.id),
      source: row.source,
      createdAt: row.createdAt,
      createdBy: row.createdBy ? (actors.get(row.createdBy) ?? null) : null,
    };
  }

  /** What is wrong with a file, before it is saved. */
  async check(user: User, teamId: string, source: string): Promise<PipelineCheck> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const expanded = expandTemplates(source, await this.templates(teamId));
    if (!expanded.ok) return { ok: false, issues: expanded.issues, warnings: [] };
    const parsed = parsePipelineFile(expanded.text);
    if (!parsed.ok) return { ok: false, issues: parsed.issues, warnings: [] };
    const plugins = await this.pluginProblems(teamId, parsed.file, source);
    if (plugins.length > 0) return { ok: false, issues: plugins, warnings: [] };
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
      repoPath: null,
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
    if (row.repoPath) {
      throw new ZelyqError(
        "conflict",
        `This file is kept in the repository at ${row.repoPath}. Change it there; each branch runs its own copy.`,
      );
    }
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

  // ------------------------------------------------- the file in the repository

  /**
   * Keeps the file in the repository from now on: every run reads it there,
   * at the run's own branch or commit. The file must be on the default branch
   * already; it is checked as the person linking it, like a save.
   */
  async linkRepo(
    user: User,
    teamId: string,
    pipelineId: string,
    rawPath: string,
  ): Promise<PipelineDetail> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const row = await this.find(teamId, pipelineId);
    const checked = repoPathSchema.safeParse(rawPath);
    if (!checked.success) {
      throw ZelyqError.badRequest(checked.error.issues[0]?.message ?? "Check the path.");
    }
    await this.takeFromRepo(user, row, checked.data);
    await this.access.recordChange(user, {
      teamId,
      action: "pipeline.repo_linked",
      detail: { label: row.name, path: checked.data },
    });
    return this.get(user, teamId, row.id);
  }

  /** Reads the file on the default branch again, as the person asking. */
  async pullFromRepo(user: User, teamId: string, pipelineId: string): Promise<PipelineDetail> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const row = await this.find(teamId, pipelineId);
    if (!row.repoPath) throw ZelyqError.badRequest("This file is not kept in a repository.");
    if (await this.takeFromRepo(user, row, row.repoPath)) {
      await this.access.recordChange(user, {
        teamId,
        action: "pipeline.repo_pulled",
        detail: { label: row.name, path: row.repoPath },
      });
    }
    return this.get(user, teamId, row.id);
  }

  /** Keeps the file only in Zelyq again, as it last was on the default branch. */
  async unlinkRepo(user: User, teamId: string, pipelineId: string): Promise<PipelineDetail> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const row = await this.find(teamId, pipelineId);
    if (row.repoPath) {
      await this.store.pipelines.pipelines.update(row.id, { repoPath: null });
      await this.access.recordChange(user, {
        teamId,
        action: "pipeline.repo_unlinked",
        detail: { label: row.name, path: row.repoPath },
      });
    }
    return this.get(user, teamId, row.id);
  }

  /** Saves the default branch's file as the pipeline's copy; false when nothing changed. */
  private async takeFromRepo(user: User, row: PipelineRow, path: string): Promise<boolean> {
    const saved = parsePipelineFile(await this.withTemplates(row.teamId, row.source));
    const source = saved.ok ? saved.file.source : undefined;
    if (!source?.repo) {
      throw ZelyqError.badRequest(
        "To keep the file in a repository, the file needs source: with repo: (the repository's https:// address).",
      );
    }
    const read = await this.repoFiles.read({
      repo: source.repo,
      ref: source.ref ?? null,
      path,
      token: await this.repoToken(row.teamId, source.token),
    });
    if (!read.ok) {
      throw ZelyqError.badRequest(
        read.missing
          ? `${read.message} Add this pipeline's file there first (Download the file), then try again.`
          : read.message,
        { missing: read.missing },
      );
    }
    const file = await this.validate(user, row.teamId, read.text);
    if (file.name !== row.name) {
      const other = await this.store.pipelines.pipelines.findByName(row.teamId, file.name);
      if (other && other.id !== row.id)
        throw new ZelyqError("conflict", `There is already a pipeline called ${file.name}.`);
    }
    if (read.text === row.source && path === row.repoPath) return false;
    await this.store.pipelines.pipelines.update(row.id, {
      name: file.name,
      source: read.text,
      repoPath: path,
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  private async repoToken(teamId: string, token: string | undefined): Promise<string | null> {
    const name = token ? vaultReferenceName(token) : null;
    if (!name) return null;
    return (await this.vault.resolve(teamId, [name])).get(name) ?? null;
  }

  /**
   * A run's file, read from the repository at the run's commit or branch.
   * What a push can change there is limited to what the saved copy allows:
   * the same repository and token, and no Vault secret the saved copy does
   * not already use — those take a person, with "Update from the repository".
   * A file read from the default branch also becomes the saved copy.
   */
  private async fromRepo(
    pipeline: PipelineRow & { repoPath: string },
    ref: string | null,
    branch: string | null,
  ): Promise<{ text: string; commit: string }> {
    const problem = (message: string) => ZelyqError.badRequest(message, { repoFile: true });
    const saved = parsePipelineFile(await this.withTemplates(pipeline.teamId, pipeline.source));
    const source = saved.ok ? saved.file.source : undefined;
    if (!saved.ok || !source?.repo) {
      throw problem("The file is kept in the repository, but its saved copy has no source: repo:.");
    }
    const token = await this.repoToken(pipeline.teamId, source.token);
    const wanted = ref ?? branch ?? source.ref ?? null;
    const read = await this.repoFiles.read({
      repo: source.repo,
      ref: wanted,
      path: pipeline.repoPath,
      token,
    });
    if (!read.ok) throw problem(read.message);

    const where = pipeline.repoPath;
    const invalid = (issue: PipelineFileIssue | undefined) =>
      problem(
        `${where} is not valid: ${issue ? `${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}` : ""}`,
      );
    const expanded = expandTemplates(read.text, await this.templates(pipeline.teamId));
    if (!expanded.ok) throw invalid(expanded.issues[0]);
    const parsed = parsePipelineFile(expanded.text);
    if (!parsed.ok) throw invalid(parsed.issues[0]);
    const plugin = (await this.pluginProblems(pipeline.teamId, parsed.file, read.text))[0];
    if (plugin) throw problem(`${where}: ${plugin.message}`);
    if (
      parsed.file.source?.repo !== source.repo ||
      parsed.file.source?.token !== source.token ||
      parsed.file.source?.app !== undefined
    ) {
      throw problem(
        `${where} changes source:. The repository and its token change only in Zelyq: an editor presses "Update from the repository".`,
      );
    }
    const allowed = new Set(pipelineVaultNames(saved.file));
    const extra = pipelineVaultNames(parsed.file).filter((name) => !allowed.has(name));
    if (extra.length > 0) {
      throw problem(
        `${where} uses ${extra.join(", ")} from Vault, which this pipeline may not use yet. An editor allows it by pressing "Update from the repository".`,
      );
    }

    // The default branch's file is the pipeline's file: keep the copy current.
    // The person who last saved it stays: Protected secrets depend on them.
    const onDefault =
      wanted === null ||
      wanted === source.ref ||
      (ref !== null &&
        branch !== null &&
        source.ref === undefined &&
        branch === (await this.repoFiles.defaultBranch(source.repo, token)));
    if (onDefault && read.text !== pipeline.source) {
      const other = await this.store.pipelines.pipelines.findByName(
        pipeline.teamId,
        parsed.file.name,
      );
      await this.store.pipelines.pipelines.update(pipeline.id, {
        ...(other && other.id !== pipeline.id ? {} : { name: parsed.file.name }),
        source: read.text,
        updatedAt: new Date().toISOString(),
      });
    }
    return { text: expanded.text, commit: read.commit };
  }

  // ------------------------------------------------------------------- runs

  async startRun(
    user: User,
    teamId: string,
    pipelineId: string,
    options: { ref?: string | null; inputs?: Record<string, string> } = {},
  ): Promise<PipelineRunSummary> {
    await this.access.requireTeamRole(user, teamId, "editor");
    const pipeline = await this.find(teamId, pipelineId);
    const run = await this.enqueue(pipeline, {
      trigger: "manual",
      triggeredBy: user.id,
      ref: options.ref ?? null,
      inputs: options.inputs ?? {},
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
    // A run that never started (its file could not be read) reads the file again.
    if (pipeline.repoPath && (await this.store.pipelines.steps.list(previous.id)).length === 0) {
      const run = await this.enqueue(pipeline, {
        trigger: "rerun",
        triggeredBy: user.id,
        ref: previous.ref,
        branch: previous.branch,
        commitMessage: previous.commitMessage,
        pullRequest: previous.pullRequest
          ? (JSON.parse(previous.pullRequest) as RunPullRequest)
          : null,
      });
      await this.access.recordChange(user, {
        teamId,
        action: "pipeline.run_started",
        detail: { label: pipeline.name, run: run.number, rerunOf: previous.number },
      });
      return run;
    }
    const parsed = parsePipelineFile(previous.source);
    if (!parsed.ok) throw ZelyqError.badRequest("That run's pipeline file is not valid any more.");
    if (fromStage !== null && (fromStage < 0 || fromStage >= parsed.file.stages.length)) {
      throw ZelyqError.badRequest("There is no such stage in that run.");
    }
    const run = await this.enqueue(pipeline, {
      trigger: "rerun",
      triggeredBy: user.id,
      ref: previous.ref,
      branch: previous.branch,
      fromStage,
      source: previous.source,
      inputs: JSON.parse(previous.inputs) as Record<string, string>,
      commitMessage: previous.commitMessage,
      pullRequest: previous.pullRequest
        ? (JSON.parse(previous.pullRequest) as RunPullRequest)
        : null,
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
    options: {
      inputs?: Record<string, string>;
      upstream?: PipelineRunRow;
      commitMessage?: string | null;
      pullRequest?: RunPullRequest | null;
    } = {},
  ): Promise<PipelineRunSummary> {
    const pipeline = await this.store.pipelines.pipelines.findById(pipelineId);
    if (!pipeline) throw ZelyqError.notFound("Pipeline", pipelineId);
    const input = {
      trigger,
      triggeredBy: null,
      ref,
      branch,
      inputs: options.inputs ?? {},
      upstream: options.upstream ?? null,
      commitMessage: options.commitMessage ?? null,
      pullRequest: options.pullRequest ?? null,
    };
    try {
      return await this.enqueue(pipeline, input);
    } catch (error) {
      // Nobody is there to see the error: a run that failed at once says why.
      if (!(error instanceof ZelyqError) || !error.details?.repoFile) throw error;
      return this.failedAtStart(pipeline, input, error.message);
    }
  }

  /** A run that could not start, with the reason, so the pipeline's page shows it. */
  private async failedAtStart(
    pipeline: PipelineRow,
    input: {
      trigger: RunTrigger;
      ref: string | null;
      branch: string | null;
      upstream: PipelineRunRow | null;
      commitMessage: string | null;
      pullRequest: RunPullRequest | null;
    },
    error: string,
  ): Promise<PipelineRunSummary> {
    const now = new Date().toISOString();
    const run = await this.store.pipelines.runs.create(
      {
        id: newId("pipelineRun"),
        pipelineId: pipeline.id,
        teamId: pipeline.teamId,
        status: "failed",
        trigger: input.trigger,
        triggeredBy: null,
        runnerId: null,
        runnerName: null,
        source: pipeline.source,
        ref: input.ref,
        branch: input.branch,
        commitMessage: input.commitMessage?.split("\n")[0]?.slice(0, 300) ?? null,
        pullRequest: input.pullRequest ? JSON.stringify(input.pullRequest) : null,
        inputs: "{}",
        upstreamRunId: input.upstream?.id ?? null,
        fromStage: null,
        error,
        logBytes: 0,
        createdAt: now,
        startedAt: now,
        finishedAt: now,
      },
      [],
    );
    return this.runSummary(run, pipeline.name, [], new Map(), await this.upstreamsOf([run]));
  }

  /** A `pipeline` step starting another pipeline of its team, by name. */
  async startChild(
    parent: PipelineRunRow,
    name: string,
    inputs: Record<string, string>,
  ): Promise<PipelineRunRow> {
    const pipeline = await this.store.pipelines.pipelines.findByName(parent.teamId, name);
    if (!pipeline) throw ZelyqError.badRequest(`There is no pipeline called ${name} in this team.`);
    const summary = await this.enqueue(pipeline, {
      trigger: "pipeline",
      triggeredBy: parent.triggeredBy,
      ref: parent.ref,
      branch: parent.branch,
      inputs,
      upstream: parent,
    });
    return (await this.store.pipelines.runs.findById(summary.id)) as PipelineRunRow;
  }

  /** A run asked for by a service key with the `pipelines` scope, for its own team only. */
  async startForKey(
    teamId: string,
    pipelineId: string,
    ref: string | null,
    inputs: Record<string, string> = {},
  ): Promise<PipelineRunSummary> {
    const pipeline = await this.find(teamId, pipelineId);
    return this.enqueue(pipeline, { trigger: "api", triggeredBy: null, ref, inputs });
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
    const upstreams = await this.upstreamsOf(rows);
    return rows.map((row) =>
      this.runSummary(row, pipeline.name, steps.get(row.id) ?? [], actors, upstreams),
    );
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
    // The runs `pipeline` steps started, for their links.
    const children = new Map<string, { id: string; pipelineId: string; number: number }>();
    for (const step of steps) {
      if (!step.childRunId) continue;
      const child = await this.store.pipelines.runs.findById(step.childRunId);
      if (child)
        children.set(child.id, {
          id: child.id,
          pipelineId: child.pipelineId,
          number: child.number,
        });
    }
    return {
      ...this.runSummary(run, pipeline?.name ?? "", steps, actors, await this.upstreamsOf([run])),
      source: run.source,
      stageGroups: (() => {
        const parsed = parsePipelineFile(
          run.source,
          JSON.parse(run.inputs) as Record<string, string>,
        );
        return parsed.ok ? stageGroups(parsed.file) : [];
      })(),
      steps: steps.map((step) => ({
        id: step.id,
        stageIndex: step.stageIndex,
        stepIndex: step.stepIndex,
        stage: step.stage,
        name: step.name,
        kind: step.kind as StepKind,
        attempt: step.attempt,
        child: step.childRunId ? (children.get(step.childRunId) ?? null) : null,
        outputs: JSON.parse(step.outputs) as Record<string, string>,
        tests: step.tests ? (JSON.parse(step.tests) as TestSummary) : null,
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
      /** Input values as given; defaults are filled in and checked here. */
      inputs?: Record<string, string>;
      /** The run of another pipeline that started this one. */
      upstream?: PipelineRunRow | null;
      commitMessage?: string | null;
      pullRequest?: RunPullRequest | null;
    },
  ): Promise<PipelineRunSummary> {
    // A re-run keeps the file its run had; a new run copies templates in now,
    // from the file in the repository at the run's commit when it is kept there.
    let ref = input.ref;
    let source: string;
    if (input.source !== undefined) {
      source = input.source;
    } else if (pipeline.repoPath) {
      const read = await this.fromRepo(
        { ...pipeline, repoPath: pipeline.repoPath },
        input.ref,
        input.branch ?? null,
      );
      source = read.text;
      // The code comes from the same commit as the file, even if a push lands meanwhile.
      ref = input.ref ?? read.commit;
    } else {
      source = await this.withTemplates(pipeline.teamId, pipeline.source);
    }
    const declared = parsePipelineFile(source);
    if (!declared.ok)
      throw ZelyqError.badRequest(
        `The pipeline file is not valid: ${declared.issues[0]?.message ?? ""}`,
      );
    const resolved = resolveRunInputs(declared.file, input.inputs ?? {});
    if ("error" in resolved) throw ZelyqError.badRequest(resolved.error);
    // A chain of pipelines starting each other stops at ten: a loop cannot run for ever.
    if (input.upstream) {
      let depth = 1;
      let link: PipelineRunRow | null = input.upstream;
      while (link?.upstreamRunId && depth < MAX_CHAIN) {
        link = await this.store.pipelines.runs.findById(link.upstreamRunId);
        depth += 1;
      }
      if (depth >= MAX_CHAIN) {
        throw ZelyqError.badRequest(
          `Pipelines started each other ${MAX_CHAIN} times in a row; ${pipeline.name} was not started again. Check for a loop.`,
        );
      }
    }
    const parsed = parsePipelineFile(source, resolved.values);
    if (!parsed.ok)
      throw ZelyqError.badRequest(
        `The pipeline file is not valid with these inputs: ${parsed.issues[0]?.message ?? ""}`,
      );
    // newest-wins: what is still queued or running gives way to this run.
    if (parsed.file.concurrency === "newest-wins") {
      for (const older of await this.store.pipelines.runs.listActiveForPipeline(pipeline.id)) {
        await this.engine.cancel(older);
      }
    }
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
        ref,
        branch: input.branch ?? null,
        commitMessage: input.commitMessage?.split("\n")[0]?.slice(0, 300) ?? null,
        pullRequest: input.pullRequest ? JSON.stringify(input.pullRequest) : null,
        inputs: JSON.stringify(resolved.values),
        upstreamRunId: input.upstream?.id ?? null,
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
          attempt: 1,
          childRunId: null,
          outputs: "{}",
          tests: null,
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
      await this.upstreamsOf([run]),
    );
  }

  /** The team's pipelines by name: what `uses:` can copy stages from. */
  private async templates(teamId: string): Promise<Record<string, string>> {
    return Object.fromEntries(
      (await this.store.pipelines.pipelines.listForTeam(teamId)).map((row) => [
        row.name,
        row.source,
      ]),
    );
  }

  private async withTemplates(teamId: string, source: string): Promise<string> {
    const expanded = expandTemplates(source, await this.templates(teamId));
    if (!expanded.ok) {
      const issue = expanded.issues[0];
      throw ZelyqError.badRequest(
        `The pipeline file is not valid: ${issue ? `${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}` : ""}`,
      );
    }
    return expanded.text;
  }

  /** The runs that started these ones, for "started by Shop build #12". */
  private async upstreamsOf(rows: PipelineRunRow[]): Promise<Map<string, RunUpstream>> {
    const found = new Map<string, RunUpstream>();
    for (const row of rows) {
      if (!row.upstreamRunId || found.has(row.upstreamRunId)) continue;
      const upstream = await this.store.pipelines.runs.findById(row.upstreamRunId);
      if (!upstream) continue;
      const pipeline = await this.store.pipelines.pipelines.findById(upstream.pipelineId);
      found.set(upstream.id, {
        id: upstream.id,
        pipelineId: upstream.pipelineId,
        pipelineName: pipeline?.name ?? "",
        number: upstream.number,
      });
    }
    return found;
  }

  /** Parses, then checks every Vault secret the file uses — as the person saving it. */
  private async validate(user: User, teamId: string, source: string): Promise<PipelineFile> {
    const expanded = expandTemplates(source, await this.templates(teamId));
    const parsed = expanded.ok
      ? parsePipelineFile(expanded.text)
      : { ok: false as const, file: null, issues: expanded.issues };
    if (!parsed.ok) {
      const issue = parsed.issues[0];
      throw ZelyqError.badRequest(
        issue
          ? `${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}`
          : "The pipeline file is not valid.",
        { issues: parsed.issues },
      );
    }
    const plugin = (await this.pluginProblems(teamId, parsed.file, source))[0];
    if (plugin) {
      throw ZelyqError.badRequest(
        `${plugin.line ? `Line ${plugin.line}: ` : ""}${plugin.message}`,
        { issues: [plugin] },
      );
    }
    for (const name of pipelineVaultNames(parsed.file)) {
      await this.vault.requireUse(user, { kind: "team", teamId }, name);
    }
    return parsed.file;
  }

  /** `plugin:` steps whose plugin is not installed for the team, or whose with: is wrong. */
  private async pluginProblems(
    teamId: string,
    file: PipelineFile,
    source: string,
  ): Promise<PipelineFileIssue[]> {
    const issues: PipelineFileIssue[] = [];
    const lines = source.split("\n");
    for (const [stageIndex, stage] of file.stages.entries()) {
      for (const [stepIndex, step] of stage.steps.entries()) {
        const ref = step.plugin ? parsePluginRef(step.plugin) : null;
        if (!ref || !step.plugin) continue;
        const at = lines.findIndex((line) => line.includes(step.plugin as string));
        const found = this.plugins
          ? await this.plugins.find(teamId, ref.pluginId, ref.version)
          : null;
        const problems = found
          ? pluginInputProblems(found.manifest, step.with ?? {})
          : [
              `${ref.pluginId}@${ref.version} is not installed for this team. An admin installs it in Pipelines → Plugins.`,
            ];
        for (const message of problems) {
          issues.push({
            path: `stages.${stageIndex}.steps.${stepIndex}.plugin`,
            line: at >= 0 ? at + 1 : null,
            message,
          });
        }
      }
    }
    return issues;
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
    for (const step of steps) {
      if (!step.deploy) continue;
      const environment = await this.store.deploy.environments.findByName(teamId, step.deploy.to);
      if (!environment) {
        warnings.push(
          `There is no environment called ${step.deploy.to} yet. An admin adds it in Deployments.`,
        );
        continue;
      }
      // Behind the environment's proxy, apps share no port on the machine.
      if (environment.domain) continue;
      // Another app already answers on that port there: this deploy could not start.
      const app = step.deploy.app ?? appSlug(file.source?.app ?? file.name);
      const hostPort = step.deploy["host-port"] ?? step.deploy.port;
      const other = (await this.store.deploy.deployments.live([environment.id])).find(
        (live) => live.hostPort === hostPort && live.app !== app,
      );
      if (other) {
        warnings.push(
          `Port ${hostPort} on ${environment.name} is used by ${other.app}. Write app: ${other.app} to replace it, or choose another host-port.`,
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
            stages: summariseStages(lastSteps as unknown as RunStep[]),
          }
        : null,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ? (actors.get(row.updatedBy) ?? null) : null,
      favorite: false,
      repoPath: row.repoPath ?? null,
    };
  }

  private runSummary(
    row: PipelineRunRow,
    pipelineName: string,
    steps: PipelineStepRow[],
    actors: Map<string, PipelineActor> = new Map(),
    upstreams: Map<string, RunUpstream> = new Map(),
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
      stages: summariseStages(steps as unknown as RunStep[]),
      inputs: JSON.parse(row.inputs) as Record<string, string>,
      upstream: row.upstreamRunId ? (upstreams.get(row.upstreamRunId) ?? null) : null,
      branch: row.branch,
      commit: row.ref && /^[0-9a-f]{40}$/i.test(row.ref) ? row.ref : null,
      commitMessage: row.commitMessage,
      pullRequest: row.pullRequest ? (JSON.parse(row.pullRequest) as RunPullRequest) : null,
    };
  }
}

type RunUpstream = NonNullable<PipelineRunSummary["upstream"]>;

/** Pipelines starting each other: at most this many in a row. */
const MAX_CHAIN = 10;

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
