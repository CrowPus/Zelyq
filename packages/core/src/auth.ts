import { z } from "zod";

/**
 * Roles are ordered, and every permission check is "at least this role".
 * Keeping them ranked avoids a permission matrix that drifts out of sync with
 * the routes it is supposed to describe.
 *
 *   viewer  — read the project, its files, and the transcript
 *   editor  — everything a viewer can do, plus change things: prompt the agent,
 *             write files, run previews, restore snapshots
 *   admin   — editor, plus manage members and delete projects
 *   owner   — admin, plus transfer or delete the team itself
 */
export const roleSchema = z.enum(["viewer", "editor", "admin", "owner"]);
export type Role = z.infer<typeof roleSchema>;

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

/** Ordered for UI pickers, least privileged first. */
export const ROLES: Role[] = ["viewer", "editor", "admin", "owner"];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: "Read projects, files, and conversations",
  editor: "Everything a viewer can do, plus build, edit, and run previews",
  admin: "Everything an editor can do, plus manage members and delete projects",
  owner: "Full control, including the team itself",
};

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof userSchema>;

/**
 * Long enough to resist offline guessing, with no composition rules. Character
 * classes push people toward `Password1!`; length is what actually helps.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password must be at most 200 characters");

export const registerSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(80),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
});
export type Team = z.infer<typeof teamSchema>;

/** A team as it appears to one member: the team plus that member's role. */
export const teamMembershipSchema = teamSchema.extend({ role: roleSchema });
export type TeamMembership = z.infer<typeof teamMembershipSchema>;

export const teamMemberSchema = z.object({
  userId: z.string(),
  teamId: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: roleSchema,
  joinedAt: z.string().datetime(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const createTeamSchema = z.object({ name: z.string().min(1).max(80) });
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const addMemberSchema = z.object({
  email: z.string().email().max(320),
  role: roleSchema.default("editor"),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z.object({ role: roleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** What the browser gets on sign-in and on every page load. */
export const sessionResponseSchema = z.object({
  user: userSchema,
  teams: z.array(teamMembershipSchema),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
