import type { Role, Team, TeamMember, TeamMembership } from "@zelyq/core";
import { and, asc, eq, gt, ne, or } from "drizzle-orm";
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

    /** Every team on the server, oldest first: for its administrator's plans page. */
    async listAll(): Promise<Team[]> {
      return await db.select().from(teams).orderBy(asc(teams.createdAt));
    },

    /**
     * A page of every team, oldest first, after the team `after` (its id and
     * creation time): stable while teams are added, for the admin API.
     */
    async listPage(
      after: { id: string; createdAt: string } | null,
      limit: number,
    ): Promise<Team[]> {
      return await db
        .select()
        .from(teams)
        .where(
          after
            ? or(
                gt(teams.createdAt, after.createdAt),
                and(eq(teams.createdAt, after.createdAt), gt(teams.id, after.id)),
              )
            : undefined,
        )
        .orderBy(asc(teams.createdAt), asc(teams.id))
        .limit(limit);
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
        // A team's Ops engineer is a member so Zelyq's checks apply to it, but it is not a person.
        .where(and(eq(teamMembers.teamId, teamId), ne(users.kind, "service")))
        .orderBy(asc(teamMembers.joinedAt));
      return rows.map((row) => ({ ...row, role: row.role as Role }));
    },

    /** People only: a team whose only member left is its Ops engineer has no members. */
    async countMembers(teamId: string): Promise<number> {
      const rows = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(and(eq(teamMembers.teamId, teamId), ne(users.kind, "service")));
      return rows.length;
    },

    /** Only called for a team with no members left; projects are removed first. */
    async remove(teamId: string): Promise<void> {
      await db.delete(teams).where(eq(teams.id, teamId));
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
