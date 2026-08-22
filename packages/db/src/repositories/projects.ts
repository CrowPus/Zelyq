import type { Project, ProjectStatus } from "@zelyq/core";
import { desc, eq, inArray } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { projects } from "../schema/sqlite.js";

type Row = typeof projects.$inferSelect;

function toProject(row: Row): Project {
  return {
    id: row.id,
    teamId: row.teamId,
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

    /** Projects across every team the caller belongs to. */
    async listForTeams(teamIds: string[], limit = 200): Promise<Project[]> {
      if (teamIds.length === 0) return [];
      const rows = await db
        .select()
        .from(projects)
        .where(inArray(projects.teamId, teamIds))
        .orderBy(desc(projects.updatedAt))
        .limit(limit);
      return rows.map(toProject);
    },

    /** Every project, regardless of team. For migrations and maintenance only. */
    async listAll(limit = 500): Promise<Project[]> {
      const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt)).limit(limit);
      return rows.map(toProject);
    },

    async reassignTeam(fromTeamId: string | null, toTeamId: string): Promise<number> {
      const rows = await db
        .select()
        .from(projects)
        .where(fromTeamId === null ? eq(projects.teamId, "") : eq(projects.teamId, fromTeamId));
      for (const row of rows) {
        await db.update(projects).set({ teamId: toTeamId }).where(eq(projects.id, row.id));
      }
      return rows.length;
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
