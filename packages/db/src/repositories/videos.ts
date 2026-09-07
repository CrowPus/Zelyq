import { randomUUID } from "node:crypto";
import { maxVideoBytes, videoLibraryBytes, videoLibraryLimit, ZelyqError } from "@zelyq/core";
import { and, asc, count, desc, eq, isNull, lt, lte, or, sql, sum } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  videoAccounts as accounts,
  videoFrameSets as frameSets,
  videoGenerations as jobs,
  videoReferences as refs,
} from "../schema/sqlite.js";

export type VideoJobRow = typeof jobs.$inferSelect;
export type VideoFrameSetRow = typeof frameSets.$inferSelect;
export type VideoReferenceRow = typeof refs.$inferSelect;
type Patch = Partial<typeof jobs.$inferInsert>;
export function videoRepository(db: ZelyqDb) {
  // A write before admission reads serializes this owner's quota decisions on
  // both dialects. Unique active-owner and provider-slot indexes add fencing.
  async function admission<T>(ownerId: string, work: (tx: ZelyqDb) => Promise<T>): Promise<T> {
    return db.transaction(async (transaction) => {
      const tx = transaction as unknown as ZelyqDb;
      await tx.insert(accounts).values({ ownerId, lock: randomUUID() }).onConflictDoNothing();
      await tx.update(accounts).set({ lock: randomUUID() }).where(eq(accounts.ownerId, ownerId));
      return work(tx);
    });
  }
  async function checkStorage(tx: ZelyqDb, ownerId: string, extra: number) {
    const [job] = await tx
      .select({ bytes: sum(jobs.storageBytes) })
      .from(jobs)
      .where(eq(jobs.ownerId, ownerId));
    const [ref] = await tx
      .select({ bytes: sum(refs.sizeBytes) })
      .from(refs)
      .where(eq(refs.ownerId, ownerId));
    if (Number(job?.bytes ?? 0) + Number(ref?.bytes ?? 0) + extra > videoLibraryBytes)
      throw new ZelyqError(
        "conflict",
        "Your video library is full. Delete a video or unused starting image.",
      );
  }
  return {
    async find(id: string) {
      return (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0] ?? null;
    },
    async findRequest(ownerId: string, key: string) {
      return (
        (
          await db
            .select()
            .from(jobs)
            .where(and(eq(jobs.ownerId, ownerId), eq(jobs.idempotencyKey, key)))
            .limit(1)
        )[0] ?? null
      );
    },
    async create(row: typeof jobs.$inferInsert, hourlyLimit: number) {
      return admission(row.ownerId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.ownerId, row.ownerId), eq(jobs.idempotencyKey, row.idempotencyKey)))
          .limit(1);
        if (existing) return existing;
        const [active] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.activeOwner, row.ownerId))
          .limit(1);
        if (active)
          throw new ZelyqError(
            "conflict",
            "Your current video is still outstanding. Wait for it or resolve its unconfirmed result.",
          );
        const [recent] = await tx
          .select({ n: count() })
          .from(jobs)
          .where(
            and(
              eq(jobs.ownerId, row.ownerId),
              sql`${jobs.createdAt} >= ${new Date(Date.now() - 3600000).toISOString()}`,
            ),
          );
        if ((recent?.n ?? 0) >= hourlyLimit)
          throw new ZelyqError(
            "rate_limited",
            `You have reached ${hourlyLimit} video requests per hour.`,
          );
        const [library] = await tx
          .select({ n: count() })
          .from(jobs)
          .where(and(eq(jobs.ownerId, row.ownerId), isNull(jobs.deletedAt)));
        if ((library?.n ?? 0) >= videoLibraryLimit)
          throw new ZelyqError(
            "conflict",
            "Delete an entry from your video library before generating again.",
          );
        await checkStorage(tx, row.ownerId, maxVideoBytes);
        if (row.referenceId) {
          const [reference] = await tx
            .update(refs)
            .set({ expiresAt: null })
            .where(and(eq(refs.id, row.referenceId), eq(refs.ownerId, row.ownerId)))
            .returning();
          if (!reference) throw ZelyqError.notFound("Starting image", row.referenceId);
        }
        return (await tx.insert(jobs).values(row).returning())[0]!;
      });
    },
    async history(ownerId: string, before?: VideoJobRow) {
      return db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.ownerId, ownerId),
            isNull(jobs.deletedAt),
            before
              ? or(
                  lt(jobs.createdAt, before.createdAt),
                  and(eq(jobs.createdAt, before.createdAt), lt(jobs.id, before.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(jobs.createdAt), desc(jobs.id))
        .limit(25);
    },
    async due(now: string) {
      return db
        .select()
        .from(jobs)
        .where(
          and(
            isNull(jobs.deletedAt),
            lte(jobs.nextPollAt, now),
            or(isNull(jobs.leaseUntil), lt(jobs.leaseUntil, now)),
            or(
              eq(jobs.status, "queued"),
              eq(jobs.status, "submitting"),
              eq(jobs.status, "generating"),
              eq(jobs.status, "saving"),
            ),
          ),
        )
        .orderBy(asc(jobs.nextPollAt))
        .limit(10);
    },
    async claim(row: VideoJobRow, token: string, until: string, slot: number) {
      try {
        return (
          (
            await db
              .update(jobs)
              .set({
                leaseToken: token,
                leaseUntil: until,
                workerSlot: row.workerSlot ?? slot,
                status: row.status === "queued" ? "submitting" : row.status,
              })
              .where(
                and(
                  eq(jobs.id, row.id),
                  eq(jobs.status, row.status),
                  isNull(jobs.deletedAt),
                  or(isNull(jobs.leaseUntil), lt(jobs.leaseUntil, new Date().toISOString())),
                ),
              )
              .returning()
          )[0] ?? null
        );
      } catch (error) {
        if (/unique|constraint/i.test(`${error} ${(error as { cause?: unknown }).cause ?? ""}`))
          return null;
        throw error;
      }
    },
    async patch(id: string, token: string, patch: Patch) {
      return (
        (
          await db
            .update(jobs)
            .set(patch)
            .where(and(eq(jobs.id, id), eq(jobs.leaseToken, token), isNull(jobs.deletedAt)))
            .returning()
        )[0] ?? null
      );
    },
    async reconcile(id: string, ownerId: string) {
      return (
        (
          await db
            .update(jobs)
            .set({
              status: "generating",
              nextPollAt: new Date().toISOString(),
              attempts: 0,
              error: null,
            })
            .where(
              and(
                eq(jobs.id, id),
                eq(jobs.ownerId, ownerId),
                eq(jobs.status, "unknown"),
                isNull(jobs.deletedAt),
              ),
            )
            .returning()
        )[0] ?? null
      );
    },
    async cancel(id: string, ownerId: string) {
      return (
        (
          await db
            .update(jobs)
            .set({
              status: "cancelled",
              activeOwner: null,
              workerSlot: null,
              storageBytes: 0,
              completedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(jobs.id, id),
                eq(jobs.ownerId, ownerId),
                eq(jobs.status, "queued"),
                isNull(jobs.deletedAt),
              ),
            )
            .returning()
        )[0] ?? null
      );
    },
    async remove(id: string, ownerId: string, acknowledge: boolean) {
      return (
        (
          await db
            .update(jobs)
            .set({
              deletedAt: new Date().toISOString(),
              input: "{}",
              error: null,
              metadata: null,
              referenceId: null,
              storageBytes: 0,
              activeOwner: null,
              workerSlot: null,
              operation: null,
              leaseToken: null,
              leaseUntil: null,
            })
            .where(
              and(
                eq(jobs.id, id),
                eq(jobs.ownerId, ownerId),
                or(
                  eq(jobs.status, "succeeded"),
                  eq(jobs.status, "failed"),
                  eq(jobs.status, "cancelled"),
                  acknowledge ? eq(jobs.status, "unknown") : undefined,
                ),
              ),
            )
            .returning()
        )[0] ?? null
      );
    },
    async reference(id: string) {
      return (await db.select().from(refs).where(eq(refs.id, id)).limit(1))[0] ?? null;
    },
    async addReference(row: typeof refs.$inferInsert) {
      return admission(row.ownerId, async (tx) => {
        const [uploads] = await tx
          .select({ n: count() })
          .from(refs)
          .where(and(eq(refs.ownerId, row.ownerId), sql`${refs.expiresAt} IS NOT NULL`));
        if ((uploads?.n ?? 0) >= 10)
          throw new ZelyqError(
            "rate_limited",
            "Remove an unused starting image before uploading another.",
          );
        await checkStorage(tx, row.ownerId, row.sizeBytes);
        return (await tx.insert(refs).values(row).returning())[0]!;
      });
    },
    async removeReference(id: string, ownerId: string) {
      return admission(ownerId, async (tx) => {
        const [used] = await tx
          .select({ n: count() })
          .from(jobs)
          .where(and(eq(jobs.referenceId, id), isNull(jobs.deletedAt)));
        if (used?.n)
          throw new ZelyqError(
            "conflict",
            "This starting image belongs to a saved video. Delete its video entries first.",
          );
        return (
          (
            await tx
              .delete(refs)
              .where(and(eq(refs.id, id), eq(refs.ownerId, ownerId)))
              .returning()
          )[0] ?? null
        );
      });
    },
    /** The frame set for a video, or null. Owner-scoped without a join,
     *  because the row carries its owner. */
    async frameSet(generationId: string, ownerId: string) {
      return (
        (
          await db
            .select()
            .from(frameSets)
            .where(and(eq(frameSets.generationId, generationId), eq(frameSets.ownerId, ownerId)))
            .limit(1)
        )[0] ?? null
      );
    },
    /** Replaces any existing set for this video — one set per video, so a
     *  re-extraction cannot quietly accumulate storage. */
    async saveFrameSet(
      generationId: string,
      ownerId: string,
      set: {
        format: string;
        count: number;
        width: number;
        height: number;
        fps: number;
        sizeBytes: number;
      },
    ) {
      const row = {
        generationId,
        ownerId,
        ...set,
        fps: String(set.fps),
        createdAt: new Date().toISOString(),
      };
      await db.delete(frameSets).where(eq(frameSets.generationId, generationId));
      await db.insert(frameSets).values(row);
      return row;
    },
    async removeFrameSet(generationId: string, ownerId: string) {
      return (
        (
          await db
            .delete(frameSets)
            .where(and(eq(frameSets.generationId, generationId), eq(frameSets.ownerId, ownerId)))
            .returning()
        ).length > 0
      );
    },
    /** Frame bytes count against the same storage budget as clips, so a set
     *  cannot be used to sidestep the library cap. */
    async frameBytes(ownerId: string) {
      return Number(
        (
          await db
            .select({ total: sum(frameSets.sizeBytes) })
            .from(frameSets)
            .where(eq(frameSets.ownerId, ownerId))
        )[0]?.total ?? 0,
      );
    },
    async expiredReferences() {
      return db.select().from(refs).where(lt(refs.expiresAt, new Date().toISOString())).limit(20);
    },
  };
}
