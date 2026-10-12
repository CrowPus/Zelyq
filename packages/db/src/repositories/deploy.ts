import { and, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { deployApps, deployments, deployEnvironments as environments } from "../schema/sqlite.js";

export type DeployEnvironmentRow = typeof environments.$inferSelect;
export type DeploymentRow = typeof deployments.$inferSelect;
export type DeployAppRow = typeof deployApps.$inferSelect;

/** One write transaction at a time per handle — see `pipelines.ts`. */
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

export function deployRepository(db: ZelyqDb) {
  return {
    environments: {
      async listForTeam(teamId: string): Promise<DeployEnvironmentRow[]> {
        return await db
          .select()
          .from(environments)
          .where(eq(environments.teamId, teamId))
          .orderBy(environments.createdAt);
      },
      async findById(id: string): Promise<DeployEnvironmentRow | null> {
        return (
          (await db.select().from(environments).where(eq(environments.id, id)).limit(1))[0] ?? null
        );
      },
      async findByName(teamId: string, name: string): Promise<DeployEnvironmentRow | null> {
        return (
          (
            await db
              .select()
              .from(environments)
              .where(and(eq(environments.teamId, teamId), eq(environments.name, name)))
              .limit(1)
          )[0] ?? null
        );
      },
      async create(row: DeployEnvironmentRow): Promise<DeployEnvironmentRow> {
        await db.insert(environments).values(row);
        return row;
      },
      async update(
        id: string,
        patch: Partial<DeployEnvironmentRow>,
      ): Promise<DeployEnvironmentRow | null> {
        const [row] = await db
          .update(environments)
          .set(patch)
          .where(eq(environments.id, id))
          .returning();
        return row ?? null;
      },
      async remove(id: string): Promise<void> {
        await db.delete(environments).where(eq(environments.id, id));
      },
    },

    deployments: {
      /** A new deploy, numbered one past the app's last in that environment. */
      async create(row: Omit<DeploymentRow, "number">): Promise<DeploymentRow> {
        return inTransaction(db, async (tx) => {
          const [current] = await tx
            .select({ last: max(deployments.number) })
            .from(deployments)
            .where(
              and(eq(deployments.environmentId, row.environmentId), eq(deployments.app, row.app)),
            );
          const created = { ...row, number: Number(current?.last ?? 0) + 1 };
          await tx.insert(deployments).values(created);
          return created;
        });
      },
      async findById(id: string): Promise<DeploymentRow | null> {
        return (
          (await db.select().from(deployments).where(eq(deployments.id, id)).limit(1))[0] ?? null
        );
      },
      async update(id: string, patch: Partial<DeploymentRow>): Promise<DeploymentRow | null> {
        const [row] = await db
          .update(deployments)
          .set(patch)
          .where(eq(deployments.id, id))
          .returning();
        return row ?? null;
      },
      async listFor(
        environmentId: string,
        app: string | null,
        limit = 50,
      ): Promise<DeploymentRow[]> {
        return await db
          .select()
          .from(deployments)
          .where(
            app === null
              ? eq(deployments.environmentId, environmentId)
              : and(eq(deployments.environmentId, environmentId), eq(deployments.app, app)),
          )
          .orderBy(desc(deployments.createdAt))
          .limit(limit);
      },
      async live(environmentIds: string[]): Promise<DeploymentRow[]> {
        if (environmentIds.length === 0) return [];
        return await db
          .select()
          .from(deployments)
          .where(
            and(inArray(deployments.environmentId, environmentIds), eq(deployments.status, "live")),
          )
          .orderBy(deployments.app);
      },
      /** The one now live replaces whatever was live before it. */
      async replaceOthers(environmentId: string, app: string, liveId: string): Promise<void> {
        await db
          .update(deployments)
          .set({ status: "replaced" })
          .where(
            and(
              eq(deployments.environmentId, environmentId),
              eq(deployments.app, app),
              eq(deployments.status, "live"),
              ne(deployments.id, liveId),
            ),
          );
      },
      /** Adds lines to a deploy's log, as they happen. */
      async appendLog(id: string, text: string): Promise<void> {
        await db
          .update(deployments)
          .set({ log: sql`${deployments.log} || ${text}` })
          .where(eq(deployments.id, id));
      },
      async listByStatus(status: string): Promise<DeploymentRow[]> {
        return await db.select().from(deployments).where(eq(deployments.status, status));
      },
    },

    apps: {
      async find(environmentId: string, app: string): Promise<DeployAppRow | null> {
        return (
          (
            await db
              .select()
              .from(deployApps)
              .where(and(eq(deployApps.environmentId, environmentId), eq(deployApps.app, app)))
              .limit(1)
          )[0] ?? null
        );
      },
      /** The apps' own settings in these environments. */
      async listFor(environmentIds: string[]): Promise<DeployAppRow[]> {
        if (environmentIds.length === 0) return [];
        return await db
          .select()
          .from(deployApps)
          .where(inArray(deployApps.environmentId, environmentIds));
      },
      async remove(environmentId: string, app: string): Promise<void> {
        await db
          .delete(deployApps)
          .where(and(eq(deployApps.environmentId, environmentId), eq(deployApps.app, app)));
      },
      async save(row: DeployAppRow): Promise<DeployAppRow> {
        await db
          .insert(deployApps)
          .values(row)
          .onConflictDoUpdate({
            target: [deployApps.environmentId, deployApps.app],
            set: {
              domain: row.domain,
              www: row.www,
              updatedBy: row.updatedBy,
              updatedAt: row.updatedAt,
            },
          });
        return (await this.find(row.environmentId, row.app)) as DeployAppRow;
      },
    },
  };
}

export type DeployRepository = ReturnType<typeof deployRepository>;
