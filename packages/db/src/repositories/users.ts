import type { User } from "@zelyq/core";
import { eq, sql } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { users } from "../schema/sqlite.js";

type Row = typeof users.$inferSelect;

function toUser(row: Row): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt };
}

export function userRepository(db: ZelyqDb) {
  return {
    async create(input: {
      id: string;
      email: string;
      name: string;
      passwordHash: string;
    }): Promise<User> {
      const now = new Date().toISOString();
      const row = { ...input, email: input.email.toLowerCase(), createdAt: now, updatedAt: now };
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

    /** Drives first-run setup: the first account to register owns the instance. */
    async count(): Promise<number> {
      const rows = await db.select({ value: sql<number>`count(*)` }).from(users);
      return Number(rows[0]?.value ?? 0);
    },
  };
}

export type UserRepository = ReturnType<typeof userRepository>;
