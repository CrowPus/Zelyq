import type { AuditAction, AuditLogEntry } from "@zelyq/core";
import { and, desc, eq, isNull, like, or } from "drizzle-orm";
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
      return rows.map(parse);
    },

    /**
     * Vault's part of the log: a team's secrets and its projects' variables,
     * or — with `null` — the instance Vault, whose entries carry no team.
     */
    async listVaultActivity(teamId: string | null, limit = 200): Promise<AuditLogEntry[]> {
      const vaultActions = like(auditLog.action, "vault.%");
      const rows = await db
        .select()
        .from(auditLog)
        .where(
          teamId === null
            ? and(isNull(auditLog.teamId), vaultActions)
            : and(
                eq(auditLog.teamId, teamId),
                or(vaultActions, like(auditLog.action, "project.variable%")),
              ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(limit);
      return rows.map(parse);
    },
  };
}

function parse(row: typeof auditLog.$inferSelect): AuditLogEntry {
  return { ...row, action: row.action as AuditAction, detail: JSON.parse(row.detail) };
}

export type AuditLogRepository = ReturnType<typeof auditLogRepository>;
