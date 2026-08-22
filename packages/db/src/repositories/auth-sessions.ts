import { eq, lt } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { authSessions } from "../schema/sqlite.js";

export interface AuthSessionRow {
  id: string;
  userId: string;
  expiresAt: string;
}

export function authSessionRepository(db: ZelyqDb) {
  return {
    async create(input: {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: string;
    }): Promise<void> {
      const now = new Date().toISOString();
      await db.insert(authSessions).values({ ...input, createdAt: now, lastSeenAt: now });
    },

    /** Looks up by token hash; the raw token is never stored or compared. */
    async findByTokenHash(tokenHash: string): Promise<AuthSessionRow | null> {
      const rows = await db
        .select()
        .from(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash))
        .limit(1);
      const row = rows[0];
      return row ? { id: row.id, userId: row.userId, expiresAt: row.expiresAt } : null;
    },

    async touch(id: string): Promise<void> {
      await db
        .update(authSessions)
        .set({ lastSeenAt: new Date().toISOString() })
        .where(eq(authSessions.id, id));
    },

    async remove(id: string): Promise<void> {
      await db.delete(authSessions).where(eq(authSessions.id, id));
    },

    /** Sign out everywhere — used when a password changes or an account is removed. */
    async removeForUser(userId: string): Promise<void> {
      await db.delete(authSessions).where(eq(authSessions.userId, userId));
    },

    async purgeExpired(): Promise<void> {
      await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date().toISOString()));
    },
  };
}

export type AuthSessionRepository = ReturnType<typeof authSessionRepository>;
