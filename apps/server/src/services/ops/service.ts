import { createHash } from "node:crypto";
import {
  newId,
  type OpsJobDetail,
  type OpsJobKind,
  type OpsJobSummary,
  type OpsMessage,
  type OpsPlanStep,
  type OpsRisk,
  type OpsStage,
  type OpsStepStatus,
  opsJobInputSchema,
  opsPlanDecisionSchema,
  opsPlanInputSchema,
  type Role,
  roleAtLeast,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { OpsEngineerRow, OpsJobRow, OpsPlanStepRow, PipelineRunRow, Store } from "@zelyq/db";
import type { AccessControl } from "../access.js";
import {
  type ActionContext,
  type ActionList,
  type ActionOutcome,
  inputsHash,
  type OpsEnvironmentRef,
  type OpsServices,
  type ProofResult,
  riskOf,
} from "./actions.js";
import { OpsEngineers } from "./engineer.js";
import { decide, type Verdict } from "./gate.js";
import { OpsMemory } from "./memory.js";

const FINAL: ReadonlySet<OpsStage> = new Set(["done", "failed", "stopped"]);
const STEP_FINAL: ReadonlySet<OpsStepStatus> = new Set([
  "done",
  "failed",
  "skipped",
  "not_verified",
  "replaced",
]);
/** What a finished job owes nothing for: proven, skipped, or replaced by a later plan. */
const SETTLED: ReadonlySet<string> = new Set(["done", "skipped", "replaced"]);

export interface PerformResult {
  verdict: Verdict;
  outcome: ActionOutcome | null;
  proof: ProofResult | null;
  /** The plan step this matched, and how it ended. */
  step: { id: string; status: OpsStepStatus } | null;
}

export interface PlanResult {
  ok: boolean;
  /** Steps that can never run as written, and why. */
  issues: { position: number; action: string; reason: string }[];
  job: OpsJobDetail | null;
}

/**
 * Ops's jobs: survey → plan → approve → act → record → done (072 §2.4).
 * Only this service moves a job forward; the engineer asks, the server
 * decides. Every action goes through the gate (`gate.ts`), every change is
 * recorded as an attempt (so it is never tried twice the same way), and a
 * change counts as done only with a proof the server took itself.
 */
export class OpsService {
  readonly engineers: OpsEngineers;
  readonly memory: OpsMemory;
  /** Whether the engineer is working on a job now, and what it has been doing; set by the brain. */
  liveState: (jobId: string) => { working: boolean; activity: string[] } = () => ({
    working: false,
    activity: [],
  });
  private readonly services: Omit<OpsServices, "store">;

  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly actions: ActionList,
    services: Omit<OpsServices, "store" | "memory">,
  ) {
    this.engineers = new OpsEngineers(store, access);
    this.memory = new OpsMemory(store, access);
    this.services = { ...services, memory: this.memory };
  }

  // ---------------------------------------------------------------- people

  /** A person asks Ops for something: a new job. */
  async startJob(
    user: User,
    teamId: string,
    raw: unknown,
    source: "page" | "mcp" | "channel" = "page",
  ): Promise<OpsJobDetail> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const input = opsJobInputSchema.parse(raw);
    const engineer = await this.engineers.find(teamId);
    if (!engineer) {
      throw new ZelyqError(
        "forbidden",
        "Ops is not set up in this team yet. An admin opens Ops once to set it up.",
      );
    }
    if (engineer.paused)
      throw ZelyqError.badRequest("Ops is paused. Resume it on the Ops page first.");
    const now = new Date().toISOString();
    const job: OpsJobRow = {
      id: newId("opsJob"),
      teamId,
      kind: input.kind ?? "other",
      request: input.request,
      stage: "survey",
      source,
      askedBy: user.id,
      outcome: null,
      planHash: null,
      planApprovedBy: null,
      planApprovedAt: null,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    await this.store.ops.jobs.create(job);
    await this.message(job.id, "person", user.id, input.request);
    await this.access.recordChange(user, {
      teamId,
      action: "ops.job_started",
      detail: { jobId: job.id, kind: job.kind },
    });
    return this.detail(user, job);
  }

  async listJobs(user: User, teamId: string): Promise<OpsJobSummary[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const rows = await this.store.ops.jobs.listForTeam(teamId);
    return rows.map((row) => this.summary(row));
  }

  async getJob(user: User, teamId: string, jobId: string): Promise<OpsJobDetail> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    return this.detail(user, await this.jobOf(teamId, jobId));
  }

  /** A person approves or rejects the plan they were shown, and only that plan. */
  async decidePlan(user: User, teamId: string, jobId: string, raw: unknown): Promise<OpsJobDetail> {
    await this.requirePerson(user);
    const input = opsPlanDecisionSchema.parse(raw);
    const job = await this.jobOf(teamId, jobId);
    if (job.stage !== "approve") {
      throw ZelyqError.badRequest("There is no plan waiting for approval in this job.");
    }
    if (input.planHash !== job.planHash) {
      throw ZelyqError.badRequest(
        "The plan changed after you opened it, so this is not the plan you read. Look at it again.",
      );
    }
    const steps = await this.store.ops.steps.listForJob(job.id);
    await this.access.requireTeamRole(user, teamId, await this.approverRole(job, steps));
    const now = new Date().toISOString();
    if (input.decision === "approve") {
      await this.store.ops.jobs.update(job.id, {
        stage: "act",
        planApprovedBy: user.id,
        planApprovedAt: now,
        updatedAt: now,
      });
      await this.message(job.id, "system", user.id, `${user.name} approved the plan.`);
    } else {
      await this.store.ops.jobs.update(job.id, { stage: "plan", updatedAt: now });
      await this.message(
        job.id,
        "person",
        user.id,
        `Plan rejected${input.comment ? `: ${input.comment}` : "."}`,
      );
      // A person's correction is the strongest signal there is: kept from now on, not only here.
      if (input.comment) {
        await this.memory.addWish(job.teamId, {
          text: input.comment,
          source: "correction",
          jobId: job.id,
          createdBy: user.id,
        });
      }
    }
    await this.access.recordChange(user, {
      teamId,
      action: input.decision === "approve" ? "ops.plan_approved" : "ops.plan_rejected",
      detail: { jobId: job.id, planHash: job.planHash },
    });
    return this.detail(user, (await this.store.ops.jobs.findById(job.id)) as OpsJobRow);
  }

  /** One step that cannot be undone, confirmed by itself after sign-in (072 §2.6, the always-ask list). */
  async confirmStep(
    user: User,
    teamId: string,
    jobId: string,
    stepId: string,
  ): Promise<OpsJobDetail> {
    await this.requirePerson(user);
    await this.access.requireTeamRole(user, teamId, "admin");
    const job = await this.jobOf(teamId, jobId);
    if (FINAL.has(job.stage as OpsStage)) throw ZelyqError.badRequest("This job is over.");
    const step = await this.store.ops.steps.findById(stepId);
    if (!step || step.jobId !== job.id) throw ZelyqError.notFound("Step", stepId);
    if (step.risk !== "always-ask")
      throw ZelyqError.badRequest("This step does not need its own confirmation.");
    if (step.status !== "planned") throw ZelyqError.badRequest("This step has already run.");
    const now = new Date().toISOString();
    await this.store.ops.steps.update(step.id, { confirmedBy: user.id, confirmedAt: now });
    await this.message(job.id, "system", user.id, `${user.name} confirmed: ${step.words}`);
    await this.access.recordChange(user, {
      teamId,
      action: "ops.step_confirmed",
      detail: { jobId: job.id, stepId: step.id, action: step.action },
    });
    return this.detail(user, job);
  }

  /** A person stops a job; nothing more of it runs. */
  async stopJob(user: User, teamId: string, jobId: string): Promise<OpsJobDetail> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const job = await this.jobOf(teamId, jobId);
    if (!FINAL.has(job.stage as OpsStage)) {
      const now = new Date().toISOString();
      await this.store.ops.jobs.update(job.id, {
        stage: "stopped",
        finishedAt: now,
        updatedAt: now,
      });
      await this.message(job.id, "system", user.id, `${user.name} stopped this job.`);
      await this.access.recordChange(user, {
        teamId,
        action: "ops.job_stopped",
        detail: { jobId: job.id },
      });
    }
    return this.detail(user, (await this.store.ops.jobs.findById(job.id)) as OpsJobRow);
  }

  // ------------------------------------------------------- the engineer's side

  /** The engineer proposes a plan: exact actions and inputs, checked before anyone reads it. */
  async proposePlan(jobId: string, raw: unknown): Promise<PlanResult> {
    const job = await this.liveJob(jobId);
    const engineer = await this.engineerOf(job.teamId);
    const input = opsPlanInputSchema.parse(raw);
    const ctx = await this.context(engineer, job.id);
    const issues: PlanResult["issues"] = [];
    const rows: OpsPlanStepRow[] = [];
    let needsApproval = false;
    // Steps that already ran stay, with their proofs; the new steps come after them.
    const kept = (await this.store.ops.steps.listForJob(job.id)).filter(
      (step) => step.status !== "planned",
    );
    const first = kept.reduce((next, step) => Math.max(next, step.position + 1), 0);
    for (const [index, step] of input.steps.entries()) {
      const position = first + index;
      const action = this.actions.get(step.action);
      if (!action) {
        issues.push({ position, action: step.action, reason: "There is no such action." });
        continue;
      }
      const parsed = action.input.safeParse(step.inputs);
      if (!parsed.success) {
        issues.push({
          position,
          action: step.action,
          reason: `Inputs: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(inputs)"} ${issue.message}`).join("; ")}`,
        });
        continue;
      }
      const inputs = parsed.data as Record<string, unknown>;
      const risk = riskOf(action, inputs);
      const environment = action.environment ? await action.environment(ctx, inputs) : null;
      const verdict = decide({
        actor: "ops",
        paused: engineer.paused,
        risk,
        environment,
        alreadyTried: false,
        inApprovedPlan: false,
        confirmed: false,
        freeUse: action.freeUse === true,
      });
      // A step only an approved plan can make possible is fine: that is what the plan is for.
      if (verdict.verdict === "refuse") {
        issues.push({ position, action: step.action, reason: verdict.reason });
        continue;
      }
      if (verdict.verdict === "ask") needsApproval = true;
      rows.push({
        id: newId("opsStep"),
        jobId: job.id,
        position,
        action: action.name,
        inputs: JSON.stringify(inputs),
        inputsHash: inputsHash(action.name, inputs),
        words: action.words(inputs),
        risk,
        undo: action.undo?.(inputs) ?? null,
        confirmedBy: null,
        confirmedAt: null,
        status: "planned",
        result: null,
        startedAt: null,
        finishedAt: null,
      });
    }
    if (issues.length > 0) return { ok: false, issues, job: null };
    await this.store.ops.steps.markReplaced(job.id);
    await this.store.ops.steps.replacePlanned(job.id, rows);
    const planHash = createHash("sha256")
      .update(rows.map((row) => `${row.action}:${row.inputsHash}`).join("\n"))
      .digest("hex")
      .slice(0, 32);
    const now = new Date().toISOString();
    await this.store.ops.jobs.update(job.id, {
      stage: needsApproval ? "approve" : "act",
      planHash,
      planApprovedBy: null,
      planApprovedAt: null,
      updatedAt: now,
    });
    const waiting = needsApproval ? " It waits for your approval." : "";
    await this.message(
      job.id,
      "system",
      null,
      `Plan proposed: ${rows.length} step${rows.length === 1 ? "" : "s"}.${waiting}`,
    );
    const updated = (await this.store.ops.jobs.findById(job.id)) as OpsJobRow;
    return { ok: true, issues: [], job: await this.detail(null, updated) };
  }

  /** The engineer does one thing. The gate decides; the server proves. */
  async perform(jobId: string, name: string, rawInputs: unknown): Promise<PerformResult> {
    const job = await this.liveJob(jobId);
    const engineer = await this.engineerOf(job.teamId);
    const action = this.actions.get(name);
    if (!action) {
      return refused(0, `There is no action called ${name}.`);
    }
    const parsed = action.input.safeParse(rawInputs ?? {});
    if (!parsed.success) {
      return refused(
        0,
        `Inputs: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(inputs)"} ${issue.message}`).join("; ")}`,
      );
    }
    const inputs = parsed.data as Record<string, unknown>;
    let ctx = await this.context(engineer, job.id);
    const risk = riskOf(action, inputs);
    // The habits: look first, plan, then act. Changes happen only once the plan stands.
    // Ops's own notes (sheets, wishes, lessons) touch nothing outside it: written at any stage,
    // above all while recording what happened.
    if (risk !== "read" && job.stage !== "act" && !action.freeUse) {
      return refused(
        0,
        job.stage === "approve"
          ? "The plan is waiting for a person's approval; nothing changes until then."
          : "Propose a plan first. Changes happen once it stands.",
      );
    }
    const hash = inputsHash(action.name, inputs);
    const steps = await this.store.ops.steps.listForJob(job.id);
    const step =
      steps.find(
        (candidate) =>
          candidate.action === action.name &&
          candidate.inputsHash === hash &&
          candidate.status === "planned",
      ) ?? null;
    const environment = action.environment ? await action.environment(ctx, inputs) : null;
    // The same attempt again is refused, unless it failed and something else in this job has
    // succeeded since: then the world it failed in has changed, and trying again is reasonable.
    const previous =
      risk === "read" ? null : await this.store.ops.attempts.find(job.id, action.name, hash);
    let alreadyTried = false;
    if (previous) {
      const changedSince = (await this.store.ops.attempts.listForJob(job.id)).some(
        (attempt) =>
          attempt.id !== previous.id &&
          attempt.ok === true &&
          attempt.createdAt > previous.createdAt,
      );
      alreadyTried = previous.ok !== false || !changedSince;
    }
    const verdict = decide({
      actor: "ops",
      paused: engineer.paused,
      risk,
      environment,
      alreadyTried,
      inApprovedPlan: step !== null && job.planApprovedAt !== null,
      confirmed: step?.confirmedAt !== null && step?.confirmedAt !== undefined,
      freeUse: action.freeUse === true,
    });
    if (verdict.verdict !== "run") {
      return { verdict, outcome: null, proof: null, step: null };
    }
    // What lessons switched on runs now, before the step starts, whether Ops remembers them or not.
    if (risk !== "read") {
      const check = await this.memory.preCheck(ctx, action, inputs, environment);
      if (!check.ok) {
        const reason = `A check from what Ops learned stopped this step: ${check.reasons.join(" ")}`;
        return {
          verdict:
            check.verdict === "ask"
              ? { verdict: "ask", rule: 12, reason }
              : { verdict: "refuse", rule: 12, reason },
          outcome: null,
          proof: null,
          step: null,
        };
      }
    }
    // Run as the approved step: what it starts carries the approval with it (and only then).
    if (step && job.planApprovedAt !== null) {
      ctx = await this.context(engineer, job.id, {
        stepId: step.id,
        approvedBy: job.planApprovedBy,
      });
    }

    const now = () => new Date().toISOString();
    let attemptId: string | null = null;
    if (risk !== "read" && previous) {
      attemptId = previous.id;
      await this.store.ops.attempts.retry(previous.id, now());
    } else if (risk !== "read") {
      attemptId = newId("opsAttempt");
      const first = await this.store.ops.attempts.record({
        id: attemptId,
        jobId: job.id,
        action: action.name,
        inputsHash: hash,
        ok: null,
        detail: null,
        createdAt: now(),
      });
      if (!first) return refused(6, "Exactly this was already tried in this job.");
    }
    if (step) await this.store.ops.steps.update(step.id, { status: "running", startedAt: now() });

    let outcome: ActionOutcome;
    try {
      outcome = await action.run(ctx, inputs);
    } catch (error) {
      outcome = { ok: false, summary: (error as Error).message };
    }
    let proof: ProofResult | null = null;
    if (risk !== "read" && outcome.ok && action.prove) {
      try {
        proof = await action.prove(ctx, inputs, outcome);
      } catch (error) {
        proof = { kind: "error", target: action.name, ok: false, detail: (error as Error).message };
      }
      await this.store.ops.proofs.create({
        id: newId("opsProof"),
        jobId: job.id,
        stepId: step?.id ?? null,
        kind: proof.kind,
        target: proof.target,
        ok: proof.ok,
        detail: proof.detail,
        createdAt: now(),
      });
    }
    const status: OpsStepStatus =
      risk === "read"
        ? outcome.ok
          ? "done"
          : "failed"
        : !outcome.ok
          ? "failed"
          : proof === null
            ? "not_verified"
            : proof.ok
              ? "done"
              : "failed";
    if (attemptId) {
      await this.store.ops.attempts.settle(
        attemptId,
        status === "done",
        outcome.summary.slice(0, 2000),
      );
    }
    if (step) {
      await this.store.ops.steps.update(step.id, {
        status,
        result: outcome.summary.slice(0, 2000),
        finishedAt: now(),
      });
    }
    if (risk !== "read") {
      await this.access.recordChange(ctx.user, {
        teamId: job.teamId,
        action: "ops.acted",
        detail: {
          jobId: job.id,
          action: action.name,
          status,
          summary: outcome.summary.slice(0, 300),
        },
      });
    }
    // Every planned step over and proven: the job moves on to writing it down.
    const after = await this.store.ops.steps.listForJob(job.id);
    if (
      after.length > 0 &&
      after.every((row) => STEP_FINAL.has(row.status as OpsStepStatus)) &&
      after.every((row) => SETTLED.has(row.status))
    ) {
      await this.store.ops.jobs.update(job.id, { stage: "record", updatedAt: now() });
    }
    return { verdict, outcome, proof, step: step ? { id: step.id, status } : null };
  }

  /** The engineer finishes. "Done" needs every step proven; anything else is reported as it is. */
  async finish(
    jobId: string,
    input: { outcome: string; failed?: boolean },
    /** Post the outcome as Ops's message; the brain says it in its own reply instead. */
    options: { announce?: boolean } = {},
  ): Promise<OpsJobDetail> {
    const job = await this.liveJob(jobId);
    const steps = await this.store.ops.steps.listForJob(job.id);
    const now = new Date().toISOString();
    if (!input.failed) {
      const unproven = steps.filter((step) => !SETTLED.has(step.status));
      if (unproven.length > 0) {
        throw ZelyqError.badRequest(
          `Not done: these steps are not proven yet — ${unproven.map((step) => `${step.position + 1}. ${step.words} (${step.status})`).join("; ")}. Finish them, or finish as failed and say what is left.`,
        );
      }
    }
    await this.store.ops.jobs.update(job.id, {
      stage: input.failed ? "failed" : "done",
      outcome: input.outcome.slice(0, 4000),
      finishedAt: now,
      updatedAt: now,
    });
    if (options.announce !== false) await this.message(job.id, "ops", null, input.outcome);
    const engineer = await this.engineerOf(job.teamId);
    await this.access.recordChange(await this.engineers.account(engineer), {
      teamId: job.teamId,
      action: "ops.job_finished",
      detail: { jobId: job.id, failed: input.failed === true },
    });
    return this.detail(null, (await this.store.ops.jobs.findById(job.id)) as OpsJobRow);
  }

  /** How many lessons were learned from this job. */
  async lessonsFromJob(jobId: string): Promise<number> {
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job) return 0;
    return (await this.store.ops.lessons.listForTeam(job.teamId)).filter(
      (lesson) => lesson.evidenceJobId === jobId,
    ).length;
  }

  /** A planned step's exact inputs, as approved: what run_step carries out. */
  async stepInputs(stepId: string): Promise<Record<string, unknown>> {
    const step = await this.store.ops.steps.findById(stepId);
    if (!step) throw ZelyqError.notFound("Step", stepId);
    return JSON.parse(step.inputs) as Record<string, unknown>;
  }

  /** The team a job belongs to. */
  async teamOf(jobId: string): Promise<string | null> {
    return (await this.store.ops.jobs.findById(jobId))?.teamId ?? null;
  }

  /** The job as the engineer sees it (no viewer): its plan, steps, proofs and conversation. */
  async engineerView(jobId: string): Promise<OpsJobDetail> {
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job) throw ZelyqError.notFound("Job", jobId);
    return this.detail(null, job);
  }

  /** A person says more in a job that is still going. */
  async addPersonMessage(user: User, teamId: string, jobId: string, text: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const job = await this.jobOf(teamId, jobId);
    if (FINAL.has(job.stage as OpsStage)) throw ZelyqError.badRequest(`This job is ${job.stage}.`);
    await this.message(job.id, "person", user.id, text.slice(0, 4000));
  }

  /** A note from Zelyq itself in a job: an error, a limit reached. */
  async systemNote(jobId: string, text: string): Promise<void> {
    await this.message(jobId, "system", null, text.slice(0, 4000));
  }

  /** What the engineer says to the person in the job. */
  async say(jobId: string, text: string): Promise<void> {
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job) throw ZelyqError.notFound("Job", jobId);
    await this.message(job.id, "ops", null, text.slice(0, 8000));
  }

  async addTokens(jobId: string, tokensIn: number, tokensOut: number): Promise<void> {
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job) return;
    await this.store.ops.jobs.update(job.id, {
      tokensIn: job.tokensIn + tokensIn,
      tokensOut: job.tokensOut + tokensOut,
    });
  }

  // ------------------------------------------------------- outside agents

  /** The list, for the gateway: outside agents get the same hands (072 §2.1). */
  get actionList(): ActionList {
    return this.actions;
  }

  /**
   * One action for someone who is not Ops: an outside agent looking (`user` is
   * the person it works for), or a person carrying out an agent's request they
   * approved. Never anything that changes Ops's own limits; never on a frozen
   * environment. A change is proven the same way as Ops's own.
   */
  async performFor(
    user: User,
    teamId: string,
    name: string,
    rawInputs: unknown,
    options: { changesAllowed: boolean },
  ): Promise<{ outcome: ActionOutcome; proof: ProofResult | null }> {
    const action = this.actions.get(name);
    if (!action) throw ZelyqError.badRequest(`There is no action called ${name}.`);
    const parsed = action.input.safeParse(rawInputs ?? {});
    if (!parsed.success) {
      throw ZelyqError.badRequest(
        `Inputs: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(inputs)"} ${issue.message}`).join("; ")}`,
      );
    }
    const inputs = parsed.data as Record<string, unknown>;
    const risk = riskOf(action, inputs);
    if (risk === "own-limits") {
      throw new ZelyqError("forbidden", "Only a person changes Ops's own limits, on the Ops page.");
    }
    if (risk !== "read" && !options.changesAllowed) {
      throw new ZelyqError(
        "forbidden",
        "This changes something: it waits for a person's approval.",
      );
    }
    const ctx: ActionContext = {
      teamId,
      user,
      jobId: null,
      services: { store: this.store, ...this.services },
      approval: null,
      grantRun: async () => undefined,
      say: async () => undefined,
    };
    const environment = action.environment ? await action.environment(ctx, inputs) : null;
    if (environment?.frozen && risk !== "read") {
      throw ZelyqError.badRequest(`${environment.name} is frozen; nothing changes there now.`);
    }
    const outcome = await action.run(ctx, inputs);
    let proof: ProofResult | null = null;
    if (risk !== "read" && outcome.ok && action.prove) {
      proof = await action.prove(ctx, inputs, outcome).catch((error: Error) => ({
        kind: "error",
        target: name,
        ok: false,
        detail: error.message,
      }));
    }
    if (risk !== "read") {
      await this.access.recordChange(user, {
        teamId,
        action: "ops.acted",
        detail: {
          action: name,
          by: "an outside agent's approved request",
          summary: outcome.summary.slice(0, 300),
        },
      });
    }
    return { outcome, proof };
  }

  // --------------------------------------------------------------- pipelines

  /** A run started for an approved plan step: its protected deploy is not asked a second time. */
  async grantRun(input: {
    jobId: string;
    stepId: string | null;
    runId: string;
    environmentId: string;
    approvedBy: string | null;
  }): Promise<void> {
    await this.store.ops.grants.create({ ...input, createdAt: new Date().toISOString() });
  }

  /** The engine's question before asking an admin about a protected deploy. */
  async preApproved(run: PipelineRunRow, environmentId: string): Promise<boolean> {
    const grant = await this.store.ops.grants.findByRun(run.id);
    return grant !== null && grant.environmentId === environmentId;
  }

  // ----------------------------------------------------------------- helpers

  private async requirePerson(user: User): Promise<void> {
    if (await this.store.users.isService(user.id)) {
      throw new ZelyqError("forbidden", "Ops cannot approve or ask for its own work.");
    }
  }

  private async jobOf(teamId: string, jobId: string): Promise<OpsJobRow> {
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job || job.teamId !== teamId) throw ZelyqError.notFound("Job", jobId);
    return job;
  }

  /** A job the engineer may still work on. */
  private async liveJob(jobId: string): Promise<OpsJobRow> {
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job) throw ZelyqError.notFound("Job", jobId);
    if (FINAL.has(job.stage as OpsStage)) {
      throw ZelyqError.badRequest(`This job is ${job.stage}; start a new one for more work.`);
    }
    return job;
  }

  private async engineerOf(teamId: string): Promise<OpsEngineerRow> {
    const engineer = await this.engineers.find(teamId);
    if (!engineer) throw new ZelyqError("forbidden", "Ops is not set up in this team.");
    return engineer;
  }

  private async context(
    engineer: OpsEngineerRow,
    jobId: string | null,
    approval: ActionContext["approval"] = null,
  ): Promise<ActionContext> {
    return {
      teamId: engineer.teamId,
      user: await this.engineers.account(engineer),
      jobId,
      services: { store: this.store, ...this.services },
      approval,
      grantRun: async (runId, environmentId) => {
        if (!jobId || !approval) return;
        await this.grantRun({
          jobId,
          stepId: approval.stepId,
          runId,
          environmentId,
          approvedBy: approval.approvedBy,
        });
      },
      say: async (text) => {
        if (jobId) await this.message(jobId, "ops", null, text);
      },
    };
  }

  /** Admin when any step touches a protected environment or cannot be undone; else editor. */
  private async approverRole(job: OpsJobRow, steps: OpsPlanStepRow[]): Promise<Role> {
    const engineer = await this.engineerOf(job.teamId);
    const ctx = await this.context(engineer, job.id);
    for (const step of steps) {
      if (step.risk === "always-ask") return "admin";
      const action = this.actions.get(step.action);
      const environment = action?.environment
        ? await action.environment(ctx, JSON.parse(step.inputs) as Record<string, unknown>)
        : null;
      if (environment?.protected) return "admin";
    }
    return "editor";
  }

  private async message(
    jobId: string,
    role: OpsMessage["role"],
    userId: string | null,
    text: string,
  ): Promise<void> {
    await this.store.ops.messages.create({
      id: newId("opsMessage"),
      jobId,
      role,
      userId,
      text,
      createdAt: new Date().toISOString(),
    });
  }

  private summary(row: OpsJobRow): OpsJobSummary {
    return {
      id: row.id,
      kind: row.kind as OpsJobKind,
      request: row.request,
      stage: row.stage as OpsStage,
      source: row.source,
      askedBy: row.askedBy,
      outcome: row.outcome,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      tokens: row.tokensIn + row.tokensOut,
    };
  }

  /** The job as a person reads it. `viewer` null: as the engineer sees it. */
  private async detail(viewer: User | null, row: OpsJobRow): Promise<OpsJobDetail> {
    const [steps, proofs, messages] = await Promise.all([
      this.store.ops.steps.listForJob(row.id),
      this.store.ops.proofs.listForJob(row.id),
      this.store.ops.messages.listForJob(row.id),
    ]);
    const engineer = await this.engineers.find(row.teamId);
    const ctx = engineer ? await this.context(engineer, row.id) : null;
    const names = new Map<string, string>();
    for (const id of new Set(
      messages.map((message) => message.userId).filter(Boolean) as string[],
    )) {
      const person = await this.store.users.findById(id);
      if (person) names.set(id, person.name);
    }
    const presented: OpsPlanStep[] = [];
    for (const step of steps) {
      const proof = [...proofs].reverse().find((candidate) => candidate.stepId === step.id) ?? null;
      let needsApproval = false;
      if (step.status === "planned" && ctx && engineer) {
        const action = this.actions.get(step.action);
        const inputs = JSON.parse(step.inputs) as Record<string, unknown>;
        const environment: OpsEnvironmentRef | null = action?.environment
          ? await action.environment(ctx, inputs)
          : null;
        needsApproval =
          decide({
            actor: "ops",
            paused: false,
            risk: step.risk as OpsRisk,
            environment,
            alreadyTried: false,
            inApprovedPlan: row.planApprovedAt !== null,
            confirmed: step.confirmedAt !== null,
            freeUse: action?.freeUse === true,
          }).verdict === "ask";
      }
      presented.push({
        id: step.id,
        position: step.position,
        action: step.action,
        words: step.words,
        risk: step.risk as OpsRisk,
        undo: step.undo,
        needsApproval,
        status: step.status as OpsStepStatus,
        result: step.result,
        proof: proof
          ? {
              kind: proof.kind,
              target: proof.target,
              ok: proof.ok,
              detail: proof.detail,
              at: proof.createdAt,
            }
          : null,
      });
    }
    let canApprove = false;
    let approveBlockedBy: string | null = null;
    if (viewer && row.stage === "approve") {
      const needed = await this.approverRole(row, steps);
      const role = await this.store.teams.roleOf(row.teamId, viewer.id);
      canApprove = role !== null && roleAtLeast(role, needed);
      if (!canApprove) {
        approveBlockedBy =
          needed === "admin"
            ? "This plan touches a protected environment or cannot be undone: a team admin approves it."
            : "An editor or admin approves this plan.";
      }
    }
    return {
      ...this.summary(row),
      steps: presented,
      planHash: row.planHash,
      planApprovedBy: row.planApprovedBy
        ? (names.get(row.planApprovedBy) ??
          (await this.store.users.findById(row.planApprovedBy))?.name ??
          null)
        : null,
      planApprovedAt: row.planApprovedAt,
      canApprove,
      approveBlockedBy,
      ...this.liveState(row.id),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role as OpsMessage["role"],
        author:
          message.role === "ops"
            ? "Ops"
            : message.userId
              ? (names.get(message.userId) ?? null)
              : null,
        text: message.text,
        at: message.createdAt,
      })),
    };
  }
}

function refused(rule: number, reason: string): PerformResult {
  return { verdict: { verdict: "refuse", rule, reason }, outcome: null, proof: null, step: null };
}
