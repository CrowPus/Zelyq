import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  agentOauthClients,
  agentOauthGrants,
  agentProposals,
  agentReferences,
  agents,
} from "../schema/sqlite.js";

export type AgentRow = typeof agents.$inferSelect;
export type AgentProposalRow = typeof agentProposals.$inferSelect;
export type AgentReferenceRow = typeof agentReferences.$inferSelect;
export type AgentOauthClientRow = typeof agentOauthClients.$inferSelect;
export type AgentOauthGrantRow = typeof agentOauthGrants.$inferSelect;

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

    /** Connectors signing in as an agent with OAuth; rules live in the server. */
    oauth: {
      async countClients(): Promise<number> {
        const [row] = await db.select({ n: count() }).from(agentOauthClients);
        return Number(row?.n ?? 0);
      },
      async createClient(row: AgentOauthClientRow): Promise<AgentOauthClientRow> {
        await db.insert(agentOauthClients).values(row);
        return row;
      },
      async findClient(clientId: string): Promise<AgentOauthClientRow | null> {
        const rows = await db
          .select()
          .from(agentOauthClients)
          .where(eq(agentOauthClients.clientId, clientId))
          .limit(1);
        return rows[0] ?? null;
      },
      async createGrant(row: AgentOauthGrantRow): Promise<AgentOauthGrantRow> {
        await db.insert(agentOauthGrants).values(row);
        return row;
      },
      async findGrant(tokenHash: string, kind: string): Promise<AgentOauthGrantRow | null> {
        const rows = await db
          .select()
          .from(agentOauthGrants)
          .where(and(eq(agentOauthGrants.tokenHash, tokenHash), eq(agentOauthGrants.kind, kind)))
          .limit(1);
        return rows[0] ?? null;
      },
      /** Marks a code used exactly once: a second exchange gets false. */
      async useCode(id: string, now: string): Promise<boolean> {
        const updated = await db
          .update(agentOauthGrants)
          .set({ usedAt: now })
          .where(and(eq(agentOauthGrants.id, id), isNull(agentOauthGrants.usedAt)))
          .returning({ id: agentOauthGrants.id });
        return updated.length > 0;
      },
      /** Removes one grant; false when it was already gone (a reused refresh token). */
      async removeGrant(id: string): Promise<boolean> {
        const removed = await db
          .delete(agentOauthGrants)
          .where(eq(agentOauthGrants.id, id))
          .returning({ id: agentOauthGrants.id });
        return removed.length > 0;
      },
      async listForAgent(agentId: string): Promise<AgentOauthGrantRow[]> {
        return await db
          .select()
          .from(agentOauthGrants)
          .where(eq(agentOauthGrants.agentId, agentId))
          .orderBy(desc(agentOauthGrants.createdAt));
      },
      async removeForAgent(agentId: string): Promise<void> {
        await db.delete(agentOauthGrants).where(eq(agentOauthGrants.agentId, agentId));
      },
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
