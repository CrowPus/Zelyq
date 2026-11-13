import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  opsAttempts,
  opsEngineers,
  opsGuards,
  opsJobs,
  opsLessons,
  opsMessages,
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

/**
 * The team's DevOps engineer (Ops): its jobs, plans, proofs and what it has
 * tried. Rows only: every rule about what Ops may do lives in the server's
 * `services/ops/`.
 */
export function opsRepository(db: ZelyqDb) {
  return {
    engineers: {
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
  };
}

export type OpsRepository = ReturnType<typeof opsRepository>;
