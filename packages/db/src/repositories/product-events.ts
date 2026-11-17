import type { ProductEvent, ProductEventName } from "@zelyq/core";
import { and, asc, eq, gt, gte, inArray, isNotNull, like, lt, or, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { productDaily, productEvents } from "../schema/sqlite.js";

export interface DailyCount {
  day: string;
  name: string;
  count: number;
  people: number;
  teams: number;
}

/** `YYYY-MM-DD` of an ISO timestamp: the same text in SQLite and PostgreSQL. */
const dayOf = sql<string>`substr(${productEvents.createdAt}, 1, 10)`;

/**
 * Product activity rows and the sums over them. Times are ISO strings, so a
 * range is a plain text comparison and a day is the first ten characters.
 */
export function productEventRepository(db: ZelyqDb) {
  const inRange = (from: string, to: string) =>
    and(gte(productEvents.createdAt, from), lt(productEvents.createdAt, to));

  return {
    async record(event: ProductEvent): Promise<void> {
      await db.insert(productEvents).values({ ...event, detail: JSON.stringify(event.detail) });
    },

    /** Raw events, oldest first, after a cursor (the last event of the page before). */
    async list(query: {
      from: string;
      to: string;
      name?: string;
      teamId?: string;
      userId?: string;
      after?: { id: string; createdAt: string } | null;
      limit: number;
    }): Promise<ProductEvent[]> {
      const rows = await db
        .select()
        .from(productEvents)
        .where(
          and(
            inRange(query.from, query.to),
            query.name ? eq(productEvents.name, query.name) : undefined,
            query.teamId ? eq(productEvents.teamId, query.teamId) : undefined,
            query.userId ? eq(productEvents.userId, query.userId) : undefined,
            query.after
              ? or(
                  gt(productEvents.createdAt, query.after.createdAt),
                  and(
                    eq(productEvents.createdAt, query.after.createdAt),
                    gt(productEvents.id, query.after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(productEvents.createdAt), asc(productEvents.id))
        .limit(query.limit);
      return rows.map((row) => ({
        ...row,
        name: row.name as ProductEventName,
        detail: JSON.parse(row.detail),
      }));
    },

    async findById(id: string): Promise<{ id: string; createdAt: string } | null> {
      const rows = await db
        .select({ id: productEvents.id, createdAt: productEvents.createdAt })
        .from(productEvents)
        .where(eq(productEvents.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Per day and event: how many, by how many people, in how many teams. */
    async daily(from: string, to: string, names?: string[]): Promise<DailyCount[]> {
      const rows = await db
        .select({
          day: dayOf,
          name: productEvents.name,
          count: sql<number>`count(*)`,
          people: sql<number>`count(distinct ${productEvents.userId})`,
          teams: sql<number>`count(distinct ${productEvents.teamId})`,
        })
        .from(productEvents)
        .where(
          and(inRange(from, to), names?.length ? inArray(productEvents.name, names) : undefined),
        )
        .groupBy(dayOf, productEvents.name)
        .orderBy(dayOf);
      return rows.map((row) => ({
        day: row.day,
        name: row.name,
        count: Number(row.count),
        people: Number(row.people),
        teams: Number(row.teams),
      }));
    },

    /** Per day: how many builds and deploys failed (`"ok":false` in their facts). */
    async failuresByDay(
      from: string,
      to: string,
    ): Promise<Array<{ day: string; name: string; count: number }>> {
      const rows = await db
        .select({ day: dayOf, name: productEvents.name, count: sql<number>`count(*)` })
        .from(productEvents)
        .where(
          and(
            inRange(from, to),
            inArray(productEvents.name, ["agent.build_finished", "deploy.finished"]),
            like(productEvents.detail, '%"ok":false%'),
          ),
        )
        .groupBy(dayOf, productEvents.name);
      return rows.map((row) => ({ day: row.day, name: row.name, count: Number(row.count) }));
    },

    /** Per day: the people and teams that did anything at all. */
    async activeByDay(
      from: string,
      to: string,
    ): Promise<Array<{ day: string; people: number; teams: number }>> {
      const rows = await db
        .select({
          day: dayOf,
          people: sql<number>`count(distinct ${productEvents.userId})`,
          teams: sql<number>`count(distinct ${productEvents.teamId})`,
        })
        .from(productEvents)
        .where(inRange(from, to))
        .groupBy(dayOf)
        .orderBy(dayOf);
      return rows.map((row) => ({
        day: row.day,
        people: Number(row.people),
        teams: Number(row.teams),
      }));
    },

    /** The people and teams that did anything in a range. */
    async active(from: string, to: string): Promise<{ people: number; teams: number }> {
      const rows = await db
        .select({
          people: sql<number>`count(distinct ${productEvents.userId})`,
          teams: sql<number>`count(distinct ${productEvents.teamId})`,
        })
        .from(productEvents)
        .where(inRange(from, to));
      return { people: Number(rows[0]?.people ?? 0), teams: Number(rows[0]?.teams ?? 0) };
    },

    /** Who did what, when (no detail): what a funnel or retention table is worked out from. */
    async who(
      from: string,
      to: string,
      names?: string[],
    ): Promise<Array<{ name: string; userId: string | null; teamId: string | null; day: string }>> {
      return await db
        .selectDistinct({
          name: productEvents.name,
          userId: productEvents.userId,
          teamId: productEvents.teamId,
          day: dayOf,
        })
        .from(productEvents)
        .where(
          and(inRange(from, to), names?.length ? inArray(productEvents.name, names) : undefined),
        );
    },

    /** Counts of one detail value of an event (a feature, a limit) with the teams involved. */
    async byDetail(
      name: string,
      key: string,
      from: string,
      to: string,
    ): Promise<Array<{ value: string; teamId: string | null; count: number }>> {
      const rows = await db
        .select({ detail: productEvents.detail, teamId: productEvents.teamId })
        .from(productEvents)
        .where(
          and(eq(productEvents.name, name), inRange(from, to), isNotNull(productEvents.detail)),
        );
      const counts = new Map<string, { value: string; teamId: string | null; count: number }>();
      for (const row of rows) {
        const value = String(JSON.parse(row.detail)[key] ?? "");
        if (!value) continue;
        const id = `${value}\u0000${row.teamId ?? ""}`;
        const entry = counts.get(id) ?? { value, teamId: row.teamId, count: 0 };
        entry.count += 1;
        counts.set(id, entry);
      }
      return [...counts.values()];
    },

    // -------------------------------------------------------------- the long view

    async listDaily(from: string, to: string): Promise<DailyCount[]> {
      return await db
        .select()
        .from(productDaily)
        .where(and(gte(productDaily.day, from.slice(0, 10)), lt(productDaily.day, to.slice(0, 10))))
        .orderBy(asc(productDaily.day));
    },

    /**
     * Folds every whole day before `before` (a `YYYY-MM-DD`) into daily totals,
     * then removes those rows. A day already folded is never folded twice.
     */
    async foldBefore(before: string): Promise<number> {
      const cutoff = `${before}T00:00:00.000Z`;
      const totals = await db
        .select({
          day: dayOf,
          name: productEvents.name,
          count: sql<number>`count(*)`,
          people: sql<number>`count(distinct ${productEvents.userId})`,
          teams: sql<number>`count(distinct ${productEvents.teamId})`,
        })
        .from(productEvents)
        .where(lt(productEvents.createdAt, cutoff))
        .groupBy(dayOf, productEvents.name);
      for (const total of totals) {
        await db
          .insert(productDaily)
          .values({
            day: total.day,
            name: total.name,
            count: Number(total.count),
            people: Number(total.people),
            teams: Number(total.teams),
          })
          .onConflictDoNothing();
      }
      await db.delete(productEvents).where(lt(productEvents.createdAt, cutoff));
      return totals.length;
    },
  };
}

export type ProductEventRepository = ReturnType<typeof productEventRepository>;
