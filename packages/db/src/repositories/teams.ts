import type { Role, Team, TeamMember, TeamMembership } from "@zelyq/core";
import { and, asc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { teamMembers, teams, users } from "../schema/sqlite.js";

export function teamRepository(db: ZelyqDb) {
  return {
    async create(input: { id: string; name: string; slug: string }): Promise<Team> {
      const row = { ...input, createdAt: new Date().toISOString() };
      await db.insert(teams).values(row);
      return row;
    },

    async findById(id: string): Promise<Team | null> {
      const rows = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findBySlug(slug: string): Promise<Team | null> {
      const rows = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
      return rows[0] ?? null;
    },

    async addMember(teamId: string, userId: string, role: Role): Promise<void> {
      await db
        .insert(teamMembers)
        .values({ teamId, userId, role, joinedAt: new Date().toISOString() });
    },

    async updateMemberRole(teamId: string, userId: string, role: Role): Promise<void> {
      await db
        .update(teamMembers)
        .set({ role })
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    },

    async removeMember(teamId: string, userId: string): Promise<void> {
      await db
        .delete(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    },

    /** The caller's role in a team, or null when they are not a member. */
    async roleOf(teamId: string, userId: string): Promise<Role | null> {
      const rows = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .limit(1);
      return (rows[0]?.role as Role) ?? null;
    },

    async listForUser(userId: string): Promise<TeamMembership[]> {
      const rows = await db
        .select({
          id: teams.id,
          name: teams.name,
          slug: teams.slug,
          createdAt: teams.createdAt,
          role: teamMembers.role,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(eq(teamMembers.userId, userId))
        .orderBy(asc(teams.createdAt));
      return rows.map((row) => ({ ...row, role: row.role as Role }));
    },

    async listMembers(teamId: string): Promise<TeamMember[]> {
      const rows = await db
        .select({
          userId: users.id,
          teamId: teamMembers.teamId,
          email: users.email,
          name: users.name,
          role: teamMembers.role,
          joinedAt: teamMembers.joinedAt,
        })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(eq(teamMembers.teamId, teamId))
        .orderBy(asc(teamMembers.joinedAt));
      return rows.map((row) => ({ ...row, role: row.role as Role }));
    },

    /** Guards the last-owner case: a team must never be left without one. */
    async countOwners(teamId: string): Promise<number> {
      const rows = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "owner")));
      return rows.length;
    },
  };
}

export type TeamRepository = ReturnType<typeof teamRepository>;
