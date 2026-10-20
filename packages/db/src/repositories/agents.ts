import { and, desc, eq, isNull } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { agentProposals, agentReferences, agents } from "../schema/sqlite.js";

export type AgentRow = typeof agents.$inferSelect;
export type AgentProposalRow = typeof agentProposals.$inferSelect;
export type AgentReferenceRow = typeof agentReferences.$inferSelect;

/**
 * Outside agents and what they asked to be approved. Rows only: turning JSON
 * columns into shapes, and every rule about who may do what, live in the
 * server's `AgentService`.
 */
export function agentRepository(db: ZelyqDb) {
  return {
    async create(row: AgentRow): Promise<AgentRow> {
      await db.insert(agents).values(row);
      return row;
    },

    async findById(id: string): Promise<AgentRow | null> {
      const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findByHash(keyHash: string): Promise<AgentRow | null> {
      const rows = await db.select().from(agents).where(eq(agents.keyHash, keyHash)).limit(1);
      return rows[0] ?? null;
    },

    async listForTeam(teamId: string): Promise<AgentRow[]> {
      return await db
        .select()
        .from(agents)
        .where(eq(agents.teamId, teamId))
        .orderBy(desc(agents.createdAt));
    },

    async update(
      id: string,
      patch: Partial<
        Pick<
          AgentRow,
          | "name"
          | "job"
          | "projectIds"
          | "pipelineIds"
          | "media"
          | "environmentIds"
          | "permissions"
          | "keyPrefix"
          | "keyHash"
        >
      >,
    ): Promise<AgentRow | null> {
      await db.update(agents).set(patch).where(eq(agents.id, id));
      return await this.findById(id);
    },

    /** Revoking twice keeps the first time it happened. */
    async revoke(id: string, now: string): Promise<AgentRow | null> {
      await db
        .update(agents)
        .set({ revokedAt: now })
        .where(and(eq(agents.id, id), isNull(agents.revokedAt)));
      return await this.findById(id);
    },

    async touch(id: string, now: string, ip: string): Promise<void> {
      await db.update(agents).set({ lastUsedAt: now, lastUsedIp: ip }).where(eq(agents.id, id));
    },

    async remove(id: string): Promise<void> {
      await db.delete(agents).where(eq(agents.id, id));
    },

    /** Images it was given to work from in Studio; the files are the server's. */
    references: {
      async create(row: AgentReferenceRow): Promise<AgentReferenceRow> {
        await db.insert(agentReferences).values(row);
        return row;
      },
      async find(id: string): Promise<AgentReferenceRow | null> {
        const rows = await db
          .select()
          .from(agentReferences)
          .where(eq(agentReferences.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async list(agentId: string): Promise<AgentReferenceRow[]> {
        return await db
          .select()
          .from(agentReferences)
          .where(eq(agentReferences.agentId, agentId))
          .orderBy(desc(agentReferences.createdAt));
      },
      async remove(id: string): Promise<void> {
        await db.delete(agentReferences).where(eq(agentReferences.id, id));
      },
    },

    proposals: {
      async create(row: AgentProposalRow): Promise<AgentProposalRow> {
        await db.insert(agentProposals).values(row);
        return row;
      },

      async findById(id: string): Promise<AgentProposalRow | null> {
        const rows = await db
          .select()
          .from(agentProposals)
          .where(eq(agentProposals.id, id))
          .limit(1);
        return rows[0] ?? null;
      },

      /** Newest first. `status` narrows it; `agentId` keeps to one agent. */
      async listForTeam(
        teamId: string,
        filter: { status?: string; agentId?: string; limit?: number } = {},
      ): Promise<AgentProposalRow[]> {
        const conditions = [eq(agentProposals.teamId, teamId)];
        if (filter.status) conditions.push(eq(agentProposals.status, filter.status));
        if (filter.agentId) conditions.push(eq(agentProposals.agentId, filter.agentId));
        return await db
          .select()
          .from(agentProposals)
          .where(and(...conditions))
          .orderBy(desc(agentProposals.createdAt))
          .limit(filter.limit ?? 200);
      },

      /**
       * Moves a proposal out of "pending" exactly once. Two people pressing
       * Approve together: one wins, the other gets null and is told so —
       * nothing is pushed twice.
       */
      async decide(
        id: string,
        patch: { status: string; decidedBy: string; decidedAt: string },
      ): Promise<AgentProposalRow | null> {
        const updated = await db
          .update(agentProposals)
          .set(patch)
          .where(and(eq(agentProposals.id, id), eq(agentProposals.status, "pending")))
          .returning();
        return updated[0] ?? null;
      },

      async setOutcome(id: string, status: string, result: string): Promise<void> {
        await db.update(agentProposals).set({ status, result }).where(eq(agentProposals.id, id));
      },
    },
  };
}
