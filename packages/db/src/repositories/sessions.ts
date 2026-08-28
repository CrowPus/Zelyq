import type { Session, SessionStatus } from "@zelyq/core";
import { desc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { sessions } from "../schema/sqlite.js";

type Row = typeof sessions.$inferSelect;

function toSession(row: Row): Session {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status as SessionStatus,
    provider: row.provider as Session["provider"],
    model: row.model,
    effort: row.effort as Session["effort"],
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function sessionRepository(db: ZelyqDb) {
  return {
    async create(input: Omit<Session, "createdAt" | "updatedAt">): Promise<Session> {
      const now = new Date().toISOString();
      const row = { ...input, createdAt: now, updatedAt: now };
      await db.insert(sessions).values(row);
      return toSession(row as Row);
    },

    async findById(id: string): Promise<Session | null> {
      const rows = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
      return rows[0] ? toSession(rows[0]) : null;
    },

    /** The session a project's editor reconnects to. */
    async findLatestForProject(projectId: string): Promise<Session | null> {
      const rows = await db
        .select()
        .from(sessions)
        .where(eq(sessions.projectId, projectId))
        .orderBy(desc(sessions.createdAt))
        .limit(1);
      return rows[0] ? toSession(rows[0]) : null;
    },

    async setStatus(id: string, status: SessionStatus): Promise<void> {
      await db
        .update(sessions)
        .set({ status, updatedAt: new Date().toISOString() })
        .where(eq(sessions.id, id));
    },

    /**
     * Keeps the stored row an honest record of what a session is actually
     * using, rather than what it happened to be created with.
     */
    async setModel(id: string, provider: Session["provider"], model: string): Promise<void> {
      await db
        .update(sessions)
        .set({ provider, model, updatedAt: new Date().toISOString() })
        .where(eq(sessions.id, id));
    },

    async addUsage(id: string, tokensIn: number, tokensOut: number): Promise<void> {
      const current = await this.findById(id);
      if (!current) return;
      await db
        .update(sessions)
        .set({
          tokensIn: current.tokensIn + tokensIn,
          tokensOut: current.tokensOut + tokensOut,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, id));
    },
  };
}

export type SessionRepository = ReturnType<typeof sessionRepository>;
