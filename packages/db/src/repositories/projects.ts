import type { Project, ProjectStatus } from "@zelyq/core";
import { desc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { projects } from "../schema/sqlite.js";

type Row = typeof projects.$inferSelect;

function toProject(row: Row): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    template: row.template,
    status: row.status as ProjectStatus,
    statusMessage: row.statusMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function projectRepository(db: ZelyqDb) {
  return {
    async create(input: Omit<Project, "createdAt" | "updatedAt">): Promise<Project> {
      const now = new Date().toISOString();
      const row = { ...input, createdAt: now, updatedAt: now };
      await db.insert(projects).values(row);
      return toProject(row as Row);
    },

    async list(limit = 100, offset = 0): Promise<Project[]> {
      const rows = await db
        .select()
        .from(projects)
        .orderBy(desc(projects.updatedAt))
        .limit(limit)
        .offset(offset);
      return rows.map(toProject);
    },

    async findById(id: string): Promise<Project | null> {
      const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
      return rows[0] ? toProject(rows[0]) : null;
    },

    async update(
      id: string,
      patch: Partial<Pick<Project, "name" | "description" | "status" | "statusMessage">>,
    ): Promise<Project | null> {
      await db
        .update(projects)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, id));
      return await this.findById(id);
    },

    async setStatus(id: string, status: ProjectStatus, message?: string | null): Promise<void> {
      await db
        .update(projects)
        .set({ status, statusMessage: message ?? null, updatedAt: new Date().toISOString() })
        .where(eq(projects.id, id));
    },

    async remove(id: string): Promise<void> {
      await db.delete(projects).where(eq(projects.id, id));
    },
  };
}

export type ProjectRepository = ReturnType<typeof projectRepository>;
