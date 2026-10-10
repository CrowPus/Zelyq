import { and, asc, desc, eq, gt, inArray, max, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  pipelineArtifacts as artifacts,
  teamSshKeys as keys,
  pipelineLogs as logs,
  pipelines,
  runners,
  pipelineRuns as runs,
  pipelineSteps as steps,
  pipelineTriggers as triggers,
} from "../schema/sqlite.js";

export type TeamSshKeyRow = typeof keys.$inferSelect;
export type RunnerRow = typeof runners.$inferSelect;
export type PipelineRow = typeof pipelines.$inferSelect;
export type PipelineRunRow = typeof runs.$inferSelect;
export type PipelineStepRow = typeof steps.$inferSelect;
export type PipelineLogRow = typeof logs.$inferSelect;
export type PipelineArtifactRow = typeof artifacts.$inferSelect;
export type PipelineTriggerRow = typeof triggers.$inferSelect;

/** See `vault.ts`: one write transaction at a time per handle, because libsql's
 * synchronous BEGIN IMMEDIATE deadlocks a second in-process transaction. */
const writeQueues = new WeakMap<ZelyqDb, Promise<unknown>>();
function inTransaction<T>(db: ZelyqDb, work: (tx: ZelyqDb) => Promise<T>): Promise<T> {
  const previous = writeQueues.get(db) ?? Promise.resolve();
  const run = () => db.transaction((transaction) => work(transaction as unknown as ZelyqDb));
  const next = previous.then(run, run);
  writeQueues.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}

export function pipelineRepository(db: ZelyqDb) {
  return {
    // ------------------------------------------------------------- SSH keys
    keys: {
      async listForTeam(teamId: string): Promise<TeamSshKeyRow[]> {
        return await db
          .select()
          .from(keys)
          .where(eq(keys.teamId, teamId))
          .orderBy(desc(keys.createdAt));
      },
      async create(row: TeamSshKeyRow): Promise<TeamSshKeyRow> {
        await db.insert(keys).values(row);
        return row;
      },
      async setRetiresAt(id: string, retiresAt: string | null): Promise<void> {
        await db.update(keys).set({ retiresAt }).where(eq(keys.id, id));
      },
      async remove(id: string): Promise<void> {
        await db.delete(keys).where(eq(keys.id, id));
      },
    },

    // -------------------------------------------------------------- runners
    runners: {
      async listForTeam(teamId: string): Promise<RunnerRow[]> {
        return await db
          .select()
          .from(runners)
          .where(eq(runners.teamId, teamId))
          .orderBy(asc(runners.name));
      },
      async findById(id: string): Promise<RunnerRow | null> {
        return (await db.select().from(runners).where(eq(runners.id, id)).limit(1))[0] ?? null;
      },
      async findByName(teamId: string, name: string): Promise<RunnerRow | null> {
        return (
          (
            await db
              .select()
              .from(runners)
              .where(and(eq(runners.teamId, teamId), eq(runners.name, name)))
              .limit(1)
          )[0] ?? null
        );
      },
      async create(row: RunnerRow): Promise<RunnerRow> {
        await db.insert(runners).values(row);
        return row;
      },
      async update(id: string, patch: Partial<RunnerRow>): Promise<RunnerRow | null> {
        const [row] = await db.update(runners).set(patch).where(eq(runners.id, id)).returning();
        return row ?? null;
      },
      async remove(id: string): Promise<boolean> {
        return (
          (await db.delete(runners).where(eq(runners.id, id)).returning({ id: runners.id }))
            .length > 0
        );
      },
    },

    // ------------------------------------------------------------ pipelines
    pipelines: {
      async listForTeam(teamId: string): Promise<PipelineRow[]> {
        return await db
          .select()
          .from(pipelines)
          .where(eq(pipelines.teamId, teamId))
          .orderBy(asc(pipelines.name));
      },
      async findById(id: string): Promise<PipelineRow | null> {
        return (await db.select().from(pipelines).where(eq(pipelines.id, id)).limit(1))[0] ?? null;
      },
      async findByName(teamId: string, name: string): Promise<PipelineRow | null> {
        return (
          (
            await db
              .select()
              .from(pipelines)
              .where(and(eq(pipelines.teamId, teamId), eq(pipelines.name, name)))
              .limit(1)
          )[0] ?? null
        );
      },
      async create(row: PipelineRow): Promise<PipelineRow> {
        await db.insert(pipelines).values(row);
        return row;
      },
      async update(id: string, patch: Partial<PipelineRow>): Promise<PipelineRow | null> {
        const [row] = await db.update(pipelines).set(patch).where(eq(pipelines.id, id)).returning();
        return row ?? null;
      },
      async remove(id: string): Promise<boolean> {
        return (
          (await db.delete(pipelines).where(eq(pipelines.id, id)).returning({ id: pipelines.id }))
            .length > 0
        );
      },
    },

    // ----------------------------------------------------------------- runs
    runs: {
      /** A new run, numbered one past the pipeline's last, with its steps. */
      async create(
        row: Omit<PipelineRunRow, "number">,
        stepRows: Omit<PipelineStepRow, "runId">[],
      ): Promise<PipelineRunRow> {
        return inTransaction(db, async (tx) => {
          const [current] = await tx
            .select({ last: max(runs.number) })
            .from(runs)
            .where(eq(runs.pipelineId, row.pipelineId));
          const created = { ...row, number: Number(current?.last ?? 0) + 1 };
          await tx.insert(runs).values(created);
          if (stepRows.length > 0) {
            await tx.insert(steps).values(stepRows.map((step) => ({ ...step, runId: created.id })));
          }
          return created;
        });
      },
      async findById(id: string): Promise<PipelineRunRow | null> {
        return (await db.select().from(runs).where(eq(runs.id, id)).limit(1))[0] ?? null;
      },
      async listForPipeline(pipelineId: string, limit = 50): Promise<PipelineRunRow[]> {
        return await db
          .select()
          .from(runs)
          .where(eq(runs.pipelineId, pipelineId))
          .orderBy(desc(runs.number))
          .limit(limit);
      },
      async lastForPipelines(pipelineIds: string[]): Promise<Map<string, PipelineRunRow>> {
        const found = new Map<string, PipelineRunRow>();
        if (pipelineIds.length === 0) return found;
        const rows = await db
          .select()
          .from(runs)
          .where(inArray(runs.pipelineId, pipelineIds))
          .orderBy(desc(runs.createdAt));
        for (const row of rows) if (!found.has(row.pipelineId)) found.set(row.pipelineId, row);
        return found;
      },
      async listByStatus(status: string): Promise<PipelineRunRow[]> {
        return await db
          .select()
          .from(runs)
          .where(eq(runs.status, status))
          .orderBy(asc(runs.createdAt));
      },
      /** Moves a queued run to running — only if it is still queued, so two
       * claimants can never both start it. */
      async claim(
        id: string,
        runnerId: string | null,
        runnerName: string,
        now: string,
      ): Promise<PipelineRunRow | null> {
        const [row] = await db
          .update(runs)
          .set({ status: "running", runnerId, runnerName, startedAt: now })
          .where(and(eq(runs.id, id), eq(runs.status, "queued")))
          .returning();
        return row ?? null;
      },
      async update(id: string, patch: Partial<PipelineRunRow>): Promise<PipelineRunRow | null> {
        const [row] = await db.update(runs).set(patch).where(eq(runs.id, id)).returning();
        return row ?? null;
      },
      async countRunningOn(runnerId: string): Promise<number> {
        const [row] = await db
          .select({ count: sql<number>`count(*)` })
          .from(runs)
          .where(and(eq(runs.runnerId, runnerId), eq(runs.status, "running")));
        return Number(row?.count ?? 0);
      },
    },

    // ---------------------------------------------------------------- steps
    steps: {
      async list(runId: string): Promise<PipelineStepRow[]> {
        return await db
          .select()
          .from(steps)
          .where(eq(steps.runId, runId))
          .orderBy(asc(steps.stageIndex), asc(steps.stepIndex));
      },
      /** Steps of many runs at once, for lists that show each run's stages. */
      async listForRuns(runIds: string[]): Promise<Map<string, PipelineStepRow[]>> {
        const found = new Map<string, PipelineStepRow[]>();
        if (runIds.length === 0) return found;
        const rows = await db
          .select()
          .from(steps)
          .where(inArray(steps.runId, runIds))
          .orderBy(asc(steps.stageIndex), asc(steps.stepIndex));
        for (const row of rows) found.set(row.runId, [...(found.get(row.runId) ?? []), row]);
        return found;
      },
      async update(id: string, patch: Partial<PipelineStepRow>): Promise<void> {
        await db.update(steps).set(patch).where(eq(steps.id, id));
      },
    },

    // ----------------------------------------------------------------- logs
    logs: {
      /** Lines with their sequence numbers already assigned by the one writer
       * of a run's log (the engine). */
      async append(
        runId: string,
        lines: Omit<PipelineLogRow, "runId">[],
        bytes: number,
      ): Promise<void> {
        if (lines.length === 0) return;
        await inTransaction(db, async (tx) => {
          await tx.insert(logs).values(lines.map((line) => ({ ...line, runId })));
          await tx
            .update(runs)
            .set({ logBytes: sql`${runs.logBytes} + ${bytes}` })
            .where(eq(runs.id, runId));
        });
      },
      async after(runId: string, afterSeq: number, limit = 2000): Promise<PipelineLogRow[]> {
        return await db
          .select()
          .from(logs)
          .where(and(eq(logs.runId, runId), gt(logs.seq, afterSeq)))
          .orderBy(asc(logs.seq))
          .limit(limit);
      },
      async lastSeq(runId: string): Promise<number> {
        const [row] = await db
          .select({ last: max(logs.seq) })
          .from(logs)
          .where(eq(logs.runId, runId));
        return Number(row?.last ?? 0);
      },
    },

    // ------------------------------------------------------------ artifacts
    artifacts: {
      async create(row: PipelineArtifactRow): Promise<void> {
        await db.insert(artifacts).values(row);
      },
      async list(runId: string): Promise<PipelineArtifactRow[]> {
        return await db
          .select()
          .from(artifacts)
          .where(eq(artifacts.runId, runId))
          .orderBy(asc(artifacts.name));
      },
      async findById(id: string): Promise<PipelineArtifactRow | null> {
        return (await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1))[0] ?? null;
      },
    },

    // ------------------------------------------------------------- triggers
    triggers: {
      async list(pipelineId: string): Promise<PipelineTriggerRow[]> {
        return await db
          .select()
          .from(triggers)
          .where(eq(triggers.pipelineId, pipelineId))
          .orderBy(asc(triggers.createdAt));
      },
      async listEnabled(kind: string): Promise<PipelineTriggerRow[]> {
        return await db
          .select()
          .from(triggers)
          .where(and(eq(triggers.kind, kind), eq(triggers.enabled, true)));
      },
      async findById(id: string): Promise<PipelineTriggerRow | null> {
        return (await db.select().from(triggers).where(eq(triggers.id, id)).limit(1))[0] ?? null;
      },
      async create(row: PipelineTriggerRow): Promise<PipelineTriggerRow> {
        await db.insert(triggers).values(row);
        return row;
      },
      async update(id: string, patch: Partial<PipelineTriggerRow>): Promise<void> {
        await db.update(triggers).set(patch).where(eq(triggers.id, id));
      },
      async remove(id: string): Promise<boolean> {
        return (
          (await db.delete(triggers).where(eq(triggers.id, id)).returning({ id: triggers.id }))
            .length > 0
        );
      },
    },
  };
}

export type PipelineRepository = ReturnType<typeof pipelineRepository>;
