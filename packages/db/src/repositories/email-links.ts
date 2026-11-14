import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { emailLinks, users } from "../schema/sqlite.js";

export type EmailLinkPurpose = "reset" | "invite";

export interface EmailLinkRow {
  id: string;
  purpose: EmailLinkPurpose;
  email: string;
  userId: string | null;
  teamId: string | null;
  role: string | null;
  createdBy: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface PendingInviteRow {
  id: string;
  email: string;
  role: string;
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
}

type Row = typeof emailLinks.$inferSelect;

function toRow(row: Row): EmailLinkRow {
  return {
    id: row.id,
    purpose: row.purpose as EmailLinkPurpose,
    email: row.email,
    userId: row.userId,
    teamId: row.teamId,
    role: row.role,
    createdBy: row.createdBy,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

/** One-time links sent by email: password resets and team invitations. */
export function emailLinkRepository(db: ZelyqDb) {
  return {
    async create(input: {
      id: string;
      purpose: EmailLinkPurpose;
      tokenHash: string;
      email: string;
      userId?: string | null;
      teamId?: string | null;
      role?: string | null;
      createdBy?: string | null;
      expiresAt: string;
    }): Promise<void> {
      await db.insert(emailLinks).values({
        ...input,
        email: input.email.toLowerCase(),
        userId: input.userId ?? null,
        teamId: input.teamId ?? null,
        role: input.role ?? null,
        createdBy: input.createdBy ?? null,
        usedAt: null,
        createdAt: new Date().toISOString(),
      });
    },

    /** Looks up by token hash; the raw token is never stored or compared. */
    async findByTokenHash(tokenHash: string): Promise<EmailLinkRow | null> {
      const rows = await db
        .select()
        .from(emailLinks)
        .where(eq(emailLinks.tokenHash, tokenHash))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    /**
     * Spends a link. Only one caller can win: the update matches only while
     * it is still unused, so two clicks at once cannot both go through.
     */
    async markUsed(id: string): Promise<boolean> {
      const updated = await db
        .update(emailLinks)
        .set({ usedAt: new Date().toISOString() })
        .where(and(eq(emailLinks.id, id), isNull(emailLinks.usedAt)))
        .returning({ id: emailLinks.id });
      return updated.length > 0;
    },

    /** How many links of this kind went to this address since a moment: the send limit. */
    async countSince(purpose: EmailLinkPurpose, email: string, since: string): Promise<number> {
      const rows = await db
        .select({ id: emailLinks.id })
        .from(emailLinks)
        .where(
          and(
            eq(emailLinks.purpose, purpose),
            eq(emailLinks.email, email.toLowerCase()),
            gt(emailLinks.createdAt, since),
          ),
        );
      return rows.length;
    },

    /**
     * Voids an account's unused reset links. Marked used, not deleted: they
     * still count towards the hourly send limit.
     */
    async voidResetsFor(userId: string): Promise<void> {
      await db
        .update(emailLinks)
        .set({ usedAt: new Date().toISOString() })
        .where(
          and(
            eq(emailLinks.purpose, "reset"),
            eq(emailLinks.userId, userId),
            isNull(emailLinks.usedAt),
          ),
        );
    },

    async pendingInvite(teamId: string, email: string): Promise<EmailLinkRow | null> {
      const rows = await db
        .select()
        .from(emailLinks)
        .where(
          and(
            eq(emailLinks.purpose, "invite"),
            eq(emailLinks.teamId, teamId),
            eq(emailLinks.email, email.toLowerCase()),
            isNull(emailLinks.usedAt),
            gt(emailLinks.expiresAt, new Date().toISOString()),
          ),
        )
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    /** Invitations still waiting for an answer, newest first. */
    async pendingInvites(teamId: string): Promise<PendingInviteRow[]> {
      const rows = await db
        .select({
          id: emailLinks.id,
          email: emailLinks.email,
          role: emailLinks.role,
          invitedBy: users.name,
          expiresAt: emailLinks.expiresAt,
          createdAt: emailLinks.createdAt,
        })
        .from(emailLinks)
        .leftJoin(users, eq(users.id, emailLinks.createdBy))
        .where(
          and(
            eq(emailLinks.purpose, "invite"),
            eq(emailLinks.teamId, teamId),
            isNull(emailLinks.usedAt),
            gt(emailLinks.expiresAt, new Date().toISOString()),
          ),
        )
        .orderBy(desc(emailLinks.createdAt));
      return rows.map((row) => ({ ...row, role: row.role ?? "viewer" }));
    },

    /** Voids an invitation. Marked used, not deleted: it still counts towards the hourly send limit. */
    async voidInvite(teamId: string, id: string): Promise<void> {
      await db
        .update(emailLinks)
        .set({ usedAt: new Date().toISOString() })
        .where(
          and(
            eq(emailLinks.id, id),
            eq(emailLinks.purpose, "invite"),
            eq(emailLinks.teamId, teamId),
          ),
        );
    },

    async removeInvite(teamId: string, id: string): Promise<boolean> {
      const removed = await db
        .delete(emailLinks)
        .where(
          and(
            eq(emailLinks.id, id),
            eq(emailLinks.purpose, "invite"),
            eq(emailLinks.teamId, teamId),
          ),
        )
        .returning({ id: emailLinks.id });
      return removed.length > 0;
    },

    async purgeExpired(): Promise<void> {
      await db.delete(emailLinks).where(lt(emailLinks.expiresAt, new Date().toISOString()));
    },
  };
}

export type EmailLinkRepository = ReturnType<typeof emailLinkRepository>;
