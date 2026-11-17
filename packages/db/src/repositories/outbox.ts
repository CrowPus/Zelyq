import { and, asc, eq, gt, inArray, lt, lte, or } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { outboxEvents } from "../schema/sqlite.js";

export type OutboxEventRow = typeof outboxEvents.$inferSelect;

/** Events waiting to be sent, and the record of those that were. */
export function outboxRepository(db: ZelyqDb) {
  return {
    async add(row: OutboxEventRow): Promise<void> {
      await db.insert(outboxEvents).values(row);
    },

    async findById(id: string): Promise<OutboxEventRow | null> {
      const rows = await db.select().from(outboxEvents).where(eq(outboxEvents.id, id)).limit(1);
      return rows[0] ?? null;
    },

    /** Pending events whose time has come, oldest first. */
    async due(now: string, limit: number): Promise<OutboxEventRow[]> {
      return await db
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.status, "pending"), lte(outboxEvents.nextAttemptAt, now)))
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
        .limit(limit);
    },

    async delivered(id: string, at: string, attempts: number): Promise<void> {
      await db
        .update(outboxEvents)
        .set({ status: "delivered", deliveredAt: at, attempts, lastError: null })
        .where(eq(outboxEvents.id, id));
    },

    async retryLater(
      id: string,
      update: { attempts: number; nextAttemptAt: string; lastError: string; failed: boolean },
    ): Promise<void> {
      await db
        .update(outboxEvents)
        .set({
          attempts: update.attempts,
          nextAttemptAt: update.nextAttemptAt,
          lastError: update.lastError,
          status: update.failed ? "failed" : "pending",
        })
        .where(eq(outboxEvents.id, id));
    },

    /** Every event after a cursor (the last one already read), oldest first, any status. */
    async after(
      cursor: { id: string; createdAt: string } | null,
      limit: number,
      types?: string[],
    ): Promise<OutboxEventRow[]> {
      return await db
        .select()
        .from(outboxEvents)
        .where(
          and(
            cursor
              ? or(
                  gt(outboxEvents.createdAt, cursor.createdAt),
                  and(eq(outboxEvents.createdAt, cursor.createdAt), gt(outboxEvents.id, cursor.id)),
                )
              : undefined,
            types?.length ? inArray(outboxEvents.type, types) : undefined,
          ),
        )
        .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
        .limit(limit);
    },

    async forgetBefore(before: string): Promise<void> {
      await db.delete(outboxEvents).where(lt(outboxEvents.createdAt, before));
    },
  };
}

export type OutboxRepository = ReturnType<typeof outboxRepository>;
