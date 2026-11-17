import { newId, type User, ZelyqError } from "@zelyq/core";
import type { AnnouncementRow, Store } from "@zelyq/db";
import { z } from "zod";
import type { UsageService } from "./usage.js";

/**
 * Talking to the people on this server, from its operators (through the admin
 * API, `notify` scope): announcements (a banner across the top, or an item in
 * the bell) to everyone, a plan, a team or one person; a message to one
 * person; and maintenance, with new building paused for its window if asked.
 * Marketing email is not here: that belongs to whoever keeps the consent.
 */

/** A link from a message: this server's own pages, or a secure address elsewhere. */
const linkSchema = z
  .object({
    url: z
      .string()
      .trim()
      .max(500)
      .refine(
        (url) => (url.startsWith("/") && !url.startsWith("//")) || /^https:\/\/[^\s]+$/.test(url),
        "A link is a path here (/docs) or an https:// address.",
      ),
    label: z.string().trim().min(1).max(40).default("Read more"),
  })
  .strict();

const levelSchema = z.enum(["info", "warning", "urgent"]);
const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("everyone") }).strict(),
  z.object({ kind: z.literal("plan"), value: z.string().min(1).max(60) }).strict(),
  z.object({ kind: z.literal("team"), value: z.string().min(1).max(60) }).strict(),
  z.object({ kind: z.literal("person"), value: z.string().min(1).max(60) }).strict(),
]);
const when = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(2000).default(""),
    level: levelSchema.default("info"),
    display: z.enum(["banner", "inbox"]).default("banner"),
    audience: audienceSchema.default({ kind: "everyone" }),
    link: linkSchema.optional(),
    startsAt: when.optional(),
    endsAt: when.nullable().optional(),
  })
  .strict();

export const notificationInputSchema = z
  .object({
    accountIds: z.array(z.string().min(1)).min(1).max(1000),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(2000).default(""),
    level: levelSchema.default("info"),
    link: linkSchema.optional(),
  })
  .strict();

export const maintenanceSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    startsAt: when,
    endsAt: when,
    /** New agent building and new previews wait during the window. */
    pauseBuilds: z.boolean().default(false),
  })
  .strict()
  .refine((value) => value.startsAt < value.endsAt, "The window must end after it starts.");
export type Maintenance = z.infer<typeof maintenanceSchema>;

const MAINTENANCE_KEY = "maintenance";

export class MessagesToPeople {
  constructor(
    private readonly store: Store,
    private readonly usage: UsageService,
  ) {}

  // ------------------------------------------------------------------ announcements

  async createAnnouncement(by: string, raw: unknown) {
    const input = announcementInputSchema.parse(raw);
    await this.checkAudience(input.audience);
    const now = new Date().toISOString();
    const row: AnnouncementRow = {
      id: newId("announcement"),
      title: input.title,
      body: input.body,
      level: input.level,
      display: input.display,
      audienceKind: input.audience.kind,
      audienceValue: "value" in input.audience ? input.audience.value : null,
      linkUrl: input.link?.url ?? null,
      linkLabel: input.link?.label ?? null,
      startsAt: input.startsAt ?? now,
      endsAt: input.endsAt ?? null,
      createdBy: by,
      createdAt: now,
      updatedAt: now,
    };
    if (row.endsAt && row.endsAt <= row.startsAt) {
      throw ZelyqError.badRequest("An announcement must end after it starts.");
    }
    await this.store.messagesToPeople.createAnnouncement(row);
    return await this.describe(row);
  }

  async updateAnnouncement(id: string, raw: unknown) {
    const current = await this.store.messagesToPeople.findAnnouncement(id);
    if (!current) throw ZelyqError.notFound("Announcement", id);
    const input = announcementInputSchema.partial().parse(raw);
    if (input.audience) await this.checkAudience(input.audience);
    const patch: Partial<AnnouncementRow> = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.display !== undefined ? { display: input.display } : {}),
      ...(input.audience
        ? {
            audienceKind: input.audience.kind,
            audienceValue: "value" in input.audience ? input.audience.value : null,
          }
        : {}),
      ...(input.link !== undefined ? { linkUrl: input.link.url, linkLabel: input.link.label } : {}),
      ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      updatedAt: new Date().toISOString(),
    };
    const startsAt = patch.startsAt ?? current.startsAt;
    const endsAt = patch.endsAt !== undefined ? patch.endsAt : current.endsAt;
    if (endsAt && endsAt <= startsAt) {
      throw ZelyqError.badRequest("An announcement must end after it starts.");
    }
    await this.store.messagesToPeople.updateAnnouncement(id, patch);
    return await this.describe((await this.store.messagesToPeople.findAnnouncement(id))!);
  }

  async removeAnnouncement(id: string) {
    if (!(await this.store.messagesToPeople.findAnnouncement(id))) {
      throw ZelyqError.notFound("Announcement", id);
    }
    await this.store.messagesToPeople.deleteAnnouncement(id);
    return { deleted: true };
  }

  async listAnnouncements() {
    const rows = await this.store.messagesToPeople.listAnnouncements(200);
    return { announcements: await Promise.all(rows.map((row) => this.describe(row))) };
  }

  private async describe(row: AnnouncementRow) {
    const now = new Date().toISOString();
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      level: row.level,
      display: row.display,
      audience:
        row.audienceKind === "everyone"
          ? { kind: "everyone" }
          : { kind: row.audienceKind, value: row.audienceValue },
      link: row.linkUrl ? { url: row.linkUrl, label: row.linkLabel ?? "Read more" } : null,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      live: row.startsAt <= now && (!row.endsAt || row.endsAt > now),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      counts: await this.store.messagesToPeople.counts(row.id),
    };
  }

  private async checkAudience(audience: z.infer<typeof audienceSchema>): Promise<void> {
    if (audience.kind === "team" && !(await this.store.teams.findById(audience.value))) {
      throw ZelyqError.notFound("Team", audience.value);
    }
    if (audience.kind === "person" && !(await this.store.users.findById(audience.value))) {
      throw ZelyqError.notFound("Account", audience.value);
    }
    if (
      audience.kind === "plan" &&
      !(await this.usage.allPlans()).some((plan) => plan.id === audience.value)
    ) {
      throw ZelyqError.notFound("Plan", audience.value);
    }
  }

  // ------------------------------------------------------------------ to one person

  async notify(by: string, raw: unknown) {
    const input = notificationInputSchema.parse(raw);
    const ids = [...new Set(input.accountIds)];
    for (const id of ids) {
      if (!(await this.store.users.findById(id)) || (await this.store.users.isService(id))) {
        throw ZelyqError.notFound("Account", id);
      }
    }
    const at = new Date().toISOString();
    const sent: string[] = [];
    for (const userId of ids) {
      const id = newId("userNotification");
      await this.store.messagesToPeople.notify({
        id,
        userId,
        title: input.title,
        body: input.body,
        level: input.level,
        linkUrl: input.link?.url ?? null,
        linkLabel: input.link?.label ?? null,
        source: by,
        createdAt: at,
        readAt: null,
      });
      sent.push(id);
    }
    return { sent: sent.length, ids: sent };
  }

  // ------------------------------------------------------------------ what a person sees

  async inboxFor(user: User) {
    const now = new Date().toISOString();
    const live = await this.store.messagesToPeople.liveAnnouncements(now);
    const teams = await this.store.teams.listForUser(user.id);
    const plans = new Set<string>();
    for (const team of teams) plans.add((await this.usage.planOf(team.id)).id);
    const mine = live.filter(
      (row) =>
        row.audienceKind === "everyone" ||
        (row.audienceKind === "person" && row.audienceValue === user.id) ||
        (row.audienceKind === "team" && teams.some((team) => team.id === row.audienceValue)) ||
        (row.audienceKind === "plan" && row.audienceValue !== null && plans.has(row.audienceValue)),
    );
    const views = new Map(
      (
        await this.store.messagesToPeople.viewsFor(
          user.id,
          mine.map((row) => row.id),
        )
      ).map((view) => [view.announcementId, view]),
    );
    const shape = (row: AnnouncementRow) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      level: row.level,
      link: row.linkUrl ? { url: row.linkUrl, label: row.linkLabel ?? "Read more" } : null,
      startsAt: row.startsAt,
      read: Boolean(views.get(row.id)?.dismissedAt),
    });
    const notifications = await this.store.messagesToPeople.notificationsFor(user.id, 50);
    const unreadAnnouncements = mine.filter(
      (row) => row.display === "inbox" && !views.get(row.id)?.dismissedAt,
    ).length;
    return {
      banners: mine
        .filter((row) => row.display === "banner" && !views.get(row.id)?.dismissedAt)
        .map(shape),
      announcements: mine.filter((row) => row.display === "inbox").map(shape),
      notifications: notifications.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        level: row.level,
        link: row.linkUrl ? { url: row.linkUrl, label: row.linkLabel ?? "Read more" } : null,
        createdAt: row.createdAt,
        read: Boolean(row.readAt),
      })),
      unread: (await this.store.messagesToPeople.unreadCount(user.id)) + unreadAnnouncements,
      maintenance: await this.currentMaintenance(),
    };
  }

  /** Seen, dismissed (read) or followed: only an announcement this person can see. */
  async markAnnouncement(user: User, id: string, what: "seen" | "dismiss" | "click") {
    const inbox = await this.inboxFor(user);
    const visible = [...inbox.banners, ...inbox.announcements].some((row) => row.id === id);
    if (!visible) throw ZelyqError.notFound("Announcement", id);
    const column = what === "seen" ? "seenAt" : what === "dismiss" ? "dismissedAt" : "clickedAt";
    await this.store.messagesToPeople.mark(id, user.id, column, new Date().toISOString());
    return { ok: true };
  }

  async markRead(user: User, id?: string) {
    await this.store.messagesToPeople.markRead(user.id, new Date().toISOString(), id);
    return { ok: true };
  }

  // ------------------------------------------------------------------ maintenance

  async maintenance(): Promise<Maintenance | null> {
    const stored = await this.store.settings.get(MAINTENANCE_KEY);
    if (!stored) return null;
    try {
      return maintenanceSchema.parse(JSON.parse(stored));
    } catch {
      return null;
    }
  }

  /** The maintenance to show now: announced (not over yet), with whether it has begun. */
  async currentMaintenance() {
    const window = await this.maintenance();
    if (!window) return null;
    const now = new Date().toISOString();
    if (window.endsAt <= now) return null;
    return { ...window, underway: window.startsAt <= now };
  }

  async setMaintenance(raw: unknown) {
    const input = maintenanceSchema.parse(raw);
    await this.store.settings.set(MAINTENANCE_KEY, JSON.stringify(input));
    return await this.currentMaintenance();
  }

  async clearMaintenance() {
    await this.store.settings.remove(MAINTENANCE_KEY);
    return { cleared: true };
  }

  /** During a maintenance window that pauses building: why not, in its own words. */
  async requireBuildsAllowed(): Promise<void> {
    const now = await this.currentMaintenance();
    if (now?.underway && now.pauseBuilds) {
      throw new ZelyqError("runtime_unavailable", now.message, { reason: "maintenance" });
    }
  }
}
