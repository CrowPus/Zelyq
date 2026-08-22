import { eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { settings } from "../schema/sqlite.js";

/**
 * A flat key/value store for instance configuration. Values are strings;
 * secrets arrive already encrypted, so this layer never sees a plaintext key.
 */
export function settingsRepository(db: ZelyqDb) {
  return {
    async all(): Promise<Record<string, string>> {
      const rows = await db.select().from(settings);
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },

    async get(key: string): Promise<string | null> {
      const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      return rows[0]?.value ?? null;
    },

    async set(key: string, value: string): Promise<void> {
      const now = new Date().toISOString();
      const existing = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      if (existing.length > 0) {
        await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value, updatedAt: now });
      }
    },

    async remove(key: string): Promise<void> {
      await db.delete(settings).where(eq(settings.key, key));
    },
  };
}

export type SettingsRepository = ReturnType<typeof settingsRepository>;
