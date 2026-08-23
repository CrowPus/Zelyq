import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  type LoginInput,
  newId,
  type RegisterInput,
  type SessionResponse,
  slugify,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt parameters. N=2^15 costs roughly 100ms per hash on a modern core:
 * slow enough to make offline guessing expensive, fast enough that a sign-in
 * does not feel stalled.
 *
 * `maxmem` must be set explicitly. These parameters need 128 * N * r bytes,
 * which is exactly 32 MiB — Node's default ceiling — so the call fails without
 * headroom.
 */
const SCRYPT = { N: 32_768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 } as const;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(hashHex!, "hex");

  const derived = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });

  // Constant-time: a length-dependent early return would leak information.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Tokens are compared by hash, so a database dump yields no usable sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Read at call time, not captured at construction: these are editable in the
 * settings screen and must take effect without a restart.
 */
export interface AuthConfig {
  allowRegistration: () => Promise<boolean>;
  sessionTtlDays: () => Promise<number>;
}

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly config: AuthConfig,
  ) {}

  /** True when nobody has signed up yet — the UI shows first-run setup. */
  async isFirstRun(): Promise<boolean> {
    return (await this.store.users.count()) === 0;
  }

  async register(input: RegisterInput): Promise<{ user: User; token: string }> {
    const firstRun = await this.isFirstRun();
    if (!firstRun && !(await this.config.allowRegistration())) {
      throw new ZelyqError(
        "forbidden",
        "Registration is closed on this instance. Ask an administrator to add you to a team.",
      );
    }

    const email = input.email.trim().toLowerCase();
    if (await this.store.users.findByEmail(email)) {
      throw new ZelyqError("conflict", "An account with that email already exists.");
    }

    const user = await this.store.users.create({
      id: newId("user"),
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      // Whoever sets the instance up administers it.
      instanceRole: firstRun ? "admin" : "member",
    });

    // Everyone lands in a team of their own; sharing is adding members to it.
    const team = await this.store.teams.create({
      id: newId("team"),
      name: firstRun ? "Default team" : `${user.name}'s team`,
      slug: await this.uniqueSlug(slugify(firstRun ? "default" : user.name, "team")),
    });
    await this.store.teams.addMember(team.id, user.id, "owner");

    // Projects created before accounts existed have no team. The first account
    // adopts them, so an upgrade does not appear to lose everything.
    if (firstRun) {
      const adopted = await this.store.projects.reassignTeam(null, team.id);
      if (adopted > 0) {
        await this.store.teams.updateMemberRole(team.id, user.id, "owner");
      }
    }

    return { user, token: await this.createSession(user.id) };
  }

  async login(input: LoginInput): Promise<{ user: User; token: string }> {
    const record = await this.store.users.findByEmail(input.email.trim().toLowerCase());

    // Hash even when the account is unknown, so response time does not reveal
    // which emails are registered.
    const ok = record
      ? await verifyPassword(input.password, record.passwordHash)
      : await verifyPassword(input.password, await hashPassword(randomUUID()));

    if (!record || !ok) {
      throw new ZelyqError("unauthorized", "Incorrect email or password.");
    }

    const { passwordHash: _ignored, ...user } = record;
    return { user, token: await this.createSession(user.id) };
  }

  /**
   * Changing the password ends every other session.
   *
   * The usual reason someone changes a password is that they think it is known
   * to someone else; leaving that person's session alive would defeat the act.
   * The caller's own session is replaced with a fresh one so they are not
   * signed out of the device they are standing at.
   */
  /**
   * Confirms the caller's own password before something irreversible. A session
   * left open on a shared machine should not be enough to delete an account.
   */
  async confirmPassword(user: User, password: string): Promise<void> {
    const record = await this.store.users.findByEmail(user.email);
    if (!record || !(await verifyPassword(password, record.passwordHash))) {
      throw new ZelyqError("unauthorized", "That is not your password.");
    }
  }

  async changePassword(
    user: User,
    input: { currentPassword: string; newPassword: string },
  ): Promise<{ token: string }> {
    const record = await this.store.users.findByEmail(user.email);
    if (!record || !(await verifyPassword(input.currentPassword, record.passwordHash))) {
      throw new ZelyqError("unauthorized", "That is not your current password.");
    }

    if (input.currentPassword === input.newPassword) {
      throw ZelyqError.badRequest("The new password must be different from the current one.");
    }

    await this.store.users.updatePassword(user.id, await hashPassword(input.newPassword));
    await this.store.authSessions.removeForUser(user.id);
    return { token: await this.createSession(user.id) };
  }

  /**
   * Changing the email requires the password. A session left open on a shared
   * machine would otherwise be enough to move the account to an address the
   * owner does not control.
   */
  async updateProfile(
    user: User,
    input: { name?: string; email?: string; currentPassword?: string },
  ): Promise<User> {
    const patch: { name?: string; email?: string } = {};

    if (input.name !== undefined && input.name.trim() !== user.name) {
      patch.name = input.name.trim();
    }

    const email = input.email?.trim().toLowerCase();
    if (email && email !== user.email) {
      if (!input.currentPassword) {
        throw new ZelyqError("unauthorized", "Enter your password to change your email address.");
      }

      const record = await this.store.users.findByEmail(user.email);
      if (!record || !(await verifyPassword(input.currentPassword, record.passwordHash))) {
        throw new ZelyqError("unauthorized", "That is not your current password.");
      }

      if (await this.store.users.findByEmail(email)) {
        throw new ZelyqError("conflict", "Another account already uses that email address.");
      }

      patch.email = email;
    }

    if (Object.keys(patch).length > 0) await this.store.users.updateProfile(user.id, patch);
    return (await this.store.users.findById(user.id)) ?? user;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const session = await this.store.authSessions.findByTokenHash(hashToken(token));
    if (session) await this.store.authSessions.remove(session.id);
  }

  /** Resolves a cookie value to a user, or null. Expired sessions are deleted. */
  async resolve(token: string | undefined): Promise<User | null> {
    if (!token) return null;

    const session = await this.store.authSessions.findByTokenHash(hashToken(token));
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.store.authSessions.remove(session.id);
      return null;
    }

    await this.store.authSessions.touch(session.id);
    return await this.store.users.findById(session.userId);
  }

  async describe(user: User): Promise<SessionResponse> {
    return { user, teams: await this.store.teams.listForUser(user.id) };
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const ttlDays = await this.config.sessionTtlDays();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    await this.store.authSessions.create({
      id: randomUUID(),
      userId,
      tokenHash: hashToken(token),
      expiresAt,
    });

    return token;
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    for (let attempt = 2; await this.store.teams.findBySlug(slug); attempt++) {
      slug = `${base}-${attempt}`;
    }
    return slug;
  }
}
