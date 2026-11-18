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
  type AccountService,
  type InstanceStatus,
  type LoginInput,
  newId,
  type RegisterInput,
  type SessionResponse,
  slugify,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { ProductActivity } from "./product-activity.js";
import type { SecretBox } from "./secrets.js";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchTotp,
  otpauthUri,
} from "./totp.js";

/** How long the code step of signing in may take after the password. */
const TWO_FACTOR_CHALLENGE_MS = 5 * 60 * 1000;
/** Wrong codes allowed per account before its code checks pause. */
const TWO_FACTOR_MAX_FAILURES = 5;
const TWO_FACTOR_LOCK_MS = 10 * 60 * 1000;

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
/** How often a session's last-seen time is written — see `touchSession`. */
const SESSION_TOUCH_INTERVAL_MS = 60_000;

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
  /** Managed mode: people come from this account service (see @zelyq/core account-service). */
  accounts?: AccountService;
  /** Managed mode: the server's own administrators may sign in with a password (off unless set). */
  localSignIn?: boolean;
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
  /** Product activity: sign-ups and sign-ins. */
  activity?: ProductActivity;
  /** Features switched off for a person in a team (feature switches). */
  switchedOff?: (userId: string, teamId: string) => Promise<string[]>;
  /** Encrypts the two-factor secret at rest with the server's key. */
  secrets?: SecretBox;

  /** Password accepted, code still owed: challenge → who, until when, tries so far. */
  private readonly twoFactorChallenges = new Map<
    string,
    { userId: string; expires: number; attempts: number }
  >();
  /** Wrong codes per account, so guessing across fresh challenges goes nowhere. */
  private readonly twoFactorFailures = new Map<string, { count: number; since: number }>();

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

  /**
   * Managed mode, for this person: their email, password and account belong to
   * the account service. The server's own administrators keep theirs here, so
   * they can always reach it. Null when self-hosted.
   */
  managedFor(user: User | null): AccountService | null {
    const accounts = this.config.accounts ?? null;
    if (!accounts || user?.instanceRole === "admin") return null;
    return accounts;
  }

  /** Refuses, in plain words, something the account service does for this person. */
  requireLocal(user: User | null, what: string): void {
    const accounts = this.managedFor(user);
    if (accounts) {
      throw new ZelyqError("forbidden", `${what} at ${accounts.name}.`, { reason: "managed" });
    }
  }

  /**
   * Managed: a password sign-in here (even the server's own administrator's) only
   * while `ZELYQ_LOCAL_SIGNIN=on`. The server is run from the admin, so by default
   * there is no password here for anyone to guess.
   */
  localSignInOpen(): boolean {
    return !this.config.accounts || this.config.localSignIn === true;
  }

  private requireLocalSignIn(): void {
    if (!this.localSignInOpen()) {
      throw new ZelyqError(
        "forbidden",
        "Signing in with a password is switched off on this server. It is run from the admin.",
        { reason: "local_signin_off" },
      );
    }
  }

  /** A reset email goes out only for an account whose password lives here. */
  async mayResetPassword(email: string): Promise<boolean> {
    if (!this.config.accounts) return true;
    if (!this.localSignInOpen()) return false;
    const user = await this.store.users.findByEmail(email.trim().toLowerCase());
    return user?.instanceRole === "admin";
  }

  /** The single sign-on issuer as configured, for linking people ahead of their first sign-in. */
  oidcIssuer(): string | null {
    return this.oidcEnabled() ? (this.config.oidc?.issuer ?? null) : null;
  }

  /** A team name nobody else has, as a slug. */
  async freeTeamSlug(name: string): Promise<string> {
    return await this.uniqueSlug(slugify(name, "team"));
  }

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
  }): Promise<{ user: User; token: string } | { user: User; challenge: string }> {
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
    // The identity provider proves the email, not the phone: with two-factor
    // on, single sign-on stops at the code step, like a password does.
    if (user.twoFactorEnabled) return { user, challenge: await this.startChallenge(user.id) };
    const session = await this.createSession(user.id);
    this.activity?.record("account.signed_in", { userId: user.id, detail: { method: "sso" } });
    return { user, token: session };
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
    // An account service may have linked the person already (admin API), under
    // the issuer as configured: with or without a trailing slash, it is the same.
    const linked =
      (await this.store.oidcIdentities.find(issuer, claims.sub)) ??
      (await this.store.oidcIdentities.find(
        issuer.endsWith("/") ? issuer.replace(/\/+$/, "") : `${issuer}/`,
        claims.sub,
      ));
    if (linked) {
      if (await this.store.users.isService(linked.userId)) throw serviceAccount();
      return (await this.store.users.findById(linked.userId))!;
    }
    const email = claims.email!.trim().toLowerCase();
    if (isServiceEmail(email)) throw serviceAccount();
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
    if (existing?.kind === "service") throw serviceAccount();
    if (existing) {
      await this.store.oidcIdentities.create({
        id: randomUUID(),
        userId: existing.id,
        issuer,
        subject: claims.sub,
      });
      return existing;
    }
    // Managed with password sign-in off, nobody sets the server up here: it is run
    // from the admin, and everyone who comes through the service is a member.
    const firstRun = (await this.isFirstRun()) && this.localSignInOpen();
    // A managed server with password sign-in on is set up by its own administrator
    // first (the setup form), so the first person through the account service never
    // becomes its owner.
    if (firstRun && this.config.accounts) {
      throw new ZelyqError("forbidden", "This server is not set up yet.");
    }
    // In managed mode the account service decides who may have an account;
    // this server's "Open registration" is about its own sign-up form.
    if (!firstRun && !this.config.accounts && !(await this.config.allowRegistration())) {
      throw new ZelyqError("forbidden", "Registration is closed on this instance.");
    }
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
    this.activity?.record("account.created", {
      userId: user.id,
      teamId: team.id,
      detail: { via: "sso" },
    });
    this.activity?.record("team.created", {
      userId: user.id,
      teamId: team.id,
      detail: { via: "signup" },
    });
    return user;
  }

  /** What this server offers at sign-in: the sign-in screen shows only this. */
  async instanceStatus(passwordReset: boolean): Promise<InstanceStatus> {
    // Managed with password sign-in off there is no setup form: the server is run from the admin.
    const firstRun = (await this.isFirstRun()) && this.localSignInOpen();
    const accounts = this.config.accounts ?? null;
    const oidc = this.oidcEnabled();
    const managed = accounts !== null;
    const reset = passwordReset && !managed;
    return {
      firstRun,
      oidcEnabled: oidc,
      passwordReset: reset,
      mode: managed ? "managed" : "self_hosted",
      accounts,
      signIn: {
        // Managed: the form is for setting the server up, and for its administrators
        // (who can always reach it, even with the account service down).
        password: !managed || firstRun,
        register: firstRun || (!managed && (await this.config.allowRegistration())),
        passwordReset: reset,
        oidc,
        oidcOnly: managed && !firstRun,
        oidcLabel: accounts ? `Continue with ${accounts.name}` : "Continue with single sign-on",
      },
    };
  }

  /** True when nobody has signed up yet — the UI shows first-run setup. */
  async isFirstRun(): Promise<boolean> {
    return (await this.store.users.count()) === 0;
  }

  async register(input: RegisterInput): Promise<{ user: User; token: string }> {
    const firstRun = await this.isFirstRun();
    // Managed with password sign-in off: nobody signs up here, not even first.
    // The server is set up from its command line (an admin key) and run from the admin.
    if (this.config.accounts && !this.localSignInOpen()) {
      throw new ZelyqError("forbidden", `Create your account at ${this.config.accounts.name}.`, {
        reason: "managed",
      });
    }
    // Managed: people sign up with the account service; this form only sets the server up.
    if (!firstRun && this.config.accounts) {
      throw new ZelyqError("forbidden", `Create your account at ${this.config.accounts.name}.`, {
        reason: "managed",
      });
    }
    if (!firstRun && !(await this.config.allowRegistration())) {
      throw new ZelyqError(
        "forbidden",
        "Registration is closed on this instance. Ask an administrator to add you to a team.",
      );
    }

    const email = input.email.trim().toLowerCase();
    if (isServiceEmail(email)) throw reservedAddress();
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

    const token = await this.createSession(user.id);
    this.activity?.record("account.created", {
      userId: user.id,
      teamId: team.id,
      detail: { via: "password" },
    });
    this.activity?.record("team.created", {
      userId: user.id,
      teamId: team.id,
      detail: { via: "signup" },
    });
    this.activity?.record("account.signed_in", { userId: user.id, detail: { method: "password" } });
    return { user, token };
  }

  async login(
    input: LoginInput,
  ): Promise<{ user: User; token: string } | { user: User; challenge: string }> {
    const record = await this.store.users.findByEmail(input.email.trim().toLowerCase());

    // Hash even when the account is unknown, so response time does not reveal
    // which emails are registered.
    const ok = record
      ? await verifyPassword(input.password, record.passwordHash)
      : await verifyPassword(input.password, await hashPassword(randomUUID()));

    // A team's Ops engineer has no password that could ever match; refused by name as well.
    if (!record || !ok || record.kind === "service") {
      throw new ZelyqError("unauthorized", "Incorrect email or password.");
    }

    const { passwordHash: _ignored, kind: _kind, ...user } = record;
    // Managed: only the server's own administrators sign in with a password here,
    // and only when that is switched on on the server itself.
    this.requireLocal(user, "Sign in with your account");
    this.requireLocalSignIn();

    // Two-factor on: the password alone opens nothing. A short-lived
    // challenge stands for "password correct", and the code completes it.
    if (user.twoFactorEnabled) return { user, challenge: await this.startChallenge(user.id) };

    const token = await this.createSession(user.id);
    this.activity?.record("account.signed_in", { userId: user.id, detail: { method: "password" } });
    return { user, token };
  }

  /** The second step of signing in: the code for a challenge `login` handed out. */
  async completeTwoFactorLogin(input: {
    challenge: string;
    code: string;
  }): Promise<{ user: User; token: string }> {
    this.pruneChallenges();
    const pending = this.twoFactorChallenges.get(input.challenge);
    if (!pending) {
      throw new ZelyqError(
        "unauthorized",
        "That sign-in took too long. Enter your email and password again.",
        { reason: "challenge_expired" },
      );
    }
    pending.attempts += 1;
    if (pending.attempts > TWO_FACTOR_MAX_FAILURES) {
      this.twoFactorChallenges.delete(input.challenge);
      throw new ZelyqError(
        "unauthorized",
        "Too many wrong codes. Enter your email and password again.",
        { reason: "challenge_expired" },
      );
    }
    const method = await this.checkSecondFactor(pending.userId, input.code);
    if (!method) {
      throw new ZelyqError("unauthorized", "That code is not right. Try the newest one.");
    }
    this.twoFactorChallenges.delete(input.challenge);
    const user = await this.store.users.findById(pending.userId);
    if (!user) throw new ZelyqError("unauthorized", "Incorrect email or password.");
    const token = await this.createSession(user.id);
    this.activity?.record("account.signed_in", {
      userId: user.id,
      detail: { method: method === "recovery" ? "recovery_code" : "two_factor" },
    });
    return { user, token };
  }

  /** "First factor accepted": a short-lived challenge only the code can complete. */
  private async startChallenge(userId: string): Promise<string> {
    // A suspended account learns that before being asked for a code.
    const state = await this.store.users.statusOf(userId);
    if (state?.status === "suspended") {
      throw new ZelyqError(
        "forbidden",
        state.reason ? `This account is suspended: ${state.reason}` : "This account is suspended.",
        { reason: "suspended" },
      );
    }
    this.pruneChallenges();
    const challenge = randomBytes(32).toString("base64url");
    this.twoFactorChallenges.set(challenge, {
      userId,
      expires: Date.now() + TWO_FACTOR_CHALLENGE_MS,
      attempts: 0,
    });
    return challenge;
  }

  private pruneChallenges(): void {
    const now = Date.now();
    for (const [key, value] of this.twoFactorChallenges) {
      if (value.expires <= now) this.twoFactorChallenges.delete(key);
    }
  }

  /**
   * Checks a code against the account: an authenticator code (used once), or
   * a recovery code (crossed off). Null when it is neither. Repeated wrong
   * codes pause checking for the account, whatever the route.
   */
  private async checkSecondFactor(
    userId: string,
    code: string,
  ): Promise<"totp" | "recovery" | null> {
    this.assertNotPaused(userId);
    const state = await this.store.users.twoFactorOf(userId);
    let method: "totp" | "recovery" | null = null;
    // A right code that lost a race to the same code sent twice: refused, but
    // not counted as a guess.
    let lostRace = false;
    if (state?.secret && /^\d{6}$/.test(code)) {
      const secret = this.openSecret(state.secret);
      const step = secret ? matchTotp(secret, code) : null;
      if (step !== null) {
        if (await this.store.users.claimTotpStep(userId, step)) method = "totp";
        else lostRace = true;
      }
    } else if (state && code.length >= 8) {
      const hashed = hashRecoveryCode(code);
      if (state.recoveryCodes.includes(hashed)) {
        const crossed = await this.store.users.claimRecoveryCode(
          userId,
          state.recoveryCodes,
          state.recoveryCodes.filter((value) => value !== hashed),
        );
        if (crossed) method = "recovery";
        else lostRace = true;
      }
    }
    if (method) this.twoFactorFailures.delete(userId);
    else if (!lostRace) this.noteFailure(userId);
    return method;
  }

  /** Refuses while an account's code checks are paused after too many wrong codes. */
  private assertNotPaused(userId: string): void {
    const failures = this.twoFactorFailures.get(userId);
    if (failures && Date.now() - failures.since > TWO_FACTOR_LOCK_MS) {
      this.twoFactorFailures.delete(userId);
    } else if (failures && failures.count >= TWO_FACTOR_MAX_FAILURES) {
      throw new ZelyqError(
        "rate_limited",
        "Too many wrong codes. Wait ten minutes, then try again.",
      );
    }
  }

  private noteFailure(userId: string): void {
    const current = this.twoFactorFailures.get(userId) ?? { count: 0, since: Date.now() };
    current.count += 1;
    this.twoFactorFailures.set(userId, current);
  }

  private sealSecret(secret: string): string {
    if (!this.secrets) throw new ZelyqError("internal", "Two-factor sign-in is not available.");
    return this.secrets.encrypt(secret);
  }

  private openSecret(stored: string): string | null {
    return this.secrets?.decrypt(stored) ?? null;
  }

  /**
   * Starts setting up two-factor sign-in: a new secret, not yet in force,
   * and the address its QR code carries. Asks for the password first.
   */
  async setupTwoFactor(
    user: User,
    password: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    this.requireLocal(user, "Set up two-factor sign-in");
    await this.confirmPassword(user, password);
    const state = await this.store.users.twoFactorOf(user.id);
    if (state?.enabledAt) {
      throw new ZelyqError("conflict", "Two-factor sign-in is already on.");
    }
    const secret = generateTotpSecret();
    await this.store.users.setTwoFactor(user.id, {
      secret: this.sealSecret(secret),
      enabledAt: null,
      lastStep: null,
      recoveryCodes: null,
    });
    return { secret, otpauthUri: otpauthUri(secret, user.email, "Zelyq") };
  }

  /** Puts it in force once the first code proves the app holds the secret. */
  async enableTwoFactor(user: User, code: string): Promise<{ recoveryCodes: string[] }> {
    this.requireLocal(user, "Set up two-factor sign-in");
    const state = await this.store.users.twoFactorOf(user.id);
    if (!state?.secret) throw ZelyqError.badRequest("Start setting up two-factor sign-in first.");
    if (state.enabledAt) throw new ZelyqError("conflict", "Two-factor sign-in is already on.");
    this.assertNotPaused(user.id);
    const secret = this.openSecret(state.secret);
    const step = secret ? matchTotp(secret, code) : null;
    if (step === null) {
      this.noteFailure(user.id);
      throw new ZelyqError(
        "unauthorized",
        "That code is not right. Check the time on your phone, then try the newest code.",
      );
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.store.users.setTwoFactor(user.id, {
      enabledAt: new Date().toISOString(),
      lastStep: step,
      recoveryCodes: recoveryCodes.map(hashRecoveryCode),
    });
    this.twoFactorFailures.delete(user.id);
    this.recordSecurity(user.id, "two_factor_on");
    return { recoveryCodes };
  }

  /** Turns it off: the password and a code (or a recovery code). */
  async disableTwoFactor(user: User, input: { password: string; code: string }): Promise<void> {
    this.requireLocal(user, "Turn off two-factor sign-in");
    await this.confirmPassword(user, input.password);
    if (!(await this.checkSecondFactor(user.id, input.code))) {
      throw new ZelyqError("unauthorized", "That code is not right.");
    }
    await this.clearTwoFactor(user.id);
    this.recordSecurity(user.id, "two_factor_off");
  }

  /** New recovery codes; the old ones stop working. */
  async regenerateRecoveryCodes(
    user: User,
    input: { password: string; code: string },
  ): Promise<{ recoveryCodes: string[] }> {
    this.requireLocal(user, "Make new recovery codes");
    await this.confirmPassword(user, input.password);
    const state = await this.store.users.twoFactorOf(user.id);
    if (!state?.enabledAt) throw ZelyqError.badRequest("Two-factor sign-in is not on.");
    if (!(await this.checkSecondFactor(user.id, input.code))) {
      throw new ZelyqError("unauthorized", "That code is not right.");
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.store.users.setTwoFactor(user.id, {
      recoveryCodes: recoveryCodes.map(hashRecoveryCode),
    });
    this.recordSecurity(user.id, "recovery_codes_renewed");
    return { recoveryCodes };
  }

  /** How many recovery codes are left, for the account page. */
  async recoveryCodesLeft(userId: string): Promise<number> {
    return (await this.store.users.twoFactorOf(userId))?.recoveryCodes.length ?? 0;
  }

  /**
   * A server administrator turning it off for someone who lost their phone
   * and their recovery codes. Their sessions end, so the next sign-in is a
   * fresh one with the password.
   */
  async resetTwoFactor(admin: User, userId: string): Promise<void> {
    if (admin.instanceRole !== "admin") {
      throw new ZelyqError("forbidden", "Only a server administrator can do that.");
    }
    if (!(await this.store.users.findById(userId))) throw ZelyqError.notFound("User", userId);
    await this.clearTwoFactor(userId);
    await this.store.authSessions.removeForUser(userId);
    this.recordSecurity(userId, "two_factor_reset_by_admin");
  }

  private recordSecurity(userId: string, action: string): void {
    this.activity?.record("account.security", { userId, detail: { action } });
  }

  private async clearTwoFactor(userId: string): Promise<void> {
    await this.store.users.setTwoFactor(userId, {
      secret: null,
      enabledAt: null,
      lastStep: null,
      recoveryCodes: null,
    });
    this.twoFactorFailures.delete(userId);
  }

  /** Notes the browser and address a new session came from. */
  async describeSession(token: string, meta: { userAgent: string | null; ip: string | null }) {
    await this.store.authSessions.describe(hashToken(token), meta);
  }

  /** The person's signed-in devices, the one asking marked as current. */
  async listSessions(
    user: User,
    currentToken: string | undefined,
    meta?: { userAgent: string | null; ip: string | null },
  ) {
    const current = currentToken
      ? await this.store.authSessions.findByTokenHash(hashToken(currentToken))
      : null;
    const rows = await this.store.authSessions.listForUser(user.id);
    return await Promise.all(
      rows.map(async (row) => {
        const isCurrent = row.id === current?.id;
        // A session from before devices were noted learns its device the first
        // time its owner looks, from the browser doing the looking.
        if (isCurrent && currentToken && !row.userAgent && meta?.userAgent) {
          await this.describeSession(currentToken, meta);
          return { ...row, userAgent: meta.userAgent.slice(0, 400), current: true };
        }
        return { ...row, current: isCurrent };
      }),
    );
  }

  /** Signs one of the person's own devices out. */
  async revokeSession(user: User, id: string): Promise<void> {
    if (!(await this.store.authSessions.removeOwned(user.id, id))) {
      throw new ZelyqError("not_found", "That device is already signed out.");
    }
    this.recordSecurity(user.id, "device_signed_out");
  }

  /** Signs every other device out, keeping this one. */
  async revokeOtherSessions(user: User, currentToken: string | undefined): Promise<number> {
    const current = currentToken
      ? await this.store.authSessions.findByTokenHash(hashToken(currentToken))
      : null;
    if (!current || current.userId !== user.id) {
      throw new ZelyqError("unauthorized", "Sign in to continue.");
    }
    const ended = await this.store.authSessions.removeOthers(user.id, current.id);
    if (ended > 0) this.recordSecurity(user.id, "other_devices_signed_out");
    return ended;
  }

  async setPreferences(
    user: User,
    input: { locale?: string | null; timeZone?: string | null },
  ): Promise<User> {
    await this.store.users.setPreferences(user.id, input);
    return (await this.store.users.findById(user.id)) ?? user;
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
    if (email && isServiceEmail(email)) throw reservedAddress();
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

    this.touchSession(session.id);
    const user = await this.store.users.findById(session.userId);
    // No session can belong to a team's Ops engineer; should one ever exist, it is not honoured.
    // Told by its address, which no person can register or take: no extra query per request.
    if (user && isServiceEmail(user.email)) return null;
    return user;
  }

  /** When each session was last marked seen by this process. */
  private readonly lastTouched = new Map<string, number>();

  /**
   * Record that a session was used — best-effort, and at most once a minute.
   *
   * This ran on every signed-in request, stylesheets and scripts included, so
   * one page load was a burst of writes. A write that failed failed the whole
   * request: when the database was briefly locked, every request came back 500
   * and the editor went black, all over bookkeeping nobody was waiting on.
   * Last-seen is a display value; missing one update loses nothing.
   *
   * Not awaited, either: with the database locked, a write waits up to the busy
   * timeout, and nobody's request should wait with it. At most one write per
   * session is in flight — the throttle is set before it starts.
   */
  private touchSession(id: string): void {
    const now = Date.now();
    if (now - (this.lastTouched.get(id) ?? 0) < SESSION_TOUCH_INTERVAL_MS) return;
    this.lastTouched.set(id, now);
    if (this.lastTouched.size > 10_000) this.lastTouched.clear();
    this.store.authSessions.touch(id).catch(() => {
      // Try again on the next request rather than in a minute.
      this.lastTouched.delete(id);
    });
  }

  /** A fresh session for an account that proved itself another way: a reset or invitation link. */
  async startSession(userId: string): Promise<string> {
    const token = await this.createSession(userId);
    this.activity?.record("account.signed_in", { userId, detail: { method: "link" } });
    return token;
  }

  async describe(user: User): Promise<SessionResponse> {
    const teams = await this.store.teams.listForUser(user.id);
    return {
      user,
      teams: await Promise.all(
        teams.map(async (team) => ({
          ...team,
          switchedOff: (await this.switchedOff?.(user.id, team.id)) ?? [],
        })),
      ),
      accounts: this.config.accounts ?? null,
    };
  }

  /**
   * Every way in ends here (password, single sign-on, reset and invitation
   * links), so a suspended account is refused at this one place. Suspending
   * also ends the sessions it already had.
   */
  private async createSession(userId: string): Promise<string> {
    const state = await this.store.users.statusOf(userId);
    if (state?.status === "suspended") {
      throw new ZelyqError(
        "forbidden",
        state.reason ? `This account is suspended: ${state.reason}` : "This account is suspended.",
        { reason: "suspended" },
      );
    }
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

/** A team's Ops engineer is an account Zelyq acts as; nobody signs in as it. */
function serviceAccount(): ZelyqError {
  return new ZelyqError("unauthorized", "This account cannot be used to sign in.");
}

function reservedAddress(): ZelyqError {
  return ZelyqError.badRequest("That address is reserved for Zelyq's own accounts.");
}

/** Addresses only a team's Ops engineer has; no person may register or switch to one. */
export function isServiceEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@service.invalid");
}
