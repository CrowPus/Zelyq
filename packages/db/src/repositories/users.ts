import type { InstanceRole, User } from "@zelyq/core";
import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { users } from "../schema/sqlite.js";

type Row = typeof users.$inferSelect;

function toUser(row: Row): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    instanceRole: row.instanceRole as InstanceRole,
    createdAt: row.createdAt,
    twoFactorEnabled: Boolean(row.totpEnabledAt),
    locale: row.locale ?? null,
    timeZone: row.timeZone ?? null,
  };
}

/** Everything two-factor sign-in keeps for one account. The secret is still encrypted. */
export interface TwoFactorState {
  secret: string | null;
  enabledAt: string | null;
  lastStep: number | null;
  /** SHA-256 of each unused recovery code. */
  recoveryCodes: string[];
}

export function userRepository(db: ZelyqDb) {
  return {
    async twoFactorOf(id: string): Promise<TwoFactorState | null> {
      const rows = await db
        .select({
          secret: users.totpSecret,
          enabledAt: users.totpEnabledAt,
          lastStep: users.totpLastStep,
          recoveryCodes: users.recoveryCodes,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      let codes: string[] = [];
      try {
        codes = row.recoveryCodes ? (JSON.parse(row.recoveryCodes) as string[]) : [];
      } catch {
        codes = [];
      }
      return {
        secret: row.secret,
        enabledAt: row.enabledAt,
        lastStep: row.lastStep,
        recoveryCodes: codes,
      };
    },

    /** Writes only the parts given; null clears one. */
    async setTwoFactor(
      id: string,
      patch: {
        secret?: string | null;
        enabledAt?: string | null;
        lastStep?: number | null;
        recoveryCodes?: string[] | null;
      },
    ): Promise<void> {
      const set: Partial<Row> = { updatedAt: new Date().toISOString() };
      if (patch.secret !== undefined) set.totpSecret = patch.secret;
      if (patch.enabledAt !== undefined) set.totpEnabledAt = patch.enabledAt;
      if (patch.lastStep !== undefined) set.totpLastStep = patch.lastStep;
      if (patch.recoveryCodes !== undefined) {
        set.recoveryCodes =
          patch.recoveryCodes === null ? null : JSON.stringify(patch.recoveryCodes);
      }
      await db.update(users).set(set).where(eq(users.id, id));
    },

    /**
     * Uses up one step: succeeds only when `step` is newer than the last one
     * accepted, so the same code cannot be used twice, even by two requests at once.
     */
    async claimTotpStep(id: string, step: number): Promise<boolean> {
      const result = await db
        .update(users)
        .set({ totpLastStep: step })
        .where(
          and(
            eq(users.id, id),
            or(sql`${users.totpLastStep} IS NULL`, lt(users.totpLastStep, step)),
          ),
        )
        .returning({ id: users.id });
      return result.length > 0;
    },

    /**
     * Crosses one recovery code off, only if the list is still what the caller
     * read: two uses of the same code at once cannot both succeed.
     */
    async claimRecoveryCode(id: string, expected: string[], next: string[]): Promise<boolean> {
      const result = await db
        .update(users)
        .set({ recoveryCodes: JSON.stringify(next), updatedAt: new Date().toISOString() })
        .where(and(eq(users.id, id), eq(users.recoveryCodes, JSON.stringify(expected))))
        .returning({ id: users.id });
      return result.length > 0;
    },

    async setPreferences(
      id: string,
      patch: { locale?: string | null; timeZone?: string | null },
    ): Promise<void> {
      const set: Partial<Row> = { updatedAt: new Date().toISOString() };
      if (patch.locale !== undefined) set.locale = patch.locale;
      if (patch.timeZone !== undefined) set.timeZone = patch.timeZone;
      await db.update(users).set(set).where(eq(users.id, id));
    },

    async create(input: {
      id: string;
      email: string;
      name: string;
      passwordHash: string;
      instanceRole?: InstanceRole;
      /** "service": a team's Ops engineer, which can never sign in. */
      kind?: "person" | "service";
    }): Promise<User> {
      const now = new Date().toISOString();
      const row = {
        ...input,
        email: input.email.toLowerCase(),
        instanceRole: input.instanceRole ?? "member",
        kind: input.kind ?? "person",
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(users).values(row);
      return toUser(row as Row);
    },

    /** Whether this account is a team's Ops engineer: such an account never signs in. */
    async isService(id: string): Promise<boolean> {
      const rows = await db
        .select({ kind: users.kind })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0]?.kind === "service";
    },

    async findByEmail(
      email: string,
    ): Promise<(User & { passwordHash: string; kind: string }) | null> {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      const row = rows[0];
      return row ? { ...toUser(row), passwordHash: row.passwordHash, kind: row.kind } : null;
    },

    /** "active" or "suspended"; null when there is no such account. */
    async statusOf(id: string): Promise<{ status: string; reason: string | null } | null> {
      const rows = await db
        .select({ status: users.status, reason: users.statusReason })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async touch(id: string, at: string): Promise<void> {
      await db.update(users).set({ lastSeenAt: at }).where(eq(users.id, id));
    },

    async lastSeenOf(id: string): Promise<string | null> {
      const rows = await db
        .select({ at: users.lastSeenAt })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0]?.at ?? null;
    },

    async setStatus(id: string, status: string, reason: string | null): Promise<void> {
      await db
        .update(users)
        .set({ status, statusReason: reason, updatedAt: new Date().toISOString() })
        .where(eq(users.id, id));
    },

    async findById(id: string): Promise<User | null> {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ? toUser(rows[0]) : null;
    },

    async updateProfile(id: string, patch: { name?: string; email?: string }): Promise<void> {
      await db
        .update(users)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.email !== undefined ? { email: patch.email.toLowerCase() } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, id));
    },

    /** Server administrator or not. */
    async setInstanceRole(id: string, role: "admin" | "member"): Promise<void> {
      await db
        .update(users)
        .set({ instanceRole: role, updatedAt: new Date().toISOString() })
        .where(eq(users.id, id));
    },

    async updatePassword(id: string, passwordHash: string): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date().toISOString() })
        .where(eq(users.id, id));
    },

    /** Drives first-run setup: the first account to register owns the instance. */
    async count(): Promise<number> {
      const rows = await db
        .select({ value: sql<number>`count(*)` })
        .from(users)
        .where(ne(users.kind, "service"));
      return Number(rows[0]?.value ?? 0);
    },

    /** Guards the last-admin case: an instance must never be left unadministrable. */
    async countAdmins(): Promise<number> {
      const rows = await db
        .select({ value: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.instanceRole, "admin"), ne(users.kind, "service")));
      return Number(rows[0]?.value ?? 0);
    },

    async list(limit = 200): Promise<User[]> {
      const rows = await db
        .select()
        .from(users)
        .where(ne(users.kind, "service"))
        .orderBy(users.createdAt)
        .limit(limit);
      return rows.map(toUser);
    },

    /**
     * People, newest first, a page at a time (after the person named by `after`). `q` finds a
     * part of the name or email.
     */
    async listPage(
      after: { id: string; createdAt: string } | null,
      limit: number,
      q?: string,
    ): Promise<User[]> {
      const needle = q?.trim().toLowerCase();
      const pattern = needle ? `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const rows = await db
        .select()
        .from(users)
        .where(
          and(
            ne(users.kind, "service"),
            after
              ? or(
                  lt(users.createdAt, after.createdAt),
                  and(eq(users.createdAt, after.createdAt), lt(users.id, after.id)),
                )
              : undefined,
            pattern
              ? sql`(lower(${users.email}) like ${pattern} escape '\\' or lower(${users.name}) like ${pattern} escape '\\')`
              : undefined,
          ),
        )
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(limit);
      return rows.map(toUser);
    },

    /** Memberships and auth sessions go with it: both cascade on this row. */
    async remove(id: string): Promise<void> {
      await db.delete(users).where(eq(users.id, id));
    },
  };
}

export type UserRepository = ReturnType<typeof userRepository>;
