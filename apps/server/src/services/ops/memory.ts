import { newId, parsePipelineFile, type User, ZelyqError } from "@zelyq/core";
import type { OpsGuardRow, OpsLessonRow, OpsPreferenceRow, OpsSheetRow, Store } from "@zelyq/db";
import { z } from "zod";
import type { AccessControl } from "../access.js";
import { appSlug } from "../pipelines/steps.js";
import type { ActionContext, OpsAction, OpsEnvironmentRef } from "./actions.js";
import { proveDeployment } from "./catalogue/shared.js";

/**
 * Ops's memory (072 §2.12). A model does not learn by itself, so Ops's
 * memory and its learning live here: what it knows about each thing (sheets),
 * what the team wants (wishes), what it learned (lessons), and the checks
 * those lessons switched on (guards), which the server runs before a step
 * whether Ops remembers them or not.
 */

const SCOPE = z
  .string()
  .trim()
  .regex(
    /^(team|app:[a-z0-9][a-z0-9-]{0,39}|environment:[a-z][a-z0-9-]{0,39}|machine:[A-Za-z0-9._-]{1,63})$/,
    'A scope: "team", "app:shop", "environment:production" or "machine:box".',
  );

const SUBJECT = z
  .string()
  .trim()
  .regex(
    /^(app:[a-z0-9][a-z0-9-]{0,39}|environment:[a-z][a-z0-9-]{0,39}|machine:[A-Za-z0-9._-]{1,63})$/,
    'What the sheet is about: "app:shop", "environment:production" or "machine:box".',
  );

const TIME = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "A time like 14:30.");

/**
 * The checks a lesson can switch on. A fixed catalogue in code: Ops chooses a
 * kind and fills its parameters; a new kind is a change to Zelyq, never to a
 * lesson, so a lesson can never become code.
 */
export const GUARD_KINDS = {
  secrets_present: {
    params: z.object({}).strict(),
    words: () => "every Vault secret the environment gives apps exists",
  },
  disk_space: {
    params: z.object({ minFreeGb: z.number().min(1).max(100_000) }).strict(),
    words: (params: { minFreeGb: number }) =>
      `the machine has at least ${params.minFreeGb} GB free`,
  },
  staging_first: {
    params: z.object({ staging: z.string().min(1).max(40) }).strict(),
    words: (params: { staging: string }) =>
      `the app is live and answering on ${params.staging} first`,
  },
  allowed_time: {
    params: z
      .object({
        deny: z
          .array(
            z
              .object({
                /** 0 = Sunday … 6 = Saturday. */
                days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
                from: TIME,
                to: TIME,
              })
              .strict(),
          )
          .min(1)
          .max(10),
      })
      .strict(),
    words: () => "it is not a time the team said no changes",
  },
  block_action: {
    params: z.object({ action: z.string().min(1).max(100) }).strict(),
    words: (params: { action: string }) => `${params.action} is done by a person`,
  },
} as const;
export type GuardKind = keyof typeof GUARD_KINDS;

/** Actions a check about deploys applies to. */
const DEPLOYING = new Set([
  "run_pipeline",
  "promote",
  "rollback",
  "restart_app",
  "set_app_address",
]);

export interface PreCheck {
  ok: boolean;
  /** "ask": a block, a person does it. "refuse": a pre-check failed. */
  verdict: "run" | "ask" | "refuse";
  reasons: string[];
  lessons: string[];
}

const lessonInput = z
  .object({
    what: z.string().trim().min(1).max(1000),
    why: z.string().trim().min(1).max(1000),
    rule: z.string().trim().min(1).max(1000),
    scope: SCOPE.default("team"),
    /** What it was learned from: a step of this job that failed, or what a person said in it. */
    evidence: z
      .object({
        /** The plan step's number, as run_step and job_state show it. */
        step: z.number().int().min(1).optional(),
        stepId: z.string().optional(),
        messageId: z.string().optional(),
      })
      .strict()
      .refine(
        (value) =>
          [value.step, value.stepId, value.messageId].filter((part) => part !== undefined)
            .length === 1,
        "Give the step's number (or a messageId).",
      ),
    /** A check to switch on so it cannot happen again, from the catalogue. */
    guard: z
      .object({
        kind: z.enum(Object.keys(GUARD_KINDS) as [GuardKind, ...GuardKind[]]),
        params: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LessonInput = z.input<typeof lessonInput>;

export class OpsMemory {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
  ) {}

  // -------------------------------------------------------- what Ops reads

  /**
   * What Ops reads first in a job: the sheets of what the job is about, the
   * team's wishes, the lessons that apply and the checks switched on, and its
   * last few jobs. Gathered by the server from records, not by Ops choosing to
   * look. Only what applies, so it stays short as history grows.
   */
  async openingContext(teamId: string, subjects: string[] = []): Promise<string> {
    const [sheets, wishes, lessons, guards, jobs] = await Promise.all([
      this.store.ops.sheets.listForTeam(teamId),
      this.store.ops.preferences.listForTeam(teamId),
      this.store.ops.lessons.listForTeam(teamId),
      this.store.ops.guards.listForTeam(teamId),
      this.store.ops.jobs.listForTeam(teamId, 8),
    ]);
    const applies = (scope: string) =>
      scope === "team" || subjects.length === 0 || subjects.includes(scope);
    const parts: string[] = [];
    const relevantSheets = sheets.filter(
      (sheet) => subjects.length === 0 || subjects.includes(sheet.subject),
    );
    if (relevantSheets.length) {
      parts.push(
        `What you know (operations sheets, kept by you; check them against the real machines):\n${relevantSheets
          .slice(0, 10)
          .map((sheet) => `### ${sheet.subject} (v${sheet.version})\n${sheet.body.slice(0, 3000)}`)
          .join("\n\n")}`,
      );
    }
    const activeWishes = wishes.filter((wish) => wish.active && applies(wish.scope));
    if (activeWishes.length) {
      parts.push(
        `What the team wants (a person's word beats your own conclusions; newer beats older):\n${activeWishes
          .slice(0, 30)
          .map((wish) => `- ${wish.text}${wish.scope === "team" ? "" : ` (${wish.scope})`}`)
          .join("\n")}`,
      );
    }
    const activeLessons = lessons.filter(
      (lesson) => lesson.status === "active" && applies(lesson.scope),
    );
    if (activeLessons.length) {
      parts.push(
        `What you learned before (apply it):\n${activeLessons
          .slice(0, 30)
          .map(
            (lesson) =>
              `- ${lesson.rule} — because ${lesson.why}${lesson.scope === "team" ? "" : ` (${lesson.scope})`}`,
          )
          .join("\n")}`,
      );
    }
    const activeGuards = guards.filter((guard) => guard.active);
    if (activeGuards.length) {
      parts.push(
        `Checks Zelyq runs before your steps (a step that fails one does not start):\n${activeGuards
          .map(
            (guard) =>
              `- ${this.guardWords(guard)}${guard.scope === "team" ? "" : ` (${guard.scope})`}`,
          )
          .join("\n")}`,
      );
    }
    if (jobs.length) {
      parts.push(
        `Your last jobs here:\n${jobs
          .map(
            (job) =>
              `- ${job.createdAt.slice(0, 10)} "${job.request.slice(0, 120)}" → ${job.stage}${job.outcome ? `: ${job.outcome.slice(0, 160)}` : ""}`,
          )
          .join("\n")}`,
      );
    }
    return parts.join("\n\n");
  }

  /** "Have I seen this before?": lessons, wishes, sheets and past jobs that mention the words. */
  async recall(
    teamId: string,
    query: string,
  ): Promise<{ kind: string; text: string; at: string }[]> {
    const words = query
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 2);
    const hit = (text: string) => {
      const lower = text.toLowerCase();
      return words.filter((word) => lower.includes(word)).length;
    };
    const found: { kind: string; text: string; at: string; score: number }[] = [];
    for (const lesson of await this.store.ops.lessons.listForTeam(teamId)) {
      const text = `${lesson.what} — ${lesson.why} — ${lesson.rule}`;
      found.push({
        kind: `lesson (${lesson.status})`,
        text,
        at: lesson.createdAt,
        score: hit(text),
      });
    }
    for (const wish of await this.store.ops.preferences.listForTeam(teamId)) {
      found.push({ kind: "wish", text: wish.text, at: wish.createdAt, score: hit(wish.text) });
    }
    for (const sheet of await this.store.ops.sheets.listForTeam(teamId)) {
      found.push({
        kind: `sheet ${sheet.subject}`,
        text: sheet.body.slice(0, 1500),
        at: sheet.updatedAt,
        score: hit(sheet.body),
      });
    }
    for (const job of await this.store.ops.jobs.listForTeam(teamId, 200)) {
      const text = `${job.request} → ${job.stage}${job.outcome ? `: ${job.outcome}` : ""}`;
      found.push({ kind: "job", text, at: job.createdAt, score: hit(text) });
    }
    return found
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.at.localeCompare(a.at))
      .slice(0, 15)
      .map(({ kind, text, at }) => ({ kind, text, at }));
  }

  // ------------------------------------------------------ checks before steps

  /**
   * Runs every check switched on that applies to this step. A failed check
   * means the step does not start, and the reason names the lesson behind it.
   */
  async preCheck(
    ctx: ActionContext,
    action: OpsAction,
    inputs: Record<string, unknown>,
    environment: OpsEnvironmentRef | null,
  ): Promise<PreCheck> {
    const guards = (await this.store.ops.guards.listForTeam(ctx.teamId)).filter(
      (guard) => guard.active,
    );
    const result: PreCheck = { ok: true, verdict: "run", reasons: [], lessons: [] };
    const app = typeof inputs.app === "string" ? inputs.app : null;
    for (const guard of guards) {
      if (!this.inScope(guard.scope, environment, app)) continue;
      const params = JSON.parse(guard.params) as Record<string, unknown>;
      const problem = await this.runGuard(
        ctx,
        guard.kind as GuardKind,
        params,
        action,
        inputs,
        environment,
      );
      if (problem === null) continue;
      const lesson = guard.lessonId ? await this.store.ops.lessons.findById(guard.lessonId) : null;
      if (lesson) {
        await this.store.ops.lessons.update(lesson.id, { lastMatchedAt: new Date().toISOString() });
        result.lessons.push(lesson.rule);
      }
      result.ok = false;
      result.reasons.push(`${problem}${lesson ? ` (from the lesson: "${lesson.rule}")` : ""}`);
      if (guard.kind === "block_action") {
        if (result.verdict === "run") result.verdict = "ask";
      } else {
        result.verdict = "refuse";
      }
    }
    return result;
  }

  private inScope(
    scope: string,
    environment: OpsEnvironmentRef | null,
    app: string | null,
  ): boolean {
    if (scope === "team") return true;
    if (scope.startsWith("environment:")) return environment?.name === scope.slice(12);
    if (scope.startsWith("app:")) return app === scope.slice(4);
    return false;
  }

  /** One check: null when it passes, else what is wrong. */
  private async runGuard(
    ctx: ActionContext,
    kind: GuardKind,
    params: Record<string, unknown>,
    action: OpsAction,
    inputs: Record<string, unknown>,
    environment: OpsEnvironmentRef | null,
  ): Promise<string | null> {
    if (kind === "block_action") {
      return params.action === action.name ? `${action.name} is done by a person here.` : null;
    }
    if (kind === "allowed_time") {
      if (!environment) return null;
      const engineer = await this.store.ops.engineers.findByTeam(ctx.teamId);
      const zone = engineer?.timeZone ?? "UTC";
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        parts.find((part) => part.type === "weekday")?.value ?? "",
      );
      const time = `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`;
      const deny = (params.deny as { days: number[]; from: string; to: string }[]) ?? [];
      const window = deny.find(
        (entry) => entry.days.includes(day) && time >= entry.from && time <= entry.to,
      );
      return window
        ? `It is ${time} (${zone}) and the team said no changes then (${window.from}–${window.to}).`
        : null;
    }
    if (!DEPLOYING.has(action.name) || !environment) return null;
    const row = await this.store.deploy.environments.findByName(ctx.teamId, environment.name);
    if (!row) return null;
    if (kind === "secrets_present") {
      const stored = JSON.parse(row.variables) as Record<string, { vault?: string }>;
      const wanted = Object.values(stored).flatMap((entry) => (entry.vault ? [entry.vault] : []));
      if (wanted.length === 0) return null;
      const names = new Set(
        (await ctx.services.vault.list(ctx.user, { kind: "team", teamId: ctx.teamId })).map(
          (entry) => entry.name,
        ),
      );
      const missing = wanted.filter((name) => !names.has(name));
      return missing.length
        ? `${environment.name} needs ${missing.join(", ")} from Vault, and ${missing.length === 1 ? "it is" : "they are"} not there.`
        : null;
    }
    if (kind === "disk_space") {
      if (!row.runnerId) return null;
      const disk = await ctx.services.runners
        .disk(ctx.user, ctx.teamId, row.runnerId)
        .catch(() => null);
      const free = disk?.freeBytes ?? null;
      const min = Number(params.minFreeGb) * 1024 ** 3;
      return free !== null && free < min
        ? `The machine has ${(free / 1024 ** 3).toFixed(1)} GB free; at least ${params.minFreeGb} GB is needed.`
        : null;
    }
    if (kind === "staging_first") {
      const staging = String(params.staging ?? "");
      if (environment.name === staging) return null;
      const apps = new Set<string>();
      if (typeof inputs.app === "string") apps.add(inputs.app);
      if (typeof inputs.pipeline === "string") {
        const pipeline = await this.store.pipelines.pipelines.findByName(
          ctx.teamId,
          inputs.pipeline,
        );
        for (const name of pipeline ? deployedApps(pipeline.source) : []) apps.add(name);
      }
      for (const app of apps) {
        const proof = await proveDeployment(ctx, staging, app);
        if (!proof.ok)
          return `${app} is not live and answering on ${staging} (${proof.detail ?? "not found"}).`;
      }
      return null;
    }
    return null;
  }

  guardWords(guard: OpsGuardRow): string {
    const kind = GUARD_KINDS[guard.kind as GuardKind];
    if (!kind) return guard.kind;
    return `Before a step: ${(kind.words as (params: never) => string)(JSON.parse(guard.params) as never)}`;
  }

  // ---------------------------------------------------------------- learning

  /**
   * A lesson, from a job: only from what the server recorded there (a step
   * that failed or was not proven) or what a linked person said in it. Text
   * from logs and pages cannot become a lesson by itself. A guard it switches
   * on is checked against the catalogue.
   */
  async learn(
    jobId: string,
    raw: unknown,
  ): Promise<{ lesson: OpsLessonRow; guard: OpsGuardRow | null }> {
    const input = lessonInput.parse(raw);
    const job = await this.store.ops.jobs.findById(jobId);
    if (!job) throw ZelyqError.notFound("Job", jobId);
    let evidence: string;
    const stepId =
      input.evidence.stepId ??
      (input.evidence.step !== undefined
        ? (await this.store.ops.steps.listForJob(job.id)).find(
            (candidate) => candidate.position + 1 === input.evidence.step,
          )?.id
        : undefined);
    if (input.evidence.step !== undefined || input.evidence.stepId) {
      const step = stepId ? await this.store.ops.steps.findById(stepId) : null;
      if (
        !step ||
        step.jobId !== job.id ||
        !["failed", "not_verified", "replaced"].includes(step.status)
      ) {
        throw ZelyqError.badRequest(
          "A lesson comes from a step of this job that failed or was not proven.",
        );
      }
      evidence = `Step ${step.position + 1} "${step.words}": ${step.status}${step.result ? ` — ${step.result.slice(0, 300)}` : ""}`;
    } else {
      const message = (await this.store.ops.messages.listForJob(job.id)).find(
        (candidate) => candidate.id === input.evidence.messageId,
      );
      if (!message || message.role !== "person") {
        throw ZelyqError.badRequest(
          "A lesson from a person comes from what a person said in this job.",
        );
      }
      evidence = `A person said: "${message.text.slice(0, 500)}"`;
    }
    let guardRow: OpsGuardRow | null = null;
    const now = new Date().toISOString();
    const lesson: OpsLessonRow = {
      id: newId("opsLesson"),
      teamId: job.teamId,
      what: input.what,
      why: input.why,
      rule: input.rule,
      scope: input.scope,
      strength: input.guard
        ? input.guard.kind === "block_action"
          ? "block"
          : "precheck"
        : "reminder",
      source: input.evidence.messageId ? "person" : "review",
      evidenceJobId: job.id,
      evidence,
      status: "active",
      retiredReason: null,
      lastMatchedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    let params: Record<string, unknown> = {};
    if (input.guard) {
      const kind = GUARD_KINDS[input.guard.kind];
      const parsed = kind.params.safeParse(input.guard.params);
      if (!parsed.success) {
        throw ZelyqError.badRequest(
          `The ${input.guard.kind} check: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        );
      }
      params = parsed.data as Record<string, unknown>;
    }
    await this.store.ops.lessons.create(lesson);
    if (input.guard) {
      guardRow = {
        id: newId("opsGuard"),
        teamId: job.teamId,
        lessonId: lesson.id,
        kind: input.guard.kind,
        params: JSON.stringify(params),
        scope: input.scope,
        active: true,
        createdBy: "ops",
        switchedOffBy: null,
        createdAt: now,
        updatedAt: now,
      };
      await this.store.ops.guards.create(guardRow);
    }
    return { lesson, guard: guardRow };
  }

  /** What a person said that should hold from now on: saved at once. */
  async addWish(
    teamId: string,
    input: {
      text: string;
      scope?: string;
      source: "person" | "correction";
      jobId?: string | null;
      createdBy: string | null;
    },
  ): Promise<OpsPreferenceRow> {
    const now = new Date().toISOString();
    const row: OpsPreferenceRow = {
      id: newId("opsWish"),
      teamId,
      text: input.text.trim().slice(0, 1000),
      scope: SCOPE.parse(input.scope ?? "team"),
      source: input.source,
      jobId: input.jobId ?? null,
      createdBy: input.createdBy,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.ops.preferences.create(row);
    return row;
  }

  async writeSheet(
    teamId: string,
    subject: string,
    body: string,
    by: string,
  ): Promise<OpsSheetRow> {
    const parsed = SUBJECT.parse(subject);
    return this.store.ops.sheets.save(teamId, parsed, body.slice(0, 20_000), by, {
      sheet: newId("opsSheet"),
      version: newId("opsSheetVersion"),
    });
  }

  // ------------------------------------------------------- people, Memory tab

  async list(user: User, teamId: string) {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const [sheets, wishes, lessons, guards] = await Promise.all([
      this.store.ops.sheets.listForTeam(teamId),
      this.store.ops.preferences.listForTeam(teamId),
      this.store.ops.lessons.listForTeam(teamId),
      this.store.ops.guards.listForTeam(teamId),
    ]);
    return {
      sheets: sheets.map((sheet) => ({
        id: sheet.id,
        subject: sheet.subject,
        body: sheet.body,
        version: sheet.version,
        updatedBy: sheet.updatedBy === "ops" ? "Ops" : "a person",
        updatedAt: sheet.updatedAt,
      })),
      wishes: wishes.map((wish) => ({
        id: wish.id,
        text: wish.text,
        scope: wish.scope,
        source: wish.source,
        active: wish.active,
        createdAt: wish.createdAt,
      })),
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        what: lesson.what,
        why: lesson.why,
        rule: lesson.rule,
        scope: lesson.scope,
        strength: lesson.strength,
        source: lesson.source,
        evidence: lesson.evidence,
        status: lesson.status,
        retiredReason: lesson.retiredReason,
        lastMatchedAt: lesson.lastMatchedAt,
        createdAt: lesson.createdAt,
      })),
      guards: guards.map((guard) => ({
        id: guard.id,
        kind: guard.kind,
        words: this.guardWords(guard),
        scope: guard.scope,
        lessonId: guard.lessonId,
        active: guard.active,
        createdBy: guard.createdBy === "ops" ? "Ops" : "a person",
      })),
    };
  }

  async personAddWish(user: User, teamId: string, raw: unknown): Promise<OpsPreferenceRow> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const input = z
      .object({ text: z.string().trim().min(1).max(1000), scope: SCOPE.optional() })
      .strict()
      .parse(raw);
    return this.addWish(teamId, { ...input, source: "person", createdBy: user.id });
  }

  async personEditWish(user: User, teamId: string, id: string, raw: unknown): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const row = await this.store.ops.preferences.findById(id);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Wish", id);
    const input = z
      .object({
        text: z.string().trim().min(1).max(1000).optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    await this.store.ops.preferences.update(id, { ...input, updatedAt: new Date().toISOString() });
  }

  async personRemoveWish(user: User, teamId: string, id: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const row = await this.store.ops.preferences.findById(id);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Wish", id);
    await this.store.ops.preferences.remove(id);
  }

  /** A person edits a lesson, or retires it with the reason (kept, not deleted silently). */
  async personEditLesson(user: User, teamId: string, id: string, raw: unknown): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const row = await this.store.ops.lessons.findById(id);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Lesson", id);
    const input = z
      .object({
        what: z.string().trim().min(1).max(1000).optional(),
        why: z.string().trim().min(1).max(1000).optional(),
        rule: z.string().trim().min(1).max(1000).optional(),
        status: z.enum(["active", "retired"]).optional(),
        retiredReason: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(raw);
    await this.store.ops.lessons.update(id, { ...input, updatedAt: new Date().toISOString() });
  }

  async personRemoveLesson(user: User, teamId: string, id: string): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    await this.requirePerson(user);
    const row = await this.store.ops.lessons.findById(id);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Lesson", id);
    await this.store.ops.lessons.remove(id);
  }

  /** Only a person switches a check off (or on again): it is one of Ops's own limits. */
  async personSwitchGuard(user: User, teamId: string, id: string, active: boolean): Promise<void> {
    await this.access.requireTeamRole(user, teamId, "admin");
    await this.requirePerson(user);
    const row = await this.store.ops.guards.findById(id);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Check", id);
    await this.store.ops.guards.update(id, {
      active,
      switchedOffBy: active ? null : user.id,
      updatedAt: new Date().toISOString(),
    });
  }

  async personWriteSheet(user: User, teamId: string, raw: unknown): Promise<OpsSheetRow> {
    await this.access.requireTeamRole(user, teamId, "editor");
    await this.requirePerson(user);
    const input = z
      .object({ subject: SUBJECT, body: z.string().max(20_000) })
      .strict()
      .parse(raw);
    return this.writeSheet(teamId, input.subject, input.body, user.id);
  }

  private async requirePerson(user: User): Promise<void> {
    if (await this.store.users.isService(user.id)) {
      throw new ZelyqError("forbidden", "Only a person changes Ops's memory this way.");
    }
  }
}

/** The apps a pipeline deploys, named the way its deploy steps name them. */
function deployedApps(source: string): string[] {
  const parsed = parsePipelineFile(source);
  if (!parsed.ok) return [];
  const apps = new Set<string>();
  for (const stage of parsed.file.stages) {
    for (const step of stage.steps) {
      if (step.deploy)
        apps.add(step.deploy.app ?? appSlug(parsed.file.source?.app ?? parsed.file.name));
    }
  }
  return [...apps];
}
