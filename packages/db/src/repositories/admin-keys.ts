import { and, asc, eq, lt } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { adminIdempotency, adminKeys } from "../schema/sqlite.js";

export type AdminKeyRow = typeof adminKeys.$inferSelect;
export type AdminIdempotencyRow = typeof adminIdempotency.$inferSelect;

/**
 * Admin API keys and the answers kept for retried changes. Rows only: what a
 * key may do lives in the server's `AdminKeyService`.
 */
export function adminKeyRepository(db: ZelyqDb) {
  return {
    async create(row: AdminKeyRow): Promise<AdminKeyRow> {
      await db.insert(adminKeys).values(row);
      return row;
    },

    async findById(id: string): Promise<AdminKeyRow | null> {
      const rows = await db.select().from(adminKeys).where(eq(adminKeys.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findByHash(keyHash: string): Promise<AdminKeyRow | null> {
      const rows = await db.select().from(adminKeys).where(eq(adminKeys.keyHash, keyHash)).limit(1);
      return rows[0] ?? null;
    },

    async list(): Promise<AdminKeyRow[]> {
      return await db.select().from(adminKeys).orderBy(asc(adminKeys.createdAt));
    },

    async revoke(id: string, at: string): Promise<void> {
      await db.update(adminKeys).set({ revokedAt: at }).where(eq(adminKeys.id, id));
    },

    async touch(id: string, at: string, ip: string | null): Promise<void> {
      await db
        .update(adminKeys)
        .set({ lastUsedAt: at, lastUsedIp: ip })
        .where(eq(adminKeys.id, id));
    },

    async findAnswer(keyId: string, idempotencyKey: string): Promise<AdminIdempotencyRow | null> {
      const rows = await db
        .select()
        .from(adminIdempotency)
        .where(
          and(
            eq(adminIdempotency.keyId, keyId),
            eq(adminIdempotency.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    /** Keeps the first answer: a second writer racing the same key does not replace it. */
    async saveAnswer(row: AdminIdempotencyRow): Promise<void> {
      await db.insert(adminIdempotency).values(row).onConflictDoNothing();
    },

    async forgetAnswersBefore(before: string): Promise<void> {
      await db.delete(adminIdempotency).where(lt(adminIdempotency.createdAt, before));
    },
  };
}

export type AdminKeyRepository = ReturnType<typeof adminKeyRepository>;
