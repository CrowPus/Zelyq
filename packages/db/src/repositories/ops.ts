import { and, asc, desc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  opsAttempts,
  opsEngineers,
  opsJobs,
  opsMessages,
  opsPlanSteps,
  opsProofs,
  opsRunGrants,
} from "../schema/sqlite.js";

export type OpsEngineerRow = typeof opsEngineers.$inferSelect;
export type OpsJobRow = typeof opsJobs.$inferSelect;
export type OpsPlanStepRow = typeof opsPlanSteps.$inferSelect;
export type OpsProofRow = typeof opsProofs.$inferSelect;
export type OpsAttemptRow = typeof opsAttempts.$inferSelect;
export type OpsMessageRow = typeof opsMessages.$inferSelect;
export type OpsRunGrantRow = typeof opsRunGrants.$inferSelect;

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
    },

    steps: {
      /** Replaces a job's plan: only while it is not approved (the service checks). */
      async replaceForJob(jobId: string, rows: OpsPlanStepRow[]): Promise<void> {
        await db.delete(opsPlanSteps).where(eq(opsPlanSteps.jobId, jobId));
        if (rows.length > 0) await db.insert(opsPlanSteps).values(rows);
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
      async settle(id: string, ok: boolean, detail: string | null): Promise<void> {
        await db.update(opsAttempts).set({ ok, detail }).where(eq(opsAttempts.id, id));
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
