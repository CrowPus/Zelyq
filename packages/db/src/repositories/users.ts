import type { InstanceRole, User } from "@zelyq/core";
import { eq, sql } from "drizzle-orm";
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
  };
}

export function userRepository(db: ZelyqDb) {
  return {
    async create(input: {
      id: string;
      email: string;
      name: string;
      passwordHash: string;
      instanceRole?: InstanceRole;
    }): Promise<User> {
      const now = new Date().toISOString();
      const row = {
        ...input,
        email: input.email.toLowerCase(),
        instanceRole: input.instanceRole ?? "member",
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(users).values(row);
      return toUser(row as Row);
    },

    async findByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      const row = rows[0];
      return row ? { ...toUser(row), passwordHash: row.passwordHash } : null;
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

    async updatePassword(id: string, passwordHash: string): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date().toISOString() })
        .where(eq(users.id, id));
    },

    /** Drives first-run setup: the first account to register owns the instance. */
    async count(): Promise<number> {
      const rows = await db.select({ value: sql<number>`count(*)` }).from(users);
      return Number(rows[0]?.value ?? 0);
    },

    /** Guards the last-admin case: an instance must never be left unadministrable. */
    async countAdmins(): Promise<number> {
      const rows = await db
        .select({ value: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.instanceRole, "admin"));
      return Number(rows[0]?.value ?? 0);
    },

    async list(limit = 200): Promise<User[]> {
      const rows = await db.select().from(users).orderBy(users.createdAt).limit(limit);
      return rows.map(toUser);
    },

    /** Memberships and auth sessions go with it: both cascade on this row. */
    async remove(id: string): Promise<void> {
      await db.delete(users).where(eq(users.id, id));
    },
  };
}

export type UserRepository = ReturnType<typeof userRepository>;
