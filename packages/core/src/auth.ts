import { z } from "zod";
import { accountServiceSchema } from "./account-service.js";

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

/** Instance-wide privilege, separate from any team role. */
export const instanceRoleSchema = z.enum(["member", "admin"]);
export type InstanceRole = z.infer<typeof instanceRoleSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  instanceRole: instanceRoleSchema,
  createdAt: z.string().datetime(),
  /** Whether signing in also asks for a code from an authenticator app. */
  twoFactorEnabled: z.boolean().optional(),
  /** The person's language (BCP 47) and IANA time zone; null or absent: the browser's own. */
  locale: z.string().nullable().optional(),
  timeZone: z.string().nullable().optional(),
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

/** A 6-digit authenticator code, or a recovery code (spaces and dashes ignored). */
export const twoFactorCodeSchema = z
  .string()
  .trim()
  .min(6, "Enter the 6-digit code")
  .max(40)
  .transform((value) => value.replace(/[\s-]/g, ""));

/** The second step of signing in, when the account has two-factor sign-in on. */
export const loginTwoFactorSchema = z.object({
  challenge: z.string().min(16).max(200),
  code: twoFactorCodeSchema,
});

/** Turning two-factor sign-in on: the first code proves the app was set up. */
export const enableTwoFactorSchema = z.object({ code: twoFactorCodeSchema });

/** Turning it off, or making new recovery codes: the password, and a code. */
export const confirmTwoFactorSchema = z.object({
  password: z.string().min(1).max(200),
  code: twoFactorCodeSchema,
});

/** Starting set-up asks for the password: an open session alone is not enough. */
export const setupTwoFactorSchema = z.object({ password: z.string().min(1).max(200) });

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

/** The person's language and time zone. Null puts either back to the browser's own. */
export const preferencesSchema = z.object({
  locale: z.string().max(35).refine(isLocale, "That is not a language tag").nullable().optional(),
  timeZone: z.string().max(64).refine(isTimeZone, "That is not a time zone").nullable().optional(),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

/** One signed-in browser or device, as its owner sees it. */
export interface SignedInSession {
  id: string;
  /** This is the session the request came from. */
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/** What signing in with a password answers when a code is needed next. */
export interface TwoFactorRequired {
  twoFactor: { challenge: string };
}

export const updateProfileSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    email: z.string().email().max(320).optional(),
    /** Required to change the email — see the route for why. */
    currentPassword: z.string().max(200).optional(),
  })
  .refine((input) => input.name !== undefined || input.email !== undefined, {
    message: "Nothing to change",
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Asks for a reset link. The answer is the same whether or not the account exists. */
export const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** The token comes from the emailed link; the link itself is never sent back. */
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Name and password only when the invitation creates the account. */
export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().min(1).max(80).optional(),
  password: passwordSchema.optional(),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export const teamStatusSchema = z.enum(["active", "paused", "read_only", "suspended"]);
export type TeamStatus = z.infer<typeof teamStatusSchema>;

export const teamSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
  /** Missing on older answers: active. */
  status: teamStatusSchema.optional(),
  /** What the team's members are shown while it is not active. */
  statusMessage: z.string().nullable().optional(),
  /** Features switched off for this person in this team: the screens hide them. */
  switchedOff: z.array(z.string()).optional(),
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
  /**
   * The account service this server is managed by, or null when self-hosted.
   * When set, the person's email, password, account and billing live there.
   */
  accounts: accountServiceSchema.nullable().optional(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
