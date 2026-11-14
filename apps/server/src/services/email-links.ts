import { randomBytes, randomUUID } from "node:crypto";
import { newId, type Role, roleAtLeast, type User, ZelyqError } from "@zelyq/core";
import type { EmailLinkRow, PendingInviteRow, Store } from "@zelyq/db";
import { type AuthService, hashPassword, hashToken, isServiceEmail } from "./auth.js";
import type { MailService } from "./mail.js";
import { publicAddress, type SettingsService } from "./settings.js";

/**
 * Password resets and team invitations, by emailed link.
 *
 * Optional, and off until an admin turns it on in Settings → Email. A link in
 * an email is only any use when the person receiving it can reach this Zelyq,
 * which is true on a server and false on someone's own computer. So three
 * things must hold before any of this shows anywhere: the switch is on, a mail
 * server is set, and the public web address is set. Links are built from that
 * address alone, never from the request's Host header, which anyone can forge
 * to send a victim a link to their own server.
 *
 * Every link is single-use, short-lived and stored only as a hash. The token
 * travels in the address's #fragment, which a browser never sends to a
 * server, so it is not written to any access log on the way back either.
 */

const RESET_TTL_MS = 60 * 60_000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
/** Reset emails to one address per hour: enough to retry, too few to flood someone's inbox. */
const RESETS_PER_HOUR = 3;
/** Invitations to one address per hour, across all teams. */
const INVITES_PER_HOUR = 5;

export interface LinkAvailability {
  available: boolean;
  /** Why not, in words for an admin. Absent when available. */
  missing?: string;
}

export interface InviteDescription {
  email: string;
  teamName: string;
  role: string;
  invitedBy: string | null;
  /** True when an account already exists: accepting means signing in, not creating one. */
  accountExists: boolean;
}

export interface Logger {
  warn: (object: unknown, message: string) => void;
}

export class EmailLinkService {
  constructor(
    private readonly store: Store,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly log: Logger = { warn: () => {} },
  ) {}

  async availability(): Promise<LinkAvailability> {
    if (!(await this.settings.booleanValue("emailSignInLinks"))) {
      return {
        available: false,
        missing:
          "Password reset and invitations by email are off. Turn them on in Settings → Email, only when this Zelyq runs on a server people can reach.",
      };
    }
    if (!(await this.mail.configured())) {
      return { available: false, missing: "No mail server is set (Settings → Email)." };
    }
    if (!(await this.base())) {
      return {
        available: false,
        missing: "Set the public web address in Settings → Email, so links in email lead here.",
      };
    }
    return { available: true };
  }

  private async base(): Promise<string | null> {
    return publicAddress(await this.settings.value("publicUrl"));
  }

  private async requireAvailable(): Promise<string> {
    const state = await this.availability();
    const base = await this.base();
    if (!state.available || !base) {
      throw new ZelyqError("not_found", state.missing ?? "Email links are not available.");
    }
    return base;
  }

  // ---------------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------------

  /**
   * Sends a reset link when the address has an account. Says nothing either
   * way, and returns before the mail goes out, so neither the answer nor the
   * time it takes tells a stranger which addresses have accounts here.
   */
  async requestReset(rawEmail: string): Promise<void> {
    const base = await this.requireAvailable();
    const email = rawEmail.trim().toLowerCase();
    if (isServiceEmail(email)) return;
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    if ((await this.store.emailLinks.countSince("reset", email, since)) >= RESETS_PER_HOUR) return;
    const user = await this.store.users.findByEmail(email);
    if (!user || user.kind === "service") return;

    // A new link replaces any earlier one: only the latest email works.
    await this.store.emailLinks.voidResetsFor(user.id);
    const token = await this.issue({
      purpose: "reset",
      email,
      userId: user.id,
      ttl: RESET_TTL_MS,
    });
    const link = `${base}/reset-password#token=${token}`;
    void this.deliver(email, "Reset your Zelyq password", [
      `Hello ${user.name},`,
      "",
      "Someone asked to reset the password for your Zelyq account. To choose a new one, open this link within the next hour:",
      "",
      link,
      "",
      "If that was not you, ignore this email: your password stays as it is.",
    ]);
  }

  /** Sets a new password from a reset link, ends every session, and returns the account. */
  async resetPassword(token: string, password: string): Promise<User> {
    const link = await this.spend(token, "reset");
    if (!link.userId) throw expired();
    const user = await this.store.users.findById(link.userId);
    if (!user || (await this.store.users.isService(user.id))) throw expired();
    await this.store.users.updatePassword(user.id, await hashPassword(password));
    // Whoever knew the old password is signed out everywhere.
    await this.store.authSessions.removeForUser(user.id);
    await this.store.emailLinks.voidResetsFor(user.id);
    return user;
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  /** Emails an invitation to someone with no account yet. Sending again replaces the earlier link. */
  async invite(actor: User, teamId: string, rawEmail: string, role: Role): Promise<void> {
    const base = await this.requireAvailable();
    const email = rawEmail.trim().toLowerCase();
    if (isServiceEmail(email)) {
      throw ZelyqError.badRequest("That address is reserved for Zelyq's own accounts.");
    }
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    if ((await this.store.emailLinks.countSince("invite", email, since)) >= INVITES_PER_HOUR) {
      throw new ZelyqError(
        "rate_limited",
        `Several invitations already went to ${email} in the last hour. Try again later.`,
      );
    }
    const team = await this.store.teams.findById(teamId);
    if (!team) throw ZelyqError.notFound("Team", teamId);

    const earlier = await this.store.emailLinks.pendingInvite(teamId, email);
    if (earlier) await this.store.emailLinks.removeInvite(teamId, earlier.id);
    const token = await this.issue({
      purpose: "invite",
      email,
      teamId,
      role,
      createdBy: actor.id,
      ttl: INVITE_TTL_MS,
    });
    const link = `${base}/invite#token=${token}`;
    const sent = await this.deliver(email, `${actor.name} invited you to ${team.name} on Zelyq`, [
      "Hello,",
      "",
      `${actor.name} (${actor.email}) invited you to join the team "${team.name}" on Zelyq as ${article(role)} ${role}.`,
      "",
      "To accept, open this link within 7 days. You will choose your name and a password:",
      "",
      link,
      "",
      "If you were not expecting this, ignore this email.",
    ]);
    if (!sent) {
      const pending = await this.store.emailLinks.pendingInvite(teamId, email);
      if (pending) await this.store.emailLinks.removeInvite(teamId, pending.id);
      throw ZelyqError.badRequest(
        `The invitation email to ${email} was not sent. Check Settings → Email and send a test.`,
      );
    }
  }

  /** Tells someone who already has an account that they were added. Best effort: a failure is only logged. */
  async notifyAdded(actor: User, teamId: string, member: User, role: Role): Promise<void> {
    if (!(await this.availability()).available) return;
    const base = await this.base();
    const team = await this.store.teams.findById(teamId);
    if (!base || !team) return;
    void this.deliver(member.email, `${actor.name} added you to ${team.name} on Zelyq`, [
      `Hello ${member.name},`,
      "",
      `${actor.name} added you to the team "${team.name}" on Zelyq as ${article(role)} ${role}.`,
      "",
      `Open it here: ${base}/teams/${team.id}`,
    ]);
  }

  async pendingInvites(teamId: string): Promise<PendingInviteRow[]> {
    return await this.store.emailLinks.pendingInvites(teamId);
  }

  async withdraw(teamId: string, inviteId: string): Promise<boolean> {
    return await this.store.emailLinks.removeInvite(teamId, inviteId);
  }

  /** What the invitation page shows before anyone accepts. Does not spend the link. */
  async describeInvite(token: string): Promise<InviteDescription> {
    const link = await this.valid(token, "invite");
    const team = link.teamId ? await this.store.teams.findById(link.teamId) : null;
    if (!team) throw expired();
    const inviter = link.createdBy ? await this.store.users.findById(link.createdBy) : null;
    return {
      email: link.email,
      teamName: team.name,
      role: link.role ?? "viewer",
      invitedBy: inviter?.name ?? null,
      accountExists: Boolean(await this.store.users.findByEmail(link.email)),
    };
  }

  /**
   * Accepts an invitation. With no account for the address, one is created
   * from the name and password given; open registration does not matter,
   * because a team admin asked for this person by name. With an account, the
   * person must already be signed in as it: the link proves they read that
   * inbox, not that they own the account.
   */
  async acceptInvite(
    token: string,
    input: { name?: string; password?: string },
    signedIn: User | null,
  ): Promise<{ user: User; teamId: string; created: boolean }> {
    const link = await this.valid(token, "invite");
    if (!link.teamId) throw expired();
    const existing = await this.store.users.findByEmail(link.email);
    if (existing?.kind === "service") throw expired();

    if (existing) {
      if (!signedIn || signedIn.id !== existing.id) {
        throw new ZelyqError(
          "unauthorized",
          `Sign in as ${link.email} first, then open the invitation link again.`,
        );
      }
      if (!(await this.store.emailLinks.markUsed(link.id))) throw expired();
      await this.join(link, existing.id);
      return { user: signedIn, teamId: link.teamId, created: false };
    }

    if (!input.name?.trim() || !input.password) {
      throw ZelyqError.badRequest("Enter your name and choose a password.");
    }
    if (!(await this.store.emailLinks.markUsed(link.id))) throw expired();
    const user = await this.store.users.create({
      id: newId("user"),
      email: link.email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      instanceRole: "member",
    });
    await this.join(link, user.id);
    return { user, teamId: link.teamId, created: true };
  }

  /** Signs the account in: the route sets the cookie. */
  async session(userId: string): Promise<string> {
    return await this.auth.startSession(userId);
  }

  private async join(link: EmailLinkRow, userId: string): Promise<void> {
    if (!link.teamId) return;
    const role = (link.role ?? "viewer") as Role;
    const current = await this.store.teams.roleOf(link.teamId, userId);
    if (!current) await this.store.teams.addMember(link.teamId, userId, role);
    else if (!roleAtLeast(current, role)) {
      await this.store.teams.updateMemberRole(link.teamId, userId, role);
    }
  }

  // ---------------------------------------------------------------------------

  private async issue(input: {
    purpose: "reset" | "invite";
    email: string;
    userId?: string;
    teamId?: string;
    role?: string;
    createdBy?: string;
    ttl: number;
  }): Promise<string> {
    // Housekeeping on the way: expired links are worthless, so nothing else needs to sweep them.
    await this.store.emailLinks.purgeExpired().catch(() => {});
    const token = randomBytes(32).toString("base64url");
    await this.store.emailLinks.create({
      id: randomUUID(),
      purpose: input.purpose,
      tokenHash: hashToken(token),
      email: input.email,
      userId: input.userId ?? null,
      teamId: input.teamId ?? null,
      role: input.role ?? null,
      createdBy: input.createdBy ?? null,
      expiresAt: new Date(Date.now() + input.ttl).toISOString(),
    });
    return token;
  }

  private async valid(token: string, purpose: "reset" | "invite"): Promise<EmailLinkRow> {
    const link = await this.store.emailLinks.findByTokenHash(hashToken(token));
    if (
      !link ||
      link.purpose !== purpose ||
      link.usedAt ||
      new Date(link.expiresAt).getTime() <= Date.now()
    ) {
      throw expired();
    }
    return link;
  }

  private async spend(token: string, purpose: "reset" | "invite"): Promise<EmailLinkRow> {
    const link = await this.valid(token, purpose);
    if (!(await this.store.emailLinks.markUsed(link.id))) throw expired();
    return link;
  }

  private async deliver(to: string, subject: string, lines: string[]): Promise<boolean> {
    try {
      const result = await this.mail.send({ to: [to], subject, text: lines.join("\n") });
      if (result.failed.length > 0 || result.sent === 0) {
        this.log.warn({ failed: result.failed.length }, "An email link was not sent");
        return false;
      }
      return true;
    } catch (error) {
      this.log.warn({ error: (error as Error).message }, "An email link was not sent");
      return false;
    }
  }
}

function expired(): ZelyqError {
  return new ZelyqError(
    "not_found",
    "This link has expired or was already used. Ask for a new one.",
  );
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
