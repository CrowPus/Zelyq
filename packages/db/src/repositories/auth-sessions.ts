import { and, desc, eq, lt, ne } from "drizzle-orm";
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

    /** Notes what a session was opened with, for its owner's list of devices. */
    async describe(tokenHash: string, meta: { userAgent: string | null; ip: string | null }) {
      await db
        .update(authSessions)
        .set({
          userAgent: meta.userAgent?.slice(0, 400) ?? null,
          ip: meta.ip?.slice(0, 64) ?? null,
        })
        .where(eq(authSessions.tokenHash, tokenHash));
    },

    /** One person's sessions that have not expired, most recently used first. */
    async listForUser(userId: string) {
      const rows = await db
        .select({
          id: authSessions.id,
          userAgent: authSessions.userAgent,
          ip: authSessions.ip,
          createdAt: authSessions.createdAt,
          lastSeenAt: authSessions.lastSeenAt,
          expiresAt: authSessions.expiresAt,
        })
        .from(authSessions)
        .where(eq(authSessions.userId, userId))
        .orderBy(desc(authSessions.lastSeenAt));
      const now = new Date().toISOString();
      return rows.filter((row) => row.expiresAt > now);
    },

    /** Ends one session, only if it is this person's. Returns whether one was ended. */
    async removeOwned(userId: string, id: string): Promise<boolean> {
      const result = await db
        .delete(authSessions)
        .where(and(eq(authSessions.id, id), eq(authSessions.userId, userId)))
        .returning({ id: authSessions.id });
      return result.length > 0;
    },

    /** Ends every session of this person except the one given. */
    async removeOthers(userId: string, keepId: string): Promise<number> {
      const result = await db
        .delete(authSessions)
        .where(and(eq(authSessions.userId, userId), ne(authSessions.id, keepId)))
        .returning({ id: authSessions.id });
      return result.length;
    },

    async purgeExpired(): Promise<void> {
      await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date().toISOString()));
    },
  };
}

export type AuthSessionRepository = ReturnType<typeof authSessionRepository>;
