import { newId, VAULT_VERSIONS_KEPT } from "@zelyq/core";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import {
  vaultEntries as entries,
  vaultEntryVersions as entryVersions,
  projects,
  vaultServiceKeys as serviceKeys,
  projectVariables as variables,
  projectVariableVersions as variableVersions,
} from "../schema/sqlite.js";

/** A Vault secret. `value` is ciphertext; this package never sees plaintext. */
export type VaultEntryRow = typeof entries.$inferSelect;
/** The same row with the ciphertext left behind — what a list returns. */
export type VaultEntrySummaryRow = Omit<VaultEntryRow, "value">;
export type ProjectVariableRow = typeof variables.$inferSelect;
export type ProjectVariableSummaryRow = Omit<ProjectVariableRow, "value">;
export type VersionRow = {
  id: string;
  version: number;
  createdBy: string | null;
  createdAt: string;
};
export type VaultServiceKeyRow = typeof serviceKeys.$inferSelect;

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
function inTransaction<T>(db: ZelyqDb, work: (tx: ZelyqDb) => Promise<T>): Promise<T> {
  return serialised(db, () =>
    db.transaction((transaction) => work(transaction as unknown as ZelyqDb)),
  );
}

const entrySummary = {
  id: entries.id,
  scopeKey: entries.scopeKey,
  teamId: entries.teamId,
  name: entries.name,
  description: entries.description,
  protected: entries.protected,
  version: entries.version,
  createdBy: entries.createdBy,
  updatedBy: entries.updatedBy,
  createdAt: entries.createdAt,
  updatedAt: entries.updatedAt,
};

const variableSummary = {
  id: variables.id,
  projectId: variables.projectId,
  name: variables.name,
  source: variables.source,
  vaultName: variables.vaultName,
  description: variables.description,
  version: variables.version,
  createdBy: variables.createdBy,
  updatedBy: variables.updatedBy,
  createdAt: variables.createdAt,
  updatedAt: variables.updatedAt,
};

export function vaultRepository(db: ZelyqDb) {
  return {
    // ---------------------------------------------------------------- entries

    async list(scopeKey: string): Promise<VaultEntrySummaryRow[]> {
      return await db
        .select(entrySummary)
        .from(entries)
        .where(eq(entries.scopeKey, scopeKey))
        .orderBy(asc(entries.name));
    },

    async findById(id: string): Promise<VaultEntryRow | null> {
      const rows = await db.select().from(entries).where(eq(entries.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findByName(scopeKey: string, name: string): Promise<VaultEntryRow | null> {
      const rows = await db
        .select()
        .from(entries)
        .where(and(eq(entries.scopeKey, scopeKey), eq(entries.name, name)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Ciphertext for several names at once — a reference being resolved. */
    async findByNames(scopeKey: string, names: string[]): Promise<VaultEntryRow[]> {
      if (names.length === 0) return [];
      return await db
        .select()
        .from(entries)
        .where(and(eq(entries.scopeKey, scopeKey), inArray(entries.name, names)));
    },

    async create(input: {
      scopeKey: string;
      teamId: string | null;
      name: string;
      value: string;
      description: string | null;
      protected: boolean;
      userId: string | null;
      now: string;
    }): Promise<VaultEntryRow> {
      const row: VaultEntryRow = {
        id: newId("vaultEntry"),
        scopeKey: input.scopeKey,
        teamId: input.teamId,
        name: input.name,
        value: input.value,
        description: input.description,
        protected: input.protected,
        version: 1,
        createdBy: input.userId,
        updatedBy: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      };
      await inTransaction(db, async (tx) => {
        await tx.insert(entries).values(row);
        await tx.insert(entryVersions).values({
          id: newId("vaultEntryVersion"),
          entryId: row.id,
          version: 1,
          value: row.value,
          createdBy: input.userId,
          createdAt: input.now,
        });
      });
      return row;
    },

    /**
     * A new value is a new version. The increment happens in SQL, so two
     * writers serialise on the row rather than both writing N+1, and the
     * window of kept versions is trimmed in the same transaction.
     */
    async setValue(
      id: string,
      value: string,
      userId: string | null,
      now: string,
    ): Promise<VaultEntryRow | null> {
      return inTransaction(db, async (tx) => {
        const [row] = await tx
          .update(entries)
          .set({ value, version: sql`${entries.version} + 1`, updatedBy: userId, updatedAt: now })
          .where(eq(entries.id, id))
          .returning();
        if (!row) return null;
        await tx.insert(entryVersions).values({
          id: newId("vaultEntryVersion"),
          entryId: id,
          version: row.version,
          value,
          createdBy: userId,
          createdAt: now,
        });
        await tx
          .delete(entryVersions)
          .where(
            and(
              eq(entryVersions.entryId, id),
              lte(entryVersions.version, row.version - VAULT_VERSIONS_KEPT),
            ),
          );
        return row;
      });
    },

    async setDetails(
      id: string,
      details: { description?: string | null; protected?: boolean },
      userId: string | null,
      now: string,
    ): Promise<VaultEntryRow | null> {
      const [row] = await db
        .update(entries)
        .set({ ...details, updatedBy: userId, updatedAt: now })
        .where(eq(entries.id, id))
        .returning();
      return row ?? null;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(entries).where(eq(entries.id, id)).returning({ id: entries.id });
      return rows.length > 0;
    },

    async listVersions(entryId: string): Promise<VersionRow[]> {
      return await db
        .select({
          id: entryVersions.id,
          version: entryVersions.version,
          createdBy: entryVersions.createdBy,
          createdAt: entryVersions.createdAt,
        })
        .from(entryVersions)
        .where(eq(entryVersions.entryId, entryId))
        .orderBy(desc(entryVersions.version));
    },

    async versionValue(entryId: string, version: number): Promise<string | null> {
      const rows = await db
        .select({ value: entryVersions.value })
        .from(entryVersions)
        .where(and(eq(entryVersions.entryId, entryId), eq(entryVersions.version, version)))
        .limit(1);
      return rows[0]?.value ?? null;
    },

    /** Every project variable in a team that points at Vault, with its app. */
    async teamUsages(
      teamId: string,
    ): Promise<{ projectId: string; projectName: string; variable: string; vaultName: string }[]> {
      const rows = await db
        .select({
          projectId: projects.id,
          projectName: projects.name,
          variable: variables.name,
          vaultName: variables.vaultName,
        })
        .from(variables)
        .innerJoin(projects, eq(projects.id, variables.projectId))
        .where(and(eq(projects.teamId, teamId), eq(variables.source, "vault")))
        .orderBy(asc(projects.name), asc(variables.name));
      return rows.filter((row): row is typeof row & { vaultName: string } => !!row.vaultName);
    },

    // -------------------------------------------------------------- variables

    variables: {
      async list(projectId: string): Promise<ProjectVariableSummaryRow[]> {
        return await db
          .select(variableSummary)
          .from(variables)
          .where(eq(variables.projectId, projectId))
          .orderBy(asc(variables.name));
      },

      /** Rows with their ciphertext — for the project's own runtime only. */
      async listWithValues(projectId: string): Promise<ProjectVariableRow[]> {
        return await db.select().from(variables).where(eq(variables.projectId, projectId));
      },

      async findById(id: string): Promise<ProjectVariableRow | null> {
        const rows = await db.select().from(variables).where(eq(variables.id, id)).limit(1);
        return rows[0] ?? null;
      },

      async findByName(projectId: string, name: string): Promise<ProjectVariableRow | null> {
        const rows = await db
          .select()
          .from(variables)
          .where(and(eq(variables.projectId, projectId), eq(variables.name, name)))
          .limit(1);
        return rows[0] ?? null;
      },

      async create(input: {
        projectId: string;
        name: string;
        source: "direct" | "vault";
        value: string | null;
        vaultName: string | null;
        description: string | null;
        userId: string | null;
        now: string;
      }): Promise<ProjectVariableRow> {
        const row: ProjectVariableRow = {
          id: newId("projectVariable"),
          projectId: input.projectId,
          name: input.name,
          source: input.source,
          value: input.value,
          vaultName: input.vaultName,
          description: input.description,
          version: 1,
          createdBy: input.userId,
          updatedBy: input.userId,
          createdAt: input.now,
          updatedAt: input.now,
        };
        await inTransaction(db, async (tx) => {
          await tx.insert(variables).values(row);
          if (input.value !== null) {
            await tx.insert(variableVersions).values({
              id: newId("projectVariableVersion"),
              variableId: row.id,
              version: 1,
              value: input.value,
              createdBy: input.userId,
              createdAt: input.now,
            });
          }
        });
        return row;
      },

      /**
       * A typed value (also how a Vault variable becomes typed again). Each one
       * is a version; switching to Vault keeps the typed history, so switching
       * back can restore it.
       */
      async setDirectValue(
        id: string,
        value: string,
        userId: string | null,
        now: string,
      ): Promise<ProjectVariableRow | null> {
        return inTransaction(db, async (tx) => {
          const [row] = await tx
            .update(variables)
            .set({
              source: "direct",
              value,
              vaultName: null,
              version: sql`${variables.version} + 1`,
              updatedBy: userId,
              updatedAt: now,
            })
            .where(eq(variables.id, id))
            .returning();
          if (!row) return null;
          await tx.insert(variableVersions).values({
            id: newId("projectVariableVersion"),
            variableId: id,
            version: row.version,
            value,
            createdBy: userId,
            createdAt: now,
          });
          await tx
            .delete(variableVersions)
            .where(
              and(
                eq(variableVersions.variableId, id),
                lte(variableVersions.version, row.version - VAULT_VERSIONS_KEPT),
              ),
            );
          return row;
        });
      },

      async setVaultSource(
        id: string,
        vaultName: string,
        userId: string | null,
        now: string,
      ): Promise<ProjectVariableRow | null> {
        return inTransaction(db, async (tx) => {
          const [row] = await tx
            .update(variables)
            .set({
              source: "vault",
              value: null,
              vaultName,
              version: sql`${variables.version} + 1`,
              updatedBy: userId,
              updatedAt: now,
            })
            .where(eq(variables.id, id))
            .returning();
          return row ?? null;
        });
      },

      async setDescription(
        id: string,
        description: string | null,
        userId: string | null,
        now: string,
      ): Promise<ProjectVariableRow | null> {
        const [row] = await db
          .update(variables)
          .set({ description, updatedBy: userId, updatedAt: now })
          .where(eq(variables.id, id))
          .returning();
        return row ?? null;
      },

      async remove(id: string): Promise<boolean> {
        const rows = await db
          .delete(variables)
          .where(eq(variables.id, id))
          .returning({ id: variables.id });
        return rows.length > 0;
      },

      async listVersions(variableId: string): Promise<VersionRow[]> {
        return await db
          .select({
            id: variableVersions.id,
            version: variableVersions.version,
            createdBy: variableVersions.createdBy,
            createdAt: variableVersions.createdAt,
          })
          .from(variableVersions)
          .where(eq(variableVersions.variableId, variableId))
          .orderBy(desc(variableVersions.version));
      },

      async versionValue(variableId: string, version: number): Promise<string | null> {
        const rows = await db
          .select({ value: variableVersions.value })
          .from(variableVersions)
          .where(
            and(eq(variableVersions.variableId, variableId), eq(variableVersions.version, version)),
          )
          .limit(1);
        return rows[0]?.value ?? null;
      },
    },

    // ----------------------------------------------------------- service keys

    keys: {
      async create(row: VaultServiceKeyRow): Promise<VaultServiceKeyRow> {
        await db.insert(serviceKeys).values(row);
        return row;
      },

      async findByHash(keyHash: string): Promise<VaultServiceKeyRow | null> {
        const rows = await db
          .select()
          .from(serviceKeys)
          .where(eq(serviceKeys.keyHash, keyHash))
          .limit(1);
        return rows[0] ?? null;
      },

      async findById(id: string): Promise<VaultServiceKeyRow | null> {
        const rows = await db.select().from(serviceKeys).where(eq(serviceKeys.id, id)).limit(1);
        return rows[0] ?? null;
      },

      async listForTeam(teamId: string): Promise<VaultServiceKeyRow[]> {
        return await db
          .select()
          .from(serviceKeys)
          .where(eq(serviceKeys.teamId, teamId))
          .orderBy(desc(serviceKeys.createdAt));
      },

      /** Revoking twice keeps the first time it happened. */
      async revoke(id: string, now: string): Promise<VaultServiceKeyRow | null> {
        const [row] = await db
          .update(serviceKeys)
          .set({ revokedAt: now })
          .where(and(eq(serviceKeys.id, id), isNull(serviceKeys.revokedAt)))
          .returning();
        return row ?? (await this.findById(id));
      },

      async touch(id: string, now: string, ip: string): Promise<void> {
        await db
          .update(serviceKeys)
          .set({ lastUsedAt: now, lastUsedIp: ip })
          .where(eq(serviceKeys.id, id));
      },
    },
  };
}

export type VaultRepository = ReturnType<typeof vaultRepository>;
