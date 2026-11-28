import { createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";
import { newId, type User, ZelyqError } from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { SecretBox } from "./secrets.js";

/**
 * Zelyq's GitHub App: people connect GitHub with a click instead of pasting a token.
 *
 * One app per Zelyq server. The cloud (and any server run from an admin console) gives it in
 * the environment; anyone else's server admin creates it once in Server settings → GitHub,
 * with GitHub's manifest flow, and it is kept sealed in the settings.
 *
 * A team links the installations its admins can see on GitHub (one row in
 * `provider_connections` each). Tokens are made on demand, limited to the one repository a
 * command needs, kept in memory until shortly before GitHub expires them, and never written
 * anywhere, sent to a browser or handed to the agent. A pasted token or a Vault one still
 * wins wherever someone gives one.
 *
 * Safety:
 *   - An installation is linked only when the person's own GitHub token lists it
 *     (`/user/installations`): an installation id in a URL is never trusted.
 *   - The connect round trip is tied to the signed-in person who started it.
 *   - Webhooks are accepted only with the app's signature.
 */

export const GITHUB_API = "https://api.github.com";
export const GITHUB_WEB = "https://github.com";
const SETTINGS_KEY = "github.app";
const PENDING_TTL_MS = 15 * 60_000;
const MANIFEST_TTL_MS = 60 * 60_000;
/** GitHub's tokens last an hour; ours are refreshed with this much to spare. */
const TOKEN_SPARE_MS = 5 * 60_000;

export interface GitHubAppCredentials {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string | null;
  /** The account that owns the app on GitHub. */
  owner: string | null;
  htmlUrl: string | null;
}

export interface GitHubAppStatus {
  configured: boolean;
  /** "env": given by the server's environment (read-only here); "settings": created here. */
  source: "env" | "settings" | null;
  slug: string | null;
  owner: string | null;
  htmlUrl: string | null;
  /** Where people install it. */
  installUrl: string | null;
  /** GitHub can reach this server, so pushes and pull requests arrive by themselves. */
  webhooks: boolean;
}

export interface GitHubAccount {
  login: string;
  type: "User" | "Organization";
  avatarUrl: string | null;
}

export interface GitHubConnectionSummary {
  id: string;
  installationId: number;
  account: GitHubAccount;
  createdAt: string;
  /** Where its repositories are chosen on GitHub. */
  manageUrl: string;
  /** A repository can be created here without leaving Zelyq. */
  canCreateRepositories: boolean;
}

export interface GitHubRepository {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
  connectionId: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface UserToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

interface InstallationBlob {
  kind: "github_installation";
  installationId: number;
  account: GitHubAccount;
  /** The person's own GitHub token, kept only to create repositories in a personal account. */
  userToken: UserToken | null;
}

interface GitHubInstallation {
  id: number;
  account: { login: string; type: string; avatar_url?: string } | null;
  app_id?: number;
}

/** github.com/owner/name from an https address, or null for any other host. */
export function githubRepoOf(
  url: string | null | undefined,
): { owner: string; name: string } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") return null;
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], name: parts[1].replace(/\.git$/i, "") };
}

/** A web address GitHub's servers can send webhooks to: https, and not a private one. */
export function reachableFromGitHub(publicUrl: string | null): boolean {
  if (!publicUrl) return false;
  let host: string;
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== "https:") return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return !(
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^\[?(::1|f[cd][0-9a-f]{2}:)/.test(host)
  );
}

export class GitHubAppService {
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly api: string;
  private readonly web: string;
  private readonly publicUrl: string | null;
  private readonly env: NodeJS.ProcessEnv;
  private stored: GitHubAppCredentials | null | undefined;
  private readonly manifests = new Map<string, { userId: string; at: number }>();
  private readonly pending = new Map<string, { teamId: string; at: number }>();
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    options: {
      publicUrl?: string | null;
      env?: NodeJS.ProcessEnv;
      fetch?: FetchLike;
      now?: () => number;
      api?: string;
      web?: string;
    } = {},
  ) {
    this.publicUrl = options.publicUrl ? options.publicUrl.replace(/\/$/, "") : null;
    this.env = options.env ?? process.env;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
    this.api = options.api ?? GITHUB_API;
    this.web = options.web ?? GITHUB_WEB;
  }

  // ------------------------------------------------------------------ the app

  private fromEnv(): GitHubAppCredentials | null {
    const e = this.env;
    if (
      !e.ZELYQ_GITHUB_APP_ID ||
      !e.ZELYQ_GITHUB_APP_SLUG ||
      !e.ZELYQ_GITHUB_APP_CLIENT_ID ||
      !e.ZELYQ_GITHUB_APP_CLIENT_SECRET ||
      !e.ZELYQ_GITHUB_APP_PRIVATE_KEY
    ) {
      return null;
    }
    return {
      appId: e.ZELYQ_GITHUB_APP_ID,
      slug: e.ZELYQ_GITHUB_APP_SLUG,
      clientId: e.ZELYQ_GITHUB_APP_CLIENT_ID,
      clientSecret: e.ZELYQ_GITHUB_APP_CLIENT_SECRET,
      // An environment variable usually carries the key's line breaks as \n.
      privateKey: e.ZELYQ_GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      webhookSecret: e.ZELYQ_GITHUB_APP_WEBHOOK_SECRET || null,
      owner: null,
      htmlUrl: `${this.web}/apps/${e.ZELYQ_GITHUB_APP_SLUG}`,
    };
  }

  private async fromSettings(): Promise<GitHubAppCredentials | null> {
    if (this.stored !== undefined) return this.stored;
    const raw = await this.store.settings.get(SETTINGS_KEY);
    const plain = raw ? this.secrets.decrypt(raw) : null;
    let credentials: GitHubAppCredentials | null = null;
    if (plain) {
      try {
        credentials = JSON.parse(plain) as GitHubAppCredentials;
      } catch {
        credentials = null;
      }
    }
    this.stored = credentials;
    return credentials;
  }

  async app(): Promise<GitHubAppCredentials | null> {
    return this.fromEnv() ?? (await this.fromSettings());
  }

  async status(): Promise<GitHubAppStatus> {
    const env = this.fromEnv();
    const app = env ?? (await this.fromSettings());
    return {
      configured: Boolean(app),
      source: env ? "env" : app ? "settings" : null,
      slug: app?.slug ?? null,
      owner: app?.owner ?? null,
      htmlUrl: app?.htmlUrl ?? null,
      installUrl: app ? `${this.web}/apps/${app.slug}/installations/new` : null,
      webhooks: Boolean(app?.webhookSecret) && reachableFromGitHub(this.publicUrl),
    };
  }

  /**
   * What the admin's browser posts to GitHub to create the app: GitHub shows the form filled
   * in, the admin presses Create, and GitHub sends them back with a code (`completeManifest`).
   */
  async manifest(
    actor: User,
    input: { organization?: string | null; public: boolean },
  ): Promise<{ action: string; manifest: Record<string, unknown> }> {
    if (this.fromEnv()) {
      throw ZelyqError.badRequest("This server's GitHub App is set in its environment.");
    }
    const base = this.publicUrl ?? "http://localhost:5173";
    const host = new URL(base).host;
    const state = randomBytes(24).toString("base64url");
    this.sweep(this.manifests, MANIFEST_TTL_MS);
    this.manifests.set(state, { userId: actor.id, at: this.now() });
    const webhooks = reachableFromGitHub(this.publicUrl);
    const manifest = {
      // GitHub needs a name no other app has; the admin can change it on GitHub's page.
      name: `Zelyq ${host}`.slice(0, 34),
      url: base,
      description: "Build, test and ship your apps from Zelyq.",
      hook_attributes: { url: `${base}/api/integrations/github/webhook`, active: webhooks },
      redirect_url: `${base}/api/integrations/github/app/created`,
      callback_urls: [`${base}/api/integrations/github/callback`],
      request_oauth_on_install: true,
      setup_on_update: true,
      public: input.public,
      default_permissions: {
        contents: "write",
        metadata: "read",
        pull_requests: "write",
        statuses: "write",
        workflows: "write",
        administration: "write",
      },
      default_events: webhooks ? ["push", "pull_request"] : [],
    };
    const organization = input.organization?.trim();
    if (organization && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(organization)) {
      throw ZelyqError.badRequest("That is not a GitHub organization name.");
    }
    const action = organization
      ? `${this.web}/organizations/${encodeURIComponent(organization)}/settings/apps/new?state=${state}`
      : `${this.web}/settings/apps/new?state=${state}`;
    return { action, manifest };
  }

  /** GitHub sent the admin back: turn the code into the app's keys and keep them sealed. */
  async completeManifest(actor: User, state: string, code: string): Promise<GitHubAppStatus> {
    const started = this.manifests.get(state);
    this.manifests.delete(state);
    if (!started || started.userId !== actor.id || this.now() - started.at > MANIFEST_TTL_MS) {
      throw ZelyqError.badRequest("This GitHub App setup has expired. Start it again.");
    }
    const response = await this.fetch(
      `${this.api}/app-manifests/${encodeURIComponent(code)}/conversions`,
      { method: "POST", headers: this.headers() },
    );
    if (!response.ok) {
      throw ZelyqError.badRequest(
        `GitHub did not finish creating the app (${response.status}). Start it again.`,
      );
    }
    const made = (await response.json()) as {
      id: number;
      slug: string;
      client_id: string;
      client_secret: string;
      pem: string;
      webhook_secret: string | null;
      html_url?: string;
      owner?: { login?: string };
    };
    const credentials: GitHubAppCredentials = {
      appId: String(made.id),
      slug: made.slug,
      clientId: made.client_id,
      clientSecret: made.client_secret,
      privateKey: made.pem,
      webhookSecret: made.webhook_secret ?? null,
      owner: made.owner?.login ?? null,
      htmlUrl: made.html_url ?? `${this.web}/apps/${made.slug}`,
    };
    await this.store.settings.set(SETTINGS_KEY, this.secrets.encrypt(JSON.stringify(credentials)));
    this.stored = credentials;
    this.tokens.clear();
    return this.status();
  }

  /** Forgets the app created here (it stays on GitHub, where its owner can delete it). */
  async removeApp(): Promise<void> {
    if (this.fromEnv()) {
      throw ZelyqError.badRequest("This server's GitHub App is set in its environment.");
    }
    await this.store.settings.remove(SETTINGS_KEY);
    this.stored = null;
    this.tokens.clear();
  }

  // ------------------------------------------------------------ team connections

  /** Where a team admin goes to install the app (or pick more repositories for it). */
  async beginConnect(actor: User, teamId: string): Promise<{ url: string }> {
    const app = await this.requireApp();
    this.sweep(this.pending, PENDING_TTL_MS);
    // One connect at a time per person: the callback finds it by who is signed in.
    this.pending.set(actor.id, { teamId, at: this.now() });
    return { url: `${this.web}/apps/${app.slug}/installations/new` };
  }

  /**
   * GitHub sent the person back after installing (or authorizing): link the installations
   * their own GitHub token can see, to the team they started from.
   */
  async completeConnect(
    actor: User,
    code: string,
    installationId: number | null,
  ): Promise<{ teamId: string; linked: number }> {
    const started = this.pending.get(actor.id);
    this.pending.delete(actor.id);
    if (!started || this.now() - started.at > PENDING_TTL_MS) {
      throw ZelyqError.badRequest("This GitHub connection has expired. Start it again.");
    }
    const app = await this.requireApp();
    const userToken = await this.exchangeCode(app, code);
    const visible = await this.userInstallations(userToken.accessToken);
    const chosen =
      installationId !== null ? visible.filter((one) => one.id === installationId) : visible;
    if (chosen.length === 0) {
      throw ZelyqError.badRequest(
        "GitHub does not show this installation to your account. Install the app on an account or organization you manage.",
      );
    }
    const existing = await this.activeRows(started.teamId);
    const login = await this.loginOf(userToken.accessToken);
    let linked = 0;
    for (const installation of chosen) {
      if (!installation.account) continue;
      const account: GitHubAccount = {
        login: installation.account.login,
        type: installation.account.type === "Organization" ? "Organization" : "User",
        avatarUrl: installation.account.avatar_url ?? null,
      };
      const blob: InstallationBlob = {
        kind: "github_installation",
        installationId: installation.id,
        account,
        // Only a personal account needs the person's token (to create repositories there).
        userToken:
          account.type === "User" && account.login.toLowerCase() === login ? userToken : null,
      };
      const same = existing.find((row) => row.blob.installationId === installation.id);
      if (same) {
        await this.store.providerConnections.updateConnectionCredential(same.row.id, {
          encryptedBlob: this.seal(blob),
        });
      } else {
        await this.store.providerConnections.createConnection({
          id: newId("providerConnection"),
          provider: "github",
          credentialType: "github_app",
          encryptedBlob: this.seal(blob),
          createdBy: actor.id,
          teamId: started.teamId,
        });
      }
      linked++;
    }
    return { teamId: started.teamId, linked };
  }

  async connections(teamId: string): Promise<GitHubConnectionSummary[]> {
    return (await this.activeRows(teamId)).map(({ row, blob }) => ({
      id: row.id,
      installationId: blob.installationId,
      account: blob.account,
      createdAt: row.createdAt,
      manageUrl:
        blob.account.type === "Organization"
          ? `${this.web}/organizations/${blob.account.login}/settings/installations/${blob.installationId}`
          : `${this.web}/settings/installations/${blob.installationId}`,
      canCreateRepositories: blob.account.type === "Organization" || blob.userToken !== null,
    }));
  }

  async disconnect(teamId: string, connectionId: string): Promise<void> {
    const found = (await this.activeRows(teamId)).find(({ row }) => row.id === connectionId);
    if (!found) throw new ZelyqError("not_found", "That GitHub account is not connected here.");
    await this.store.providerConnections.setConnectionStatus(connectionId, "revoked");
    for (const key of this.tokens.keys()) {
      if (key.startsWith(`${found.blob.installationId}:`)) this.tokens.delete(key);
    }
  }

  /** Every repository the team's installations can reach, for the pickers. */
  async repositories(teamId: string): Promise<GitHubRepository[]> {
    const all: GitHubRepository[] = [];
    for (const { row, blob } of await this.activeRows(teamId)) {
      const token = await this.installationToken(blob.installationId, null);
      for (let page = 1; page <= 10; page++) {
        const response = await this.fetch(
          `${this.api}/installation/repositories?per_page=100&page=${page}`,
          { headers: this.headers(token) },
        );
        if (!response.ok) break;
        const body = (await response.json()) as {
          repositories: Array<{
            full_name: string;
            private: boolean;
            default_branch: string;
            clone_url: string;
            html_url: string;
          }>;
        };
        for (const repo of body.repositories) {
          all.push({
            fullName: repo.full_name,
            private: repo.private,
            defaultBranch: repo.default_branch,
            cloneUrl: repo.clone_url,
            htmlUrl: repo.html_url,
            connectionId: row.id,
          });
        }
        if (body.repositories.length < 100) break;
      }
    }
    return all.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /** Makes a new, empty repository on a connected account. */
  async createRepository(
    teamId: string,
    input: { connectionId: string; name: string; private: boolean; description?: string },
  ): Promise<GitHubRepository> {
    const found = (await this.activeRows(teamId)).find(({ row }) => row.id === input.connectionId);
    if (!found) throw new ZelyqError("not_found", "That GitHub account is not connected here.");
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(input.name) || /^\.+$/.test(input.name)) {
      throw ZelyqError.badRequest("A repository name uses letters, digits, '.', '-' and '_' only.");
    }
    const { blob } = found;
    let token: string;
    let url: string;
    if (blob.account.type === "Organization") {
      token = await this.installationToken(blob.installationId, null);
      url = `${this.api}/orgs/${encodeURIComponent(blob.account.login)}/repos`;
    } else {
      token = await this.personalToken(found.row.id, blob);
      url = `${this.api}/user/repos`;
    }
    const response = await this.fetch(url, {
      method: "POST",
      headers: { ...this.headers(token), "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        private: input.private,
        description: input.description ?? "",
        auto_init: false,
      }),
    });
    if (response.status === 422) {
      throw ZelyqError.badRequest(
        `${blob.account.login} already has a repository called ${input.name}.`,
      );
    }
    if (!response.ok) {
      throw ZelyqError.badRequest(
        `GitHub did not create the repository (${response.status}). Check that the app may create repositories on ${blob.account.login}.`,
      );
    }
    const repo = (await response.json()) as {
      full_name: string;
      private: boolean;
      default_branch: string | null;
      clone_url: string;
      html_url: string;
    };
    return {
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch ?? "main",
      cloneUrl: repo.clone_url,
      htmlUrl: repo.html_url,
      connectionId: found.row.id,
    };
  }

  /**
   * A token for one GitHub repository, from the team's installation on its owner; null when
   * the address is not on github.com or the team has no installation that reaches it.
   */
  async tokenFor(teamId: string, repoUrl: string | null | undefined): Promise<string | null> {
    const repo = githubRepoOf(repoUrl);
    if (!repo || !(await this.app())) return null;
    const owner = repo.owner.toLowerCase();
    const match = (await this.activeRows(teamId)).find(
      ({ blob }) => blob.account.login.toLowerCase() === owner,
    );
    if (!match) return null;
    try {
      const token = await this.installationToken(match.blob.installationId, repo.name);
      await this.store.providerConnections.markConnectionUsed(match.row.id).catch(() => undefined);
      return token;
    } catch {
      // The installation does not include this repository.
      return null;
    }
  }

  // -------------------------------------------------------------------- webhooks

  /** The app's webhook, checked against its own secret. */
  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: Buffer,
  ): Promise<boolean> {
    const secret = (await this.app())?.webhookSecret;
    const signature = headers["x-hub-signature-256"];
    if (!secret || typeof signature !== "string") return false;
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** The teams that linked this installation. */
  async teamsFor(installationId: number): Promise<string[]> {
    const rows = await this.store.providerConnections.listAllConnections("github");
    const teams = new Set<string>();
    for (const row of rows) {
      if (row.status !== "active" || !row.teamId) continue;
      if (this.unseal(row.encryptedBlob)?.installationId === installationId) teams.add(row.teamId);
    }
    return [...teams];
  }

  // -------------------------------------------------------------------- internals

  private async requireApp(): Promise<GitHubAppCredentials> {
    const app = await this.app();
    if (!app) {
      throw ZelyqError.badRequest(
        "GitHub is not set up on this server. A server admin turns it on in Server settings → GitHub.",
      );
    }
    return app;
  }

  private async activeRows(teamId: string) {
    const rows = await this.store.providerConnections.listConnections("github", teamId);
    const out: Array<{ row: (typeof rows)[number]; blob: InstallationBlob }> = [];
    for (const row of rows) {
      if (row.status !== "active") continue;
      const blob = this.unseal(row.encryptedBlob);
      if (blob) out.push({ row, blob });
    }
    return out;
  }

  /** The app speaking for itself: a short JWT signed with its private key. */
  private async appJwt(): Promise<string> {
    const app = await this.requireApp();
    const now = Math.floor(this.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: app.clientId })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(app.privateKey, "base64url");
    return `${unsigned}.${signature}`;
  }

  /** A token for an installation, limited to one repository when one is named. */
  private async installationToken(
    installationId: number,
    repository: string | null,
  ): Promise<string> {
    const key = `${installationId}:${repository?.toLowerCase() ?? "*"}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - TOKEN_SPARE_MS > this.now()) return cached.token;
    const response = await this.fetch(
      `${this.api}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: { ...this.headers(await this.appJwt()), "content-type": "application/json" },
        body: JSON.stringify(repository ? { repositories: [repository] } : {}),
      },
    );
    if (!response.ok) {
      throw ZelyqError.badRequest(
        response.status === 404
          ? "The GitHub App is no longer installed there. Connect GitHub again."
          : `GitHub did not give Zelyq access (${response.status}).`,
      );
    }
    const body = (await response.json()) as { token: string; expires_at: string };
    this.tokens.set(key, { token: body.token, expiresAt: Date.parse(body.expires_at) });
    return body.token;
  }

  private async exchangeCode(app: GitHubAppCredentials, code: string): Promise<UserToken> {
    return this.userTokenRequest(app, { code });
  }

  private async userTokenRequest(
    app: GitHubAppCredentials,
    params: Record<string, string>,
  ): Promise<UserToken> {
    const response = await this.fetch(`${this.web}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        ...params,
      }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!response.ok || !body.access_token) {
      throw ZelyqError.badRequest("GitHub did not confirm the connection. Try again.");
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresAt: body.expires_in
        ? new Date(this.now() + body.expires_in * 1000).toISOString()
        : null,
    };
  }

  /** The person's token for a personal account, refreshed when it has run out. */
  private async personalToken(connectionId: string, blob: InstallationBlob): Promise<string> {
    const user = blob.userToken;
    if (!user) {
      throw ZelyqError.badRequest(
        `To create repositories on ${blob.account.login}, ${blob.account.login} connects GitHub here once more.`,
      );
    }
    if (!user.expiresAt || Date.parse(user.expiresAt) - TOKEN_SPARE_MS > this.now()) {
      return user.accessToken;
    }
    if (!user.refreshToken)
      throw ZelyqError.badRequest("Connect GitHub again to create repositories.");
    const fresh = await this.userTokenRequest(await this.requireApp(), {
      grant_type: "refresh_token",
      refresh_token: user.refreshToken,
    });
    await this.store.providerConnections.updateConnectionCredential(connectionId, {
      encryptedBlob: this.seal({ ...blob, userToken: fresh }),
    });
    return fresh.accessToken;
  }

  private async userInstallations(userToken: string): Promise<GitHubInstallation[]> {
    const response = await this.fetch(`${this.api}/user/installations?per_page=100`, {
      headers: this.headers(userToken),
    });
    if (!response.ok) throw ZelyqError.badRequest("GitHub did not list your installations.");
    return ((await response.json()) as { installations: GitHubInstallation[] }).installations ?? [];
  }

  private async loginOf(userToken: string): Promise<string | null> {
    const response = await this.fetch(`${this.api}/user`, { headers: this.headers(userToken) });
    if (!response.ok) return null;
    return ((await response.json()) as { login?: string }).login?.toLowerCase() ?? null;
  }

  private headers(token?: string): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "Zelyq",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  private seal(blob: InstallationBlob): string {
    return this.secrets.encrypt(JSON.stringify(blob));
  }

  private unseal(encrypted: string): InstallationBlob | null {
    const plain = this.secrets.decrypt(encrypted);
    if (!plain) return null;
    try {
      const blob = JSON.parse(plain) as InstallationBlob;
      return blob.kind === "github_installation" && Number.isInteger(blob.installationId)
        ? blob
        : null;
    } catch {
      return null;
    }
  }

  private sweep(map: Map<string, { at: number }>, ttl: number): void {
    const cutoff = this.now() - ttl;
    for (const [key, value] of map) if (value.at < cutoff) map.delete(key);
  }
}
