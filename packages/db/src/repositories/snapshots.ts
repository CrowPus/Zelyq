import type { Snapshot } from "@zelyq/core";
import { desc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { snapshots } from "../schema/sqlite.js";

export function snapshotRepository(db: ZelyqDb) {
  return {
    async create(snapshot: Snapshot): Promise<Snapshot> {
      await db.insert(snapshots).values(snapshot);
      return snapshot;
    },

    async listForProject(projectId: string, limit = 50): Promise<Snapshot[]> {
      return await db
        .select()
        .from(snapshots)
        .where(eq(snapshots.projectId, projectId))
        .orderBy(desc(snapshots.createdAt))
        .limit(limit);
    },

    async findById(id: string): Promise<Snapshot | null> {
      const rows = await db.select().from(snapshots).where(eq(snapshots.id, id)).limit(1);
      return rows[0] ?? null;
    },
  };
}

export type SnapshotRepository = ReturnType<typeof snapshotRepository>;
