import type { AuditAction, AuditLogEntry } from "@zelyq/core";
import { desc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { auditLog } from "../schema/sqlite.js";

export function auditLogRepository(db: ZelyqDb) {
  return {
    async record(entry: AuditLogEntry): Promise<void> {
      await db.insert(auditLog).values({ ...entry, detail: JSON.stringify(entry.detail) });
    },

    async listForTeam(teamId: string, limit = 200): Promise<AuditLogEntry[]> {
      const rows = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.teamId, teamId))
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        action: row.action as AuditAction,
        detail: JSON.parse(row.detail),
      }));
    },
  };
}

export type AuditLogRepository = ReturnType<typeof auditLogRepository>;
