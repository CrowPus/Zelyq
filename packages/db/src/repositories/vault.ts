import { newId, VAULT_VERSIONS_KEPT } from "@zelyq/core";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { vaultSecrets as secrets, vaultSecretVersions as versions } from "../schema/sqlite.js";

/** A secret row. `value` is ciphertext; the repository never sees plaintext. */
export type VaultSecretRow = typeof secrets.$inferSelect;
/** The same row with the ciphertext left behind — what a list returns. */
export type VaultSecretSummaryRow = Omit<VaultSecretRow, "value">;
export type VaultVersionRow = Omit<typeof versions.$inferSelect, "value">;

const summary = {
  id: secrets.id,
  projectId: secrets.projectId,
  name: secrets.name,
  environment: secrets.environment,
  description: secrets.description,
  version: secrets.version,
  createdBy: secrets.createdBy,
  updatedBy: secrets.updatedBy,
  createdAt: secrets.createdAt,
  updatedAt: secrets.updatedAt,
};

/**
 * One Vault write transaction at a time per database handle.
 *
 * libsql opens a SQLite transaction with a *synchronous* `BEGIN IMMEDIATE`. A
 * second transaction started while the first is waiting on `await` therefore
 * blocks the event loop on the file lock — so the first can never resume to
 * commit — and fails with SQLITE_BUSY when the busy timeout runs out. Queuing
 * here, in-process, means the lock is only ever contended by another process,
 * which the busy timeout does handle. Secret writes are rare and quick; on
 * PostgreSQL the queue costs nothing that matters.
 */
const writeQueues = new WeakMap<ZelyqDb, Promise<unknown>>();
function serialised<T>(db: ZelyqDb, work: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(db) ?? Promise.resolve();
  const next = previous.then(work, work);
  writeQueues.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}

export function vaultRepository(db: ZelyqDb) {
  /**
   * Bumps the version, records it, and drops what falls out of the window —
   * one transaction, so the secret and its history can never disagree. The
   * increment happens in SQL, so two writers serialise on the row rather than
   * both reading version N and both writing N+1.
   */
  async function writeValue(
    tx: ZelyqDb,
    id: string,
    value: string,
    userId: string | null,
    now: string,
  ): Promise<VaultSecretRow | null> {
    const [row] = await tx
      .update(secrets)
      .set({ value, version: sql`${secrets.version} + 1`, updatedBy: userId, updatedAt: now })
      .where(eq(secrets.id, id))
      .returning();
    if (!row) return null;
    await tx.insert(versions).values({
      id: newId("vaultSecretVersion"),
      secretId: id,
      version: row.version,
      value,
      createdBy: userId,
      createdAt: now,
    });
    await tx
      .delete(versions)
      .where(
        and(eq(versions.secretId, id), lte(versions.version, row.version - VAULT_VERSIONS_KEPT)),
      );
    return row;
  }

  return {
    async list(projectId: string, environment?: string): Promise<VaultSecretSummaryRow[]> {
      return await db
        .select(summary)
        .from(secrets)
        .where(
          environment
            ? and(eq(secrets.projectId, projectId), eq(secrets.environment, environment))
            : eq(secrets.projectId, projectId),
        )
        .orderBy(asc(secrets.name), asc(secrets.environment));
    },

    /** Names and ciphertext for one environment: what a runtime is given. */
    async valuesFor(
      projectId: string,
      environment: string,
    ): Promise<{ name: string; value: string }[]> {
      return await db
        .select({ name: secrets.name, value: secrets.value })
        .from(secrets)
        .where(and(eq(secrets.projectId, projectId), eq(secrets.environment, environment)));
    },

    async findById(id: string): Promise<VaultSecretRow | null> {
      const rows = await db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findByName(
      projectId: string,
      name: string,
      environment: string,
    ): Promise<VaultSecretRow | null> {
      const rows = await db
        .select()
        .from(secrets)
        .where(
          and(
            eq(secrets.projectId, projectId),
            eq(secrets.name, name),
            eq(secrets.environment, environment),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: {
      projectId: string;
      name: string;
      environment: string;
      value: string;
      description: string | null;
      userId: string | null;
      now: string;
    }): Promise<VaultSecretRow> {
      const row: VaultSecretRow = {
        id: newId("vaultSecret"),
        projectId: input.projectId,
        name: input.name,
        environment: input.environment,
        value: input.value,
        description: input.description,
        version: 1,
        createdBy: input.userId,
        updatedBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      };
      await serialised(db, () =>
        db.transaction(async (transaction) => {
          const tx = transaction as unknown as ZelyqDb;
          await tx.insert(secrets).values(row);
          await tx.insert(versions).values({
            id: newId("vaultSecretVersion"),
            secretId: row.id,
            version: 1,
            value: row.value,
            createdBy: input.userId,
            createdAt: input.now,
          });
        }),
      );
      return row;
    },

    /** A new value becomes a new version. Null when the secret is gone. */
    async setValue(
      id: string,
      value: string,
      userId: string | null,
      now: string,
    ): Promise<VaultSecretRow | null> {
      return serialised(db, () =>
        db.transaction((transaction) =>
          writeValue(transaction as unknown as ZelyqDb, id, value, userId, now),
        ),
      );
    },

    async setDescription(
      id: string,
      description: string | null,
      userId: string | null,
      now: string,
    ): Promise<VaultSecretRow | null> {
      const [row] = await db
        .update(secrets)
        .set({ description, updatedBy: userId, updatedAt: now })
        .where(eq(secrets.id, id))
        .returning();
      return row ?? null;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(secrets).where(eq(secrets.id, id)).returning({ id: secrets.id });
      return rows.length > 0;
    },

    async listVersions(secretId: string): Promise<VaultVersionRow[]> {
      return await db
        .select({
          id: versions.id,
          secretId: versions.secretId,
          version: versions.version,
          createdBy: versions.createdBy,
          createdAt: versions.createdAt,
        })
        .from(versions)
        .where(eq(versions.secretId, secretId))
        .orderBy(desc(versions.version));
    },

    /** Ciphertext of one kept version, or null when it was never kept. */
    async versionValue(secretId: string, version: number): Promise<string | null> {
      const rows = await db
        .select({ value: versions.value })
        .from(versions)
        .where(and(eq(versions.secretId, secretId), eq(versions.version, version)))
        .limit(1);
      return rows[0]?.value ?? null;
    },
  };
}

export type VaultRepository = ReturnType<typeof vaultRepository>;
