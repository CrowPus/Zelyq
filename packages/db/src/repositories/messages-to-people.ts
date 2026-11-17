import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { announcements, announcementViews, userNotifications } from "../schema/sqlite.js";

export type AnnouncementRow = typeof announcements.$inferSelect;
export type UserNotificationRow = typeof userNotifications.$inferSelect;

/** Announcements, who saw them, and messages to one person. Rows only. */
export function messagesToPeopleRepository(db: ZelyqDb) {
  return {
    async createAnnouncement(row: AnnouncementRow): Promise<void> {
      await db.insert(announcements).values(row);
    },

    async findAnnouncement(id: string): Promise<AnnouncementRow | null> {
      const rows = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async updateAnnouncement(id: string, patch: Partial<AnnouncementRow>): Promise<void> {
      await db.update(announcements).set(patch).where(eq(announcements.id, id));
    },

    async deleteAnnouncement(id: string): Promise<void> {
      await db.delete(announcements).where(eq(announcements.id, id));
    },

    async listAnnouncements(limit: number): Promise<AnnouncementRow[]> {
      return await db
        .select()
        .from(announcements)
        .orderBy(desc(announcements.startsAt))
        .limit(limit);
    },

    /** Showing now: started, not ended. */
    async liveAnnouncements(now: string): Promise<AnnouncementRow[]> {
      return await db
        .select()
        .from(announcements)
        .where(
          and(
            lte(announcements.startsAt, now),
            or(isNull(announcements.endsAt), gt(announcements.endsAt, now)),
          ),
        )
        .orderBy(desc(announcements.startsAt));
    },

    async viewsFor(
      userId: string,
      announcementIds: string[],
    ): Promise<Array<typeof announcementViews.$inferSelect>> {
      if (announcementIds.length === 0) return [];
      return await db
        .select()
        .from(announcementViews)
        .where(
          and(
            eq(announcementViews.userId, userId),
            inArray(announcementViews.announcementId, announcementIds),
          ),
        );
    },

    /** Marks seen / dismissed / followed; the first time of each is kept. */
    async mark(
      announcementId: string,
      userId: string,
      what: "seenAt" | "dismissedAt" | "clickedAt",
      at: string,
    ): Promise<void> {
      await db
        .insert(announcementViews)
        .values({ announcementId, userId, seenAt: at, [what]: at })
        .onConflictDoUpdate({
          target: [announcementViews.announcementId, announcementViews.userId],
          set: { [what]: sql`coalesce(${announcementViews[what]}, ${at})` },
        });
    },

    async counts(
      announcementId: string,
    ): Promise<{ seen: number; dismissed: number; clicked: number }> {
      const rows = await db
        .select({
          seen: sql<number>`count(${announcementViews.seenAt})`,
          dismissed: sql<number>`count(${announcementViews.dismissedAt})`,
          clicked: sql<number>`count(${announcementViews.clickedAt})`,
        })
        .from(announcementViews)
        .where(eq(announcementViews.announcementId, announcementId));
      return {
        seen: Number(rows[0]?.seen ?? 0),
        dismissed: Number(rows[0]?.dismissed ?? 0),
        clicked: Number(rows[0]?.clicked ?? 0),
      };
    },

    // -------------------------------------------------------------- to one person

    async notify(row: UserNotificationRow): Promise<void> {
      await db.insert(userNotifications).values(row);
    },

    async notificationsFor(userId: string, limit: number): Promise<UserNotificationRow[]> {
      return await db
        .select()
        .from(userNotifications)
        .where(eq(userNotifications.userId, userId))
        .orderBy(desc(userNotifications.createdAt))
        .limit(limit);
    },

    async unreadCount(userId: string): Promise<number> {
      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(userNotifications)
        .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.readAt)));
      return Number(rows[0]?.count ?? 0);
    },

    /** One (`id`) or all of a person's messages, read. Only theirs. */
    async markRead(userId: string, at: string, id?: string): Promise<void> {
      await db
        .update(userNotifications)
        .set({ readAt: at })
        .where(
          and(
            eq(userNotifications.userId, userId),
            isNull(userNotifications.readAt),
            id ? eq(userNotifications.id, id) : undefined,
          ),
        );
    },
  };
}

export type MessagesToPeopleRepository = ReturnType<typeof messagesToPeopleRepository>;
