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
    private readonly removeImageAssets?: (userId: string) => Promise<void>,
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
    await this.removeAccount(targetId);
  }

  /**
   * What deleting this account would do, without doing it: the teams that go
   * with it (it is their only member) and the teams that stay. Refuses, as the
   * deletion would, when it would leave something nobody can administer.
   */
  async deletionPlan(targetId: string): Promise<{
    user: User;
    teamsRemoved: Array<{ id: string; name: string; apps: number }>;
    teamsKept: Array<{ id: string; name: string }>;
  }> {
    const target = await this.store.users.findById(targetId);
    if (!target) throw ZelyqError.notFound("User", targetId);
    if (await this.store.users.isService(target.id)) {
      throw new ZelyqError(
        "conflict",
        "This is a team's Ops engineer, not a person. Switch Ops off on the team's Ops page instead.",
      );
    }

    if (target.instanceRole === "admin" && (await this.store.users.countAdmins()) <= 1) {
      throw new ZelyqError(
        "conflict",
        "This is the last instance administrator. Promote someone else first.",
      );
    }

    const teams = await this.store.teams.listForUser(targetId);
    const teamsRemoved: Array<{ id: string; name: string; apps: number }> = [];
    const teamsKept: Array<{ id: string; name: string }> = [];
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
      if (members > 1) {
        teamsKept.push({ id: team.id, name: team.name });
      } else {
        const apps = (await this.store.projects.listForTeams([team.id])).length;
        teamsRemoved.push({ id: team.id, name: team.name, apps });
      }
    }
    return { user: target, teamsRemoved, teamsKept };
  }

  /** Deletes the account and the teams only it was in, with their apps and files. */
  async removeAccount(
    targetId: string,
  ): Promise<Awaited<ReturnType<AccountService["deletionPlan"]>>> {
    const plan = await this.deletionPlan(targetId);
    for (const team of plan.teamsRemoved) {
      for (const project of await this.store.projects.listForTeams([team.id])) {
        await this.projects.remove(project.id).catch(() => undefined);
      }
      await this.store.teams.remove(team.id);
    }

    await this.store.users.remove(targetId);
    await this.removeImageAssets?.(targetId);
    return plan;
  }
}
