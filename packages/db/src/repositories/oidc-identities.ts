import { and, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { oidcIdentities } from "../schema/sqlite.js";

export function oidcIdentityRepository(db: ZelyqDb) {
  return {
    async find(issuer: string, subject: string) {
      const rows = await db
        .select()
        .from(oidcIdentities)
        .where(and(eq(oidcIdentities.issuer, issuer), eq(oidcIdentities.subject, subject)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Every outside identity linked to an account: the ids an account service knows it by. */
    async listForUser(userId: string): Promise<Array<{ issuer: string; subject: string }>> {
      return await db
        .select({ issuer: oidcIdentities.issuer, subject: oidcIdentities.subject })
        .from(oidcIdentities)
        .where(eq(oidcIdentities.userId, userId));
    },

    async create(input: {
      id: string;
      userId: string;
      issuer: string;
      subject: string;
    }): Promise<void> {
      await db.insert(oidcIdentities).values({
        ...input,
        createdAt: new Date().toISOString(),
      });
    },
  };
}

export type OidcIdentityRepository = ReturnType<typeof oidcIdentityRepository>;
