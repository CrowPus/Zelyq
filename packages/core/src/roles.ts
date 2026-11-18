// No zod here: the web app reads these before anything else loads.

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
export type Role = "viewer" | "editor" | "admin" | "owner";

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
