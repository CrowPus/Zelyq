import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { errorGroups, errorHits } from "../schema/sqlite.js";

export type ErrorGroupRow = typeof errorGroups.$inferSelect;

/** Grouped server errors and when each happened. Rows only: grouping and scrubbing live in the server. */
export function errorRepository(db: ZelyqDb) {
  return {
    async findByFingerprint(fingerprint: string): Promise<ErrorGroupRow | null> {
      const rows = await db
        .select()
        .from(errorGroups)
        .where(eq(errorGroups.fingerprint, fingerprint))
        .limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<ErrorGroupRow | null> {
      const rows = await db.select().from(errorGroups).where(eq(errorGroups.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** A new group; another writer making the same one first wins, and this does nothing. */
    async createGroup(row: ErrorGroupRow): Promise<void> {
      await db.insert(errorGroups).values(row).onConflictDoNothing();
    },

    async hit(
      groupId: string,
      at: string,
      who: { userId: string | null; teamId: string | null },
      reopen: boolean,
    ): Promise<void> {
      await db
        .update(errorGroups)
        .set({
          count: sql`${errorGroups.count} + 1`,
          lastSeen: at,
          ...(reopen ? { status: "open", resolvedAt: null } : {}),
        })
        .where(eq(errorGroups.id, groupId));
      await db
        .insert(errorHits)
        .values({ groupId, userId: who.userId, teamId: who.teamId, createdAt: at });
    },

    async setStatus(id: string, status: string, at: string | null): Promise<void> {
      await db
        .update(errorGroups)
        .set({ status, resolvedAt: status === "resolved" ? at : null })
        .where(eq(errorGroups.id, id));
    },

    /** Groups seen since `from`, newest first. */
    async listGroups(query: {
      from: string;
      status?: string;
      limit: number;
    }): Promise<ErrorGroupRow[]> {
      return await db
        .select()
        .from(errorGroups)
        .where(
          and(
            gte(errorGroups.lastSeen, query.from),
            query.status ? eq(errorGroups.status, query.status) : undefined,
          ),
        )
        .orderBy(desc(errorGroups.lastSeen))
        .limit(query.limit);
    },

    /** In a range: how often a group happened, to how many people and teams. */
    async hitsFor(
      groupId: string,
      from: string,
      to: string,
    ): Promise<{ count: number; people: number; teams: number }> {
      const rows = await db
        .select({
          count: sql<number>`count(*)`,
          people: sql<number>`count(distinct ${errorHits.userId})`,
          teams: sql<number>`count(distinct ${errorHits.teamId})`,
        })
        .from(errorHits)
        .where(
          and(
            eq(errorHits.groupId, groupId),
            gte(errorHits.createdAt, from),
            lt(errorHits.createdAt, to),
          ),
        );
      return {
        count: Number(rows[0]?.count ?? 0),
        people: Number(rows[0]?.people ?? 0),
        teams: Number(rows[0]?.teams ?? 0),
      };
    },

    /** Per day, for one group. */
    async hitsByDay(
      groupId: string,
      from: string,
      to: string,
    ): Promise<Array<{ day: string; count: number }>> {
      const day = sql<string>`substr(${errorHits.createdAt}, 1, 10)`;
      const rows = await db
        .select({ day, count: sql<number>`count(*)` })
        .from(errorHits)
        .where(
          and(
            eq(errorHits.groupId, groupId),
            gte(errorHits.createdAt, from),
            lt(errorHits.createdAt, to),
          ),
        )
        .groupBy(day)
        .orderBy(day);
      return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
    },

    async forgetHitsBefore(before: string): Promise<void> {
      await db.delete(errorHits).where(lt(errorHits.createdAt, before));
    },
  };
}

export type ErrorRepository = ReturnType<typeof errorRepository>;
