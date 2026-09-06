import type { ImageGenerationInput, ImageJobStatus } from "@zelyq/core";
import { and, asc, count, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { imageGenerations as jobs } from "../schema/sqlite.js";

export type ImageJobRow = typeof jobs.$inferSelect;

export function imageRepository(db: ZelyqDb) {
  return {
    async create(
      id: string,
      ownerId: string,
      input: ImageGenerationInput,
      model: string,
      provider = "openai",
      references: { count: number; digest: string } = { count: 0, digest: "" },
      origin: {
        source?: "studio" | "agent";
        projectId?: string;
        projectName?: string;
        sessionId?: string;
      } = {},
    ) {
      const storedInput = {
        prompt: input.prompt,
        size: input.size ?? "1024x1024",
        quality: input.quality ?? "medium",
        idempotencyKey: input.idempotencyKey,
      };
      await db.insert(jobs).values({
        id,
        ownerId,
        ...storedInput,
        model,
        provider,
        referenceCount: references.count,
        referenceDigest: references.digest,
        source: origin.source ?? "studio",
        projectId: origin.projectId ?? "",
        projectName: origin.projectName ?? "",
        sessionId: origin.sessionId ?? "",
        activeOwner: ownerId,
        createdAt: new Date().toISOString(),
      });
    },
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
    async active(ownerId: string) {
      return (
        (await db.select().from(jobs).where(eq(jobs.activeOwner, ownerId)).limit(1))[0] ?? null
      );
    },
    async countRecent(ownerId: string, since: string) {
      return (
        (
          await db
            .select({ n: count() })
            .from(jobs)
            .where(and(eq(jobs.ownerId, ownerId), gte(jobs.createdAt, since)))
        )[0]?.n ?? 0
      );
    },
    /** How many images one conversation has asked for, deleted ones included:
     *  the cap exists to stop a loop, and deleting does not undo a spend. */
    async countSession(sessionId: string) {
      return (
        (await db.select({ n: count() }).from(jobs).where(eq(jobs.sessionId, sessionId)))[0]?.n ?? 0
      );
    },
    async countLibrary(ownerId: string) {
      return (
        (
          await db
            .select({ n: count() })
            .from(jobs)
            .where(and(eq(jobs.ownerId, ownerId), isNull(jobs.deletedAt)))
        )[0]?.n ?? 0
      );
    },
    async list(ownerId: string, before?: { createdAt: string; id: string }, limit = 25) {
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
        .limit(limit);
    },
    async queued() {
      return (
        (
          await db
            .select()
            .from(jobs)
            .where(eq(jobs.status, "queued"))
            .orderBy(asc(jobs.createdAt))
            .limit(1)
        )[0] ?? null
      );
    },
    async claim(id: string, slot: number, leaseUntil: string) {
      // The status predicate and unique worker-slot index arbitrate races
      // between server processes. A caller never submits an unclaimed job.
      try {
        const rows = await db
          .update(jobs)
          .set({ status: "generating", workerSlot: slot, leaseUntil })
          .where(and(eq(jobs.id, id), eq(jobs.status, "queued")))
          .returning();
        return rows[0] ?? null;
      } catch (error) {
        const message = `${error} ${String((error as { cause?: unknown }).cause ?? "")}`;
        if (/unique|constraint.*slot/i.test(message)) return null;
        throw error;
      }
    },
    async expired(now: string) {
      return db
        .select()
        .from(jobs)
        .where(
          and(
            lt(jobs.leaseUntil, now),
            or(eq(jobs.status, "generating"), eq(jobs.status, "saving")),
          ),
        );
    },
    async saving(
      id: string,
      metadata: {
        width: number;
        height: number;
        sizeBytes: number;
        providerRequestId: string | null;
        usage: string | null;
      },
    ) {
      return (
        (
          await db
            .update(jobs)
            .set({ status: "saving", ...metadata })
            .where(and(eq(jobs.id, id), eq(jobs.status, "generating")))
            .returning()
        ).length > 0
      );
    },
    async finish(id: string, status: ImageJobStatus, error: string | null = null) {
      await db
        .update(jobs)
        .set({
          status,
          error,
          activeOwner: null,
          workerSlot: null,
          leaseUntil: null,
          completedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(jobs.id, id),
            or(eq(jobs.status, "queued"), eq(jobs.status, "generating"), eq(jobs.status, "saving")),
          ),
        );
    },
    async remove(id: string) {
      // Preserve a minimal tombstone for idempotency and hourly accounting.
      await db
        .update(jobs)
        .set({ deletedAt: new Date().toISOString(), prompt: "", error: null, usage: null })
        .where(and(eq(jobs.id, id), isNull(jobs.activeOwner)));
    },
  };
}
