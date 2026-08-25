import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
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

/** How long an in-flight OIDC sign-in has to complete before it must restart. */
const OIDC_STATE_TTL_MS = 10 * 60_000;

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
  oidc?: {
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  };
}

export interface OidcStart {
  authorizationUrl: string;
  state: string;
  verifier: string;
}

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

interface OidcClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
}

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly config: AuthConfig,
  ) {
    this.oidcStateSecret = randomBytes(32);
  }

  private readonly oidcStateSecret: Buffer;
  /**
   * Single-use guard for in-flight state values, keyed to when each one
   * stops being valid. `oidcStart` is unauthenticated and callable at any
   * rate, so an abandoned flow — someone who never returns from the
   * provider, or a deliberate flood of start requests — must not grow this
   * forever; every call prunes what's already expired before adding its own
   * entry, so the map stays bounded to what's actually still live rather
   * than accumulating for the life of the process.
   */
  private readonly oidcStates = new Map<string, number>();

  oidcEnabled(): boolean {
    const oidc = this.config.oidc;
    return Boolean(oidc?.issuer && oidc.clientId && oidc.clientSecret && oidc.redirectUri);
  }

  async oidcStart(): Promise<OidcStart> {
    const oidc = this.requireOidc();
    const metadata = await this.oidcMetadata(oidc.issuer);
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    this.pruneExpiredOidcStates();
    this.oidcStates.set(state, Date.now() + OIDC_STATE_TTL_MS);
    const nonce = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    // The provider only ever gets this one opaque value back to us verbatim
    // in its callback — so what we hand it here has to be the *signed* state,
    // the same one the callback route compares against the cookie. Sending
    // the raw, unsigned `state` instead (as this used to) meant the value the
    // provider echoed back could never match what the cookie held: no real
    // sign-in could ever complete.
    const signedState = this.signState(state, nonce);
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: oidc.clientId,
      redirect_uri: oidc.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: signedState,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return { authorizationUrl: url.toString(), state: signedState, verifier };
  }

  async oidcComplete(input: {
    code: string;
    state: string;
    verifier: string;
  }): Promise<{ user: User; token: string }> {
    const oidc = this.requireOidc();
    const state = this.verifyState(input.state);
    if (!state || !this.oidcStates.delete(state.value)) {
      throw new ZelyqError("unauthorized", "The identity sign-in expired. Start again.");
    }
    const metadata = await this.oidcMetadata(oidc.issuer);
    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: oidc.redirectUri,
        client_id: oidc.clientId,
        client_secret: oidc.clientSecret,
        code_verifier: input.verifier,
      }),
    });
    if (!response.ok)
      throw new ZelyqError("unauthorized", "The identity provider rejected sign-in.");
    const token = (await response.json()) as { access_token?: string };
    if (!token.access_token || !metadata.userinfo_endpoint) {
      throw new ZelyqError("internal", "The identity provider returned an incomplete response.");
    }
    const claimsResponse = await fetch(metadata.userinfo_endpoint, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!claimsResponse.ok)
      throw new ZelyqError("unauthorized", "Could not read your identity provider profile.");
    const claims = (await claimsResponse.json()) as OidcClaims;
    if (!claims.sub || !claims.email)
      throw new ZelyqError("unauthorized", "Your identity provider did not provide an email.");
    if (
      claimsResponse.url &&
      new URL(claimsResponse.url).origin !== new URL(metadata.userinfo_endpoint).origin
    ) {
      throw new ZelyqError("unauthorized", "The identity provider returned an invalid profile.");
    }
    const user = await this.findOrCreateOidcUser(metadata.issuer, claims);
    return { user, token: await this.createSession(user.id) };
  }

  private requireOidc(): {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  } {
    const oidc = this.config.oidc;
    if (!oidc?.issuer || !oidc.clientId || !oidc.clientSecret || !oidc.redirectUri) {
      throw new ZelyqError("not_found", "Single sign-on is not enabled on this instance.");
    }
    return {
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
      redirectUri: oidc.redirectUri,
    };
  }

  private async oidcMetadata(issuer: string): Promise<OidcMetadata> {
    const response = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    if (!response.ok) throw new ZelyqError("internal", "Could not reach the identity provider.");
    const metadata = (await response.json()) as OidcMetadata;
    if (
      metadata.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "") ||
      !metadata.authorization_endpoint ||
      !metadata.token_endpoint ||
      !metadata.userinfo_endpoint
    ) {
      throw new ZelyqError("internal", "The identity provider configuration is invalid.");
    }
    return metadata;
  }

  private signState(value: string, nonce: string): string {
    const payload = Buffer.from(
      JSON.stringify({ value, nonce, expiresAt: Date.now() + OIDC_STATE_TTL_MS }),
    ).toString("base64url");
    const signature = createHmac("sha256", this.oidcStateSecret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  }

  /** Called on every `oidcStart` so an unauthenticated flood of starts can't
   * grow `oidcStates` past what's actually still within its TTL. */
  private pruneExpiredOidcStates(): void {
    const now = Date.now();
    for (const [value, expiresAt] of this.oidcStates) {
      if (expiresAt <= now) this.oidcStates.delete(value);
    }
  }

  private verifyState(signed: string): { value: string; nonce: string } | null {
    const [payload, signature] = signed.split(".");
    if (!payload || !signature) return null;
    const expected = createHmac("sha256", this.oidcStateSecret).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      value?: string;
      nonce?: string;
      expiresAt?: number;
    };
    return parsed.value && parsed.nonce && parsed.expiresAt && parsed.expiresAt > Date.now()
      ? { value: parsed.value, nonce: parsed.nonce }
      : null;
  }

  private async findOrCreateOidcUser(issuer: string, claims: OidcClaims): Promise<User> {
    const linked = await this.store.oidcIdentities.find(issuer, claims.sub);
    if (linked) return (await this.store.users.findById(linked.userId))!;
    const email = claims.email!.trim().toLowerCase();
    // Applies before existing/new is even decided — an unverified claim must
    // never establish an identity either way. Checking it only inside the
    // "existing account" branch (as this used to) left the "new account"
    // branch free to create an account under an email the caller does not
    // actually control, which a later, genuinely verified sign-in from the
    // real owner would then silently link to — a standing backdoor into
    // their account. See docs/configuration.md's OIDC section.
    if (claims.email_verified !== true) {
      throw new ZelyqError(
        "unauthorized",
        "Your identity provider did not confirm your email address, so it cannot be used to sign in here.",
      );
    }
    const existing = await this.store.users.findByEmail(email);
    if (existing) {
      await this.store.oidcIdentities.create({
        id: randomUUID(),
        userId: existing.id,
        issuer,
        subject: claims.sub,
      });
      return existing;
    }
    if (!(await this.isFirstRun()) && !(await this.config.allowRegistration())) {
      throw new ZelyqError("forbidden", "Registration is closed on this instance.");
    }
    const firstRun = await this.isFirstRun();
    const user = await this.store.users.create({
      id: newId("user"),
      email,
      name: (claims.name ?? claims.preferred_username ?? email).trim().slice(0, 80),
      passwordHash: `oidc$${randomBytes(32).toString("hex")}`,
      instanceRole: firstRun ? "admin" : "member",
    });
    const team = await this.store.teams.create({
      id: newId("team"),
      name: firstRun ? "Default team" : `${user.name}'s team`,
      slug: await this.uniqueSlug(slugify(firstRun ? "default" : user.name, "team")),
    });
    await this.store.teams.addMember(team.id, user.id, "owner");
    if (firstRun) await this.store.projects.reassignTeam(null, team.id);
    await this.store.oidcIdentities.create({
      id: randomUUID(),
      userId: user.id,
      issuer,
      subject: claims.sub,
    });
    return user;
  }

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
