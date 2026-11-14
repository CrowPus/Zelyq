import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  opsAlerts,
  opsAttempts,
  opsChannelLinks,
  opsChannels,
  opsCheckHours,
  opsChecks,
  opsEngineers,
  opsGuards,
  opsJobs,
  opsLessons,
  opsLinkCodes,
  opsMessages,
  opsNotifyPrefs,
  opsPlanSteps,
  opsPreferences,
  opsProofs,
  opsRunGrants,
  opsSheets,
  opsSheetVersions,
} from "../schema/sqlite.js";

export type OpsEngineerRow = typeof opsEngineers.$inferSelect;
export type OpsJobRow = typeof opsJobs.$inferSelect;
export type OpsPlanStepRow = typeof opsPlanSteps.$inferSelect;
export type OpsProofRow = typeof opsProofs.$inferSelect;
export type OpsAttemptRow = typeof opsAttempts.$inferSelect;
export type OpsMessageRow = typeof opsMessages.$inferSelect;
export type OpsRunGrantRow = typeof opsRunGrants.$inferSelect;
export type OpsSheetRow = typeof opsSheets.$inferSelect;
export type OpsSheetVersionRow = typeof opsSheetVersions.$inferSelect;
export type OpsPreferenceRow = typeof opsPreferences.$inferSelect;
export type OpsLessonRow = typeof opsLessons.$inferSelect;
export type OpsGuardRow = typeof opsGuards.$inferSelect;
export type OpsCheckRow = typeof opsChecks.$inferSelect;
export type OpsCheckHourRow = typeof opsCheckHours.$inferSelect;
export type OpsAlertRow = typeof opsAlerts.$inferSelect;
export type OpsChannelRow = typeof opsChannels.$inferSelect;
export type OpsChannelLinkRow = typeof opsChannelLinks.$inferSelect;
export type OpsLinkCodeRow = typeof opsLinkCodes.$inferSelect;
export type OpsNotifyPrefsRow = typeof opsNotifyPrefs.$inferSelect;

/**
 * The team's DevOps engineer (Ops): its jobs, plans, proofs and what it has
 * tried. Rows only: every rule about what Ops may do lives in the server's
 * `services/ops/`.
 */
export function opsRepository(db: ZelyqDb) {
  return {
    engineers: {
      /** Every team's engineer: the watch runs for all of them. */
      async listAll(): Promise<OpsEngineerRow[]> {
        return await db.select().from(opsEngineers);
      },
      async findByTeam(teamId: string): Promise<OpsEngineerRow | null> {
        const rows = await db
          .select()
          .from(opsEngineers)
          .where(eq(opsEngineers.teamId, teamId))
          .limit(1);
        return rows[0] ?? null;
      },
      async create(row: OpsEngineerRow): Promise<OpsEngineerRow> {
        await db.insert(opsEngineers).values(row);
        return row;
      },
      async update(id: string, patch: Partial<OpsEngineerRow>): Promise<OpsEngineerRow | null> {
        const [row] = await db
          .update(opsEngineers)
          .set(patch)
          .where(eq(opsEngineers.id, id))
          .returning();
        return row ?? null;
      },
    },

    jobs: {
      async create(row: OpsJobRow): Promise<OpsJobRow> {
        await db.insert(opsJobs).values(row);
        return row;
      },
      async findById(id: string): Promise<OpsJobRow | null> {
        const rows = await db.select().from(opsJobs).where(eq(opsJobs.id, id)).limit(1);
        return rows[0] ?? null;
      },
      async listForTeam(teamId: string, limit = 50): Promise<OpsJobRow[]> {
        return await db
          .select()
          .from(opsJobs)
          .where(eq(opsJobs.teamId, teamId))
          .orderBy(desc(opsJobs.createdAt))
          .limit(limit);
      },
      async update(id: string, patch: Partial<OpsJobRow>): Promise<OpsJobRow | null> {
        const [row] = await db.update(opsJobs).set(patch).where(eq(opsJobs.id, id)).returning();
        return row ?? null;
      },
      /** Adds a line to what Ops looked at and did in the job (the latest 300 are kept). */
      async appendActivity(id: string, line: string): Promise<void> {
        const [row] = await db
          .select({ activity: opsJobs.activity })
          .from(opsJobs)
          .where(eq(opsJobs.id, id))
          .limit(1);
        if (!row) return;
        let list: string[] = [];
        try {
          list = JSON.parse(row.activity) as string[];
        } catch {
          list = [];
        }
        list.push(line.slice(0, 300));
        await db
          .update(opsJobs)
          .set({ activity: JSON.stringify(list.slice(-300)) })
          .where(eq(opsJobs.id, id));
      },
      /**
       * Changes the job only if it is still at this stage with this plan, in
       * one write: a decision can never land on a plan that changed meanwhile.
       */
      async updateIf(
        id: string,
        expected: { stage: string; planHash: string },
        patch: Partial<OpsJobRow>,
      ): Promise<boolean> {
        const rows = await db
          .update(opsJobs)
          .set(patch)
          .where(
            and(
              eq(opsJobs.id, id),
              eq(opsJobs.stage, expected.stage),
              eq(opsJobs.planHash, expected.planHash),
            ),
          )
          .returning({ id: opsJobs.id });
        return rows.length === 1;
      },
    },

    steps: {
      /**
       * Replaces the steps of a job's plan that have not run. Steps that ran
       * (and their proofs) stay: planning again never rewrites what happened.
       */
      async replacePlanned(jobId: string, rows: OpsPlanStepRow[]): Promise<void> {
        await db
          .delete(opsPlanSteps)
          .where(and(eq(opsPlanSteps.jobId, jobId), eq(opsPlanSteps.status, "planned")));
        if (rows.length > 0) await db.insert(opsPlanSteps).values(rows);
      },
      /** A later plan takes the place of what failed or was not proven: it stays on record as replaced. */
      async markReplaced(jobId: string): Promise<void> {
        await db
          .update(opsPlanSteps)
          .set({ status: "replaced" })
          .where(
            and(
              eq(opsPlanSteps.jobId, jobId),
              inArray(opsPlanSteps.status, ["failed", "not_verified"]),
            ),
          );
      },
      async listForJob(jobId: string): Promise<OpsPlanStepRow[]> {
        return await db
          .select()
          .from(opsPlanSteps)
          .where(eq(opsPlanSteps.jobId, jobId))
          .orderBy(asc(opsPlanSteps.position));
      },
      async findById(id: string): Promise<OpsPlanStepRow | null> {
        const rows = await db.select().from(opsPlanSteps).where(eq(opsPlanSteps.id, id)).limit(1);
        return rows[0] ?? null;
      },
      /** Takes a planned step to run, in one write: false when it is no longer planned. */
      async claim(id: string, at: string): Promise<boolean> {
        const rows = await db
          .update(opsPlanSteps)
          .set({ status: "running", startedAt: at })
          .where(and(eq(opsPlanSteps.id, id), eq(opsPlanSteps.status, "planned")))
          .returning({ id: opsPlanSteps.id });
        return rows.length === 1;
      },
      async update(id: string, patch: Partial<OpsPlanStepRow>): Promise<OpsPlanStepRow | null> {
        const [row] = await db
          .update(opsPlanSteps)
          .set(patch)
          .where(eq(opsPlanSteps.id, id))
          .returning();
        return row ?? null;
      },
    },

    proofs: {
      async create(row: OpsProofRow): Promise<OpsProofRow> {
        await db.insert(opsProofs).values(row);
        return row;
      },
      async listForJob(jobId: string): Promise<OpsProofRow[]> {
        return await db
          .select()
          .from(opsProofs)
          .where(eq(opsProofs.jobId, jobId))
          .orderBy(asc(opsProofs.createdAt));
      },
    },

    attempts: {
      /** Records an attempt; false when this exact action was already tried in the job. */
      async record(row: OpsAttemptRow): Promise<boolean> {
        const done = await db
          .insert(opsAttempts)
          .values(row)
          .onConflictDoNothing({
            target: [opsAttempts.jobId, opsAttempts.action, opsAttempts.inputsHash],
          })
          .returning({ id: opsAttempts.id });
        return done.length > 0;
      },
      async find(jobId: string, action: string, inputsHash: string): Promise<OpsAttemptRow | null> {
        const rows = await db
          .select()
          .from(opsAttempts)
          .where(
            and(
              eq(opsAttempts.jobId, jobId),
              eq(opsAttempts.action, action),
              eq(opsAttempts.inputsHash, inputsHash),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      /** Tries an attempt again, once something has changed since it failed. */
      async retry(id: string, at: string): Promise<void> {
        await db
          .update(opsAttempts)
          .set({ ok: null, detail: null, createdAt: at })
          .where(eq(opsAttempts.id, id));
      },
      async settle(id: string, ok: boolean, detail: string | null): Promise<void> {
        await db
          .update(opsAttempts)
          .set({
            ok,
            detail,
            ...(ok ? {} : { failures: sql`${opsAttempts.failures} + 1` }),
          })
          .where(eq(opsAttempts.id, id));
      },
      async listForJob(jobId: string): Promise<OpsAttemptRow[]> {
        return await db
          .select()
          .from(opsAttempts)
          .where(eq(opsAttempts.jobId, jobId))
          .orderBy(asc(opsAttempts.createdAt));
      },
    },

    messages: {
      async create(row: OpsMessageRow): Promise<OpsMessageRow> {
        await db.insert(opsMessages).values(row);
        return row;
      },
      async listForJob(jobId: string): Promise<OpsMessageRow[]> {
        return await db
          .select()
          .from(opsMessages)
          .where(eq(opsMessages.jobId, jobId))
          .orderBy(asc(opsMessages.createdAt));
      },
    },

    sheets: {
      async find(teamId: string, subject: string): Promise<OpsSheetRow | null> {
        const rows = await db
          .select()
          .from(opsSheets)
          .where(and(eq(opsSheets.teamId, teamId), eq(opsSheets.subject, subject)))
          .limit(1);
        return rows[0] ?? null;
      },
      async listForTeam(teamId: string): Promise<OpsSheetRow[]> {
        return await db
          .select()
          .from(opsSheets)
          .where(eq(opsSheets.teamId, teamId))
          .orderBy(asc(opsSheets.subject));
      },
      /** Writes a sheet, keeping the version before it. */
      async save(
        teamId: string,
        subject: string,
        body: string,
        by: string,
        ids: { sheet: string; version: string },
      ): Promise<OpsSheetRow> {
        const now = new Date().toISOString();
        const existing = await this.find(teamId, subject);
        if (!existing) {
          const row: OpsSheetRow = {
            id: ids.sheet,
            teamId,
            subject,
            body,
            version: 1,
            updatedBy: by,
            updatedAt: now,
          };
          await db.insert(opsSheets).values(row);
          await db.insert(opsSheetVersions).values({
            id: ids.version,
            sheetId: row.id,
            version: 1,
            body,
            updatedBy: by,
            createdAt: now,
          });
          return row;
        }
        const version = existing.version + 1;
        const [row] = await db
          .update(opsSheets)
          .set({ body, version, updatedBy: by, updatedAt: now })
          .where(eq(opsSheets.id, existing.id))
          .returning();
        await db.insert(opsSheetVersions).values({
          id: ids.version,
          sheetId: existing.id,
          version,
          body,
          updatedBy: by,
          createdAt: now,
        });
        return row as OpsSheetRow;
      },
      async versions(sheetId: string): Promise<OpsSheetVersionRow[]> {
        return await db
          .select()
          .from(opsSheetVersions)
          .where(eq(opsSheetVersions.sheetId, sheetId))
          .orderBy(desc(opsSheetVersions.version));
      },
      async remove(id: string): Promise<void> {
        await db.delete(opsSheets).where(eq(opsSheets.id, id));
      },
    },

    preferences: {
      async create(row: OpsPreferenceRow): Promise<OpsPreferenceRow> {
        await db.insert(opsPreferences).values(row);
        return row;
      },
      async findById(id: string): Promise<OpsPreferenceRow | null> {
        const rows = await db
          .select()
          .from(opsPreferences)
          .where(eq(opsPreferences.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async listForTeam(teamId: string): Promise<OpsPreferenceRow[]> {
        return await db
          .select()
          .from(opsPreferences)
          .where(eq(opsPreferences.teamId, teamId))
          .orderBy(desc(opsPreferences.createdAt));
      },
      async update(id: string, patch: Partial<OpsPreferenceRow>): Promise<OpsPreferenceRow | null> {
        const [row] = await db
          .update(opsPreferences)
          .set(patch)
          .where(eq(opsPreferences.id, id))
          .returning();
        return row ?? null;
      },
      async remove(id: string): Promise<void> {
        await db.delete(opsPreferences).where(eq(opsPreferences.id, id));
      },
    },

    lessons: {
      async create(row: OpsLessonRow): Promise<OpsLessonRow> {
        await db.insert(opsLessons).values(row);
        return row;
      },
      async findById(id: string): Promise<OpsLessonRow | null> {
        const rows = await db.select().from(opsLessons).where(eq(opsLessons.id, id)).limit(1);
        return rows[0] ?? null;
      },
      async listForTeam(teamId: string): Promise<OpsLessonRow[]> {
        return await db
          .select()
          .from(opsLessons)
          .where(eq(opsLessons.teamId, teamId))
          .orderBy(desc(opsLessons.createdAt));
      },
      async update(id: string, patch: Partial<OpsLessonRow>): Promise<OpsLessonRow | null> {
        const [row] = await db
          .update(opsLessons)
          .set(patch)
          .where(eq(opsLessons.id, id))
          .returning();
        return row ?? null;
      },
      async remove(id: string): Promise<void> {
        await db.delete(opsLessons).where(eq(opsLessons.id, id));
      },
    },

    guards: {
      async create(row: OpsGuardRow): Promise<OpsGuardRow> {
        await db.insert(opsGuards).values(row);
        return row;
      },
      async findById(id: string): Promise<OpsGuardRow | null> {
        const rows = await db.select().from(opsGuards).where(eq(opsGuards.id, id)).limit(1);
        return rows[0] ?? null;
      },
      async listForTeam(teamId: string): Promise<OpsGuardRow[]> {
        return await db
          .select()
          .from(opsGuards)
          .where(eq(opsGuards.teamId, teamId))
          .orderBy(desc(opsGuards.createdAt));
      },
      async update(id: string, patch: Partial<OpsGuardRow>): Promise<OpsGuardRow | null> {
        const [row] = await db.update(opsGuards).set(patch).where(eq(opsGuards.id, id)).returning();
        return row ?? null;
      },
      async remove(id: string): Promise<void> {
        await db.delete(opsGuards).where(eq(opsGuards.id, id));
      },
    },

    grants: {
      async create(row: OpsRunGrantRow): Promise<OpsRunGrantRow> {
        await db.insert(opsRunGrants).values(row);
        return row;
      },
      async findByRun(runId: string): Promise<OpsRunGrantRow | null> {
        const rows = await db
          .select()
          .from(opsRunGrants)
          .where(eq(opsRunGrants.runId, runId))
          .limit(1);
        return rows[0] ?? null;
      },
    },

    checks: {
      async listForTeam(teamId: string): Promise<OpsCheckRow[]> {
        return await db
          .select()
          .from(opsChecks)
          .where(eq(opsChecks.teamId, teamId))
          .orderBy(asc(opsChecks.createdAt));
      },
      async findById(id: string): Promise<OpsCheckRow | null> {
        const rows = await db.select().from(opsChecks).where(eq(opsChecks.id, id)).limit(1);
        return rows[0] ?? null;
      },
      async create(row: OpsCheckRow): Promise<OpsCheckRow> {
        await db.insert(opsChecks).values(row);
        return row;
      },
      async update(id: string, patch: Partial<OpsCheckRow>): Promise<void> {
        await db.update(opsChecks).set(patch).where(eq(opsChecks.id, id));
      },
      async remove(id: string): Promise<void> {
        await db.delete(opsChecks).where(eq(opsChecks.id, id));
      },
    },

    checkHours: {
      /** Adds one result to its hour's row. */
      async record(checkId: string, hour: string, passed: boolean, ms: number): Promise<void> {
        await db
          .insert(opsCheckHours)
          .values({ checkId, hour, runs: 1, passed: passed ? 1 : 0, totalMs: ms, slowestMs: ms })
          .onConflictDoUpdate({
            target: [opsCheckHours.checkId, opsCheckHours.hour],
            set: {
              runs: sql`${opsCheckHours.runs} + 1`,
              passed: sql`${opsCheckHours.passed} + ${passed ? 1 : 0}`,
              totalMs: sql`${opsCheckHours.totalMs} + ${ms}`,
              // CASE, not max(a, b): the same SQL in SQLite and Postgres.
              slowestMs: sql`case when ${opsCheckHours.slowestMs} > ${ms} then ${opsCheckHours.slowestMs} else ${ms} end`,
            },
          });
      },
      async listSince(checkIds: string[], fromHour: string): Promise<OpsCheckHourRow[]> {
        if (checkIds.length === 0) return [];
        return await db
          .select()
          .from(opsCheckHours)
          .where(
            and(
              inArray(opsCheckHours.checkId, checkIds),
              sql`${opsCheckHours.hour} >= ${fromHour}`,
            ),
          )
          .orderBy(asc(opsCheckHours.hour));
      },
      /** Hours older than this are forgotten. */
      async prune(beforeHour: string): Promise<void> {
        await db.delete(opsCheckHours).where(sql`${opsCheckHours.hour} < ${beforeHour}`);
      },
    },

    alerts: {
      async create(row: OpsAlertRow): Promise<OpsAlertRow> {
        await db.insert(opsAlerts).values(row);
        return row;
      },
      async findById(id: string): Promise<OpsAlertRow | null> {
        const rows = await db.select().from(opsAlerts).where(eq(opsAlerts.id, id)).limit(1);
        return rows[0] ?? null;
      },
      async openForCheck(checkId: string): Promise<OpsAlertRow | null> {
        const rows = await db
          .select()
          .from(opsAlerts)
          .where(and(eq(opsAlerts.checkId, checkId), sql`${opsAlerts.closedAt} is null`))
          .limit(1);
        return rows[0] ?? null;
      },
      async listOpen(teamId?: string): Promise<OpsAlertRow[]> {
        return await db
          .select()
          .from(opsAlerts)
          .where(
            teamId
              ? and(eq(opsAlerts.teamId, teamId), sql`${opsAlerts.closedAt} is null`)
              : sql`${opsAlerts.closedAt} is null`,
          )
          .orderBy(asc(opsAlerts.openedAt));
      },
      async listForTeam(teamId: string, limit = 50): Promise<OpsAlertRow[]> {
        return await db
          .select()
          .from(opsAlerts)
          .where(eq(opsAlerts.teamId, teamId))
          .orderBy(desc(opsAlerts.openedAt))
          .limit(limit);
      },
      async update(id: string, patch: Partial<OpsAlertRow>): Promise<void> {
        await db.update(opsAlerts).set(patch).where(eq(opsAlerts.id, id));
      },
    },

    channels: {
      async listAll(): Promise<OpsChannelRow[]> {
        return await db.select().from(opsChannels);
      },
      async listForTeam(teamId: string): Promise<OpsChannelRow[]> {
        return await db
          .select()
          .from(opsChannels)
          .where(eq(opsChannels.teamId, teamId))
          .orderBy(asc(opsChannels.kind));
      },
      async find(teamId: string, kind: string): Promise<OpsChannelRow | null> {
        const rows = await db
          .select()
          .from(opsChannels)
          .where(and(eq(opsChannels.teamId, teamId), eq(opsChannels.kind, kind)))
          .limit(1);
        return rows[0] ?? null;
      },
      async findByAccount(account: string): Promise<OpsChannelRow[]> {
        return await db.select().from(opsChannels).where(eq(opsChannels.account, account));
      },
      async create(row: OpsChannelRow): Promise<OpsChannelRow> {
        await db.insert(opsChannels).values(row);
        return row;
      },
      async update(id: string, patch: Partial<OpsChannelRow>): Promise<void> {
        await db.update(opsChannels).set(patch).where(eq(opsChannels.id, id));
      },
      async remove(id: string): Promise<void> {
        await db.delete(opsChannels).where(eq(opsChannels.id, id));
      },
    },

    channelLinks: {
      async listForTeam(teamId: string): Promise<OpsChannelLinkRow[]> {
        return await db
          .select()
          .from(opsChannelLinks)
          .where(eq(opsChannelLinks.teamId, teamId))
          .orderBy(asc(opsChannelLinks.createdAt));
      },
      async findById(id: string): Promise<OpsChannelLinkRow | null> {
        const rows = await db
          .select()
          .from(opsChannelLinks)
          .where(eq(opsChannelLinks.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async findByChat(
        teamId: string,
        kind: string,
        chatId: string,
      ): Promise<OpsChannelLinkRow | null> {
        const rows = await db
          .select()
          .from(opsChannelLinks)
          .where(
            and(
              eq(opsChannelLinks.teamId, teamId),
              eq(opsChannelLinks.kind, kind),
              eq(opsChannelLinks.chatId, chatId),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      /** One chat per person per service: linking again replaces the old one. */
      async put(row: OpsChannelLinkRow): Promise<OpsChannelLinkRow> {
        await db
          .delete(opsChannelLinks)
          .where(
            and(
              eq(opsChannelLinks.teamId, row.teamId),
              eq(opsChannelLinks.kind, row.kind),
              eq(opsChannelLinks.userId, row.userId),
            ),
          );
        await db.insert(opsChannelLinks).values(row);
        return row;
      },
      async remove(id: string): Promise<void> {
        await db.delete(opsChannelLinks).where(eq(opsChannelLinks.id, id));
      },
      async removeForKind(teamId: string, kind: string): Promise<void> {
        await db
          .delete(opsChannelLinks)
          .where(and(eq(opsChannelLinks.teamId, teamId), eq(opsChannelLinks.kind, kind)));
      },
    },

    linkCodes: {
      async create(row: OpsLinkCodeRow): Promise<OpsLinkCodeRow> {
        // A person has one live code at a time per service.
        await db
          .delete(opsLinkCodes)
          .where(
            and(
              eq(opsLinkCodes.teamId, row.teamId),
              eq(opsLinkCodes.userId, row.userId),
              eq(opsLinkCodes.kind, row.kind),
            ),
          );
        await db.insert(opsLinkCodes).values(row);
        return row;
      },
      async find(codeHash: string): Promise<OpsLinkCodeRow | null> {
        const rows = await db
          .select()
          .from(opsLinkCodes)
          .where(eq(opsLinkCodes.codeHash, codeHash))
          .limit(1);
        return rows[0] ?? null;
      },
      /** Marks it used only if it was not already: true when this call used it. */
      async use(codeHash: string, at: string): Promise<boolean> {
        const rows = await db
          .update(opsLinkCodes)
          .set({ usedAt: at })
          .where(and(eq(opsLinkCodes.codeHash, codeHash), sql`${opsLinkCodes.usedAt} is null`))
          .returning({ codeHash: opsLinkCodes.codeHash });
        return rows.length > 0;
      },
      async prune(before: string): Promise<void> {
        await db.delete(opsLinkCodes).where(sql`${opsLinkCodes.expiresAt} < ${before}`);
      },
    },

    notifyPrefs: {
      async listForTeam(teamId: string): Promise<OpsNotifyPrefsRow[]> {
        return await db.select().from(opsNotifyPrefs).where(eq(opsNotifyPrefs.teamId, teamId));
      },
      async put(row: OpsNotifyPrefsRow): Promise<void> {
        await db
          .insert(opsNotifyPrefs)
          .values(row)
          .onConflictDoUpdate({
            target: [opsNotifyPrefs.teamId, opsNotifyPrefs.userId],
            set: { prefs: row.prefs, updatedAt: row.updatedAt },
          });
      },
    },
  };
}

export type OpsRepository = ReturnType<typeof opsRepository>;
