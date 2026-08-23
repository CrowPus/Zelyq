import { type User, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { ProjectService } from "./projects.js";

/**
 * Deleting an account, which is more than deleting a row.
 *
 * Memberships and auth sessions cascade off the user row, so the database
 * handles those. Projects do not: they belong to a *team*, and a team outlives
 * its last member unless something says otherwise. Left alone, deleting the
 * only member of a team strands the team, its projects, and every file those
 * projects own on disk, with nobody able to reach them again.
 *
 * So the rules are explicit here rather than implied by foreign keys.
 */
export class AccountService {
  constructor(
    private readonly store: Store,
    private readonly projects: ProjectService,
  ) {}

  async list(): Promise<User[]> {
    return await this.store.users.list();
  }

  /**
   * Removes a user and anything only they could have reached.
   *
   * Refuses rather than guesses in the two cases where deleting would leave
   * something unadministrable — the last instance admin, and the last owner of
   * a team that still has other members. Both are recoverable by the caller
   * (promote someone first); silently reassigning ownership would not be.
   */
  async deleteUser(actor: User, targetId: string): Promise<void> {
    if (actor.id !== targetId && actor.instanceRole !== "admin") {
      throw new ZelyqError("forbidden", "Only an instance administrator can delete another user.");
    }

    const target = await this.store.users.findById(targetId);
    if (!target) throw ZelyqError.notFound("User", targetId);

    if (target.instanceRole === "admin" && (await this.store.users.countAdmins()) <= 1) {
      throw new ZelyqError(
        "conflict",
        "This is the last instance administrator. Promote someone else first.",
      );
    }

    const teams = await this.store.teams.listForUser(targetId);

    // Check every team before deleting anything: a refusal halfway through
    // would leave the account partly dismantled.
    for (const team of teams) {
      const members = await this.store.teams.countMembers(team.id);
      if (
        members > 1 &&
        team.role === "owner" &&
        (await this.store.teams.countOwners(team.id)) <= 1
      ) {
        throw new ZelyqError(
          "conflict",
          `You are the last owner of "${team.name}". Promote another owner before deleting this account.`,
        );
      }
    }

    for (const team of teams) {
      if ((await this.store.teams.countMembers(team.id)) > 1) continue;

      // Nobody else can reach these once the account is gone. ProjectService
      // removes the files as well as the row.
      for (const project of await this.store.projects.listForTeams([team.id])) {
        await this.projects.remove(project.id).catch(() => undefined);
      }
      await this.store.teams.remove(team.id);
    }

    await this.store.users.remove(targetId);
  }
}
