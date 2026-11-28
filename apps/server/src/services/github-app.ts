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
/**
 * What a repository token may do: everything git, pull requests and statuses need, and never
 * the app's Administration permission (that is only for creating repositories).
 */
const REPOSITORY_PERMISSIONS = {
  contents: "write",
  pull_requests: "write",
  statuses: "write",
  workflows: "write",
  metadata: "read",
} as const;

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
  /**
   * "app": a GitHub App (people choose repositories on GitHub). "oauth": the server's GitHub
   * sign-in app (an OAuth App) asked for repository access too; simpler, all-or-nothing.
   */
  mode: "app" | "oauth" | null;
  /** "env": given by the server's environment (read-only here); "settings": created here. */
  source: "env" | "settings" | null;
  slug: string | null;
  owner: string | null;
  htmlUrl: string | null;
  /** Where people install it. */
  installUrl: string | null;
  /** GitHub can reach this server, so pushes and pull requests arrive by themselves. */
  webhooks: boolean;
  /** Zelyq adds a push trigger's webhook to the repository itself (oauth mode). */
  hooks: boolean;
}

/** The server's GitHub sign-in app, reused to reach repositories (Zelyq Cloud). */
export interface GitHubOAuthCredentials {
  clientId: string;
  clientSecret: string;
  /** Where GitHub sends the person back; it must sit under the OAuth App's callback URL. */
  redirectUrl: string;
}

/** What an OAuth connection asks GitHub for: repositories, CI files, webhooks, organizations. */
const OAUTH_SCOPES = "repo workflow admin:repo_hook read:org";

export interface GitHubAccount {
  login: string;
  type: "User" | "Organization";
  avatarUrl: string | null;
}

export interface GitHubConnectionSummary {
  id: string;
  /** The GitHub App installation; null for an OAuth connection. */
  installationId: number | null;
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

/** An OAuth connection: one person's GitHub, used for this team's work as them. */
interface UserBlob {
  kind: "github_user";
  account: GitHubAccount;
  token: string;
  scopes: string[];
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
  private readonly pending = new Map<string, { teamId: string; state: string; at: number }>();
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

  /** The sign-in app's keys, when the environment gives them (Zelyq Cloud). */
  oauth(): GitHubOAuthCredentials | null {
    const e = this.env;
    const clientId = e.ZELYQ_GITHUB_OAUTH_CLIENT_ID?.trim();
    const clientSecret = e.ZELYQ_GITHUB_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    const redirectUrl =
      e.ZELYQ_GITHUB_OAUTH_REDIRECT_URL?.trim() ||
      `${(this.publicUrl ?? "http://localhost:8080").replace(/\/$/, "")}/api/integrations/github/callback`;
    return { clientId, clientSecret, redirectUrl };
  }

  /** A GitHub App wins; the sign-in app is used only when there is none. */
  private async oauthMode(): Promise<GitHubOAuthCredentials | null> {
    return (await this.app()) ? null : this.oauth();
  }

  async status(): Promise<GitHubAppStatus> {
    const env = this.fromEnv();
    const app = env ?? (await this.fromSettings());
    const oauth = app ? null : this.oauth();
    if (oauth) {
      return {
        configured: true,
        mode: "oauth",
        source: "env",
        slug: null,
        owner: null,
        htmlUrl: null,
        installUrl: null,
        webhooks: false,
        hooks: reachableFromGitHub(this.publicUrl),
      };
    }
    return {
      configured: Boolean(app),
      mode: app ? "app" : null,
      hooks: false,
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
    input: {
      organization?: string | null;
      public: boolean;
      /** The address the admin's browser is on, when the server has no public address set. */
      origin?: string | null;
    },
  ): Promise<{ action: string; manifest: Record<string, unknown> }> {
    if (this.fromEnv()) {
      throw new ZelyqError("bad_request", "This server's GitHub App is set in its environment.");
    }
    const base = this.publicUrl ?? input.origin?.replace(/\/$/, "") ?? "http://localhost:5173";
    // GitHub takes letters, digits, spaces, dots and dashes in a name.
    const host = new URL(base).hostname.replace(/[^A-Za-z0-9.-]/g, "-");
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
        // To check that the person connecting an organization is one of its owners.
        members: "read",
      },
      default_events: webhooks ? ["push", "pull_request"] : [],
    };
    const organization = input.organization?.trim();
    if (organization && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(organization)) {
      throw new ZelyqError("bad_request", "That is not a GitHub organization name.");
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
      throw new ZelyqError("bad_request", "This GitHub App setup has expired. Start it again.");
    }
    const response = await this.fetch(
      `${this.api}/app-manifests/${encodeURIComponent(code)}/conversions`,
      { method: "POST", headers: this.headers() },
    );
    if (!response.ok) {
      throw new ZelyqError(
        "bad_request",
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
      throw new ZelyqError("bad_request", "This server's GitHub App is set in its environment.");
    }
    await this.store.settings.remove(SETTINGS_KEY);
    this.stored = null;
    this.tokens.clear();
  }

  // ------------------------------------------------------------ team connections

  /** Where a team admin goes to install the app (or pick more repositories for it). */
  async beginConnect(actor: User, teamId: string): Promise<{ url: string }> {
    const oauth = await this.oauthMode();
    this.sweep(this.pending, PENDING_TTL_MS);
    // One connect at a time per person: the callback finds it by who is signed in.
    const state = randomBytes(18).toString("base64url");
    if (oauth) {
      this.pending.set(actor.id, { teamId, state, at: this.now() });
      const query = new URLSearchParams({
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUrl,
        scope: OAUTH_SCOPES,
        state,
        allow_signup: "false",
      });
      return { url: `${this.web}/login/oauth/authorize?${query}` };
    }
    const app = await this.requireApp();
    this.pending.set(actor.id, { teamId, state, at: this.now() });
    return { url: `${this.web}/apps/${app.slug}/installations/new?state=${state}` };
  }

  /** The team a person's connect started from, to send them back there even when it fails. */
  pendingTeam(actor: User): string | null {
    const started = this.pending.get(actor.id);
    return started && this.now() - started.at <= PENDING_TTL_MS ? started.teamId : null;
  }

  /**
   * GitHub sent the person back after installing (or authorizing): link the installations
   * their own GitHub token can see, to the team they started from.
   */
  async completeConnect(
    actor: User,
    code: string,
    installationId: number | null,
    state: string | null = null,
  ): Promise<{ teamId: string; linked: number }> {
    const started = this.pending.get(actor.id);
    const oauth = await this.oauthMode();
    // A GitHub App's install may come back without the state; the sign-in app's always has the
    // one Zelyq made. A wrong one is a link someone else made: the real connect keeps waiting.
    if (started && (oauth ? state !== started.state : state && state !== started.state)) {
      throw new ZelyqError(
        "bad_request",
        "This GitHub connection was not started here. Start it again.",
      );
    }
    this.pending.delete(actor.id);
    if (!started || this.now() - started.at > PENDING_TTL_MS) {
      throw new ZelyqError("bad_request", "This GitHub connection has expired. Start it again.");
    }
    if (oauth) return this.completeOAuth(actor, started.teamId, oauth, code);
    const app = await this.requireApp();
    const userToken = await this.exchangeCode(app, code);
    const login = await this.loginOf(userToken.accessToken);
    const visible = await this.userInstallations(userToken.accessToken);
    // GitHub lists every installation the person can see a single repository of. Only the
    // ones they manage are theirs to link: their own account, or an organization they own.
    const managed: GitHubInstallation[] = [];
    for (const one of visible) {
      if (installationId !== null && one.id !== installationId) continue;
      if (await this.manages(userToken.accessToken, login, one)) managed.push(one);
    }
    const chosen = managed;
    if (chosen.length === 0) {
      throw new ZelyqError(
        "bad_request",
        "GitHub does not show this installation to your account. Install the app on an account or organization you manage.",
      );
    }
    const existing = await this.activeRows(started.teamId);
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
    const oauth = await this.oauthMode();
    if (oauth) {
      return (await this.userRows(teamId)).map(({ row, blob }) => ({
        id: row.id,
        installationId: null,
        account: blob.account,
        createdAt: row.createdAt,
        // Where the person sees Zelyq's access, and asks an organization to allow it.
        manageUrl: `${this.web}/settings/connections/applications/${oauth.clientId}`,
        canCreateRepositories: true,
      }));
    }
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
    const oauth = await this.oauthMode();
    if (oauth) {
      const user = (await this.userRows(teamId)).find(({ row }) => row.id === connectionId);
      if (!user) throw new ZelyqError("not_found", "That GitHub account is not connected here.");
      await this.store.providerConnections.setConnectionStatus(connectionId, "revoked");
      this.forgetAccess(connectionId);
      // Also withdraw the token on GitHub (only this one: the person's sign-in is untouched).
      await this.fetch(`${this.api}/applications/${oauth.clientId}/token`, {
        method: "DELETE",
        headers: {
          ...this.headers(),
          authorization: `Basic ${Buffer.from(`${oauth.clientId}:${oauth.clientSecret}`).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: user.blob.token }),
      }).catch(() => undefined);
      return;
    }
    const found = (await this.activeRows(teamId)).find(({ row }) => row.id === connectionId);
    if (!found) throw new ZelyqError("not_found", "That GitHub account is not connected here.");
    await this.store.providerConnections.setConnectionStatus(connectionId, "revoked");
    for (const key of this.tokens.keys()) {
      if (key.startsWith(`${found.blob.installationId}:`)) this.tokens.delete(key);
    }
  }

  /** Every repository the team's installations can reach, for the pickers. */
  async repositories(teamId: string): Promise<GitHubRepository[]> {
    if (await this.oauthMode()) return this.oauthRepositories(teamId);
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
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(input.name) || /^\.+$/.test(input.name)) {
      throw new ZelyqError(
        "bad_request",
        "A repository name uses letters, digits, ’.’, ’-’ and ’_’ only.",
      );
    }
    let token: string;
    let url: string;
    let account: GitHubAccount;
    let connectionId: string;
    if (await this.oauthMode()) {
      const user = (await this.userRows(teamId)).find(({ row }) => row.id === input.connectionId);
      if (!user) throw new ZelyqError("not_found", "That GitHub account is not connected here.");
      token = user.blob.token;
      url = `${this.api}/user/repos`;
      account = user.blob.account;
      connectionId = user.row.id;
      return this.postRepository(url, token, account, connectionId, input);
    }
    const found = (await this.activeRows(teamId)).find(({ row }) => row.id === input.connectionId);
    if (!found) throw new ZelyqError("not_found", "That GitHub account is not connected here.");
    const { blob } = found;
    account = blob.account;
    connectionId = found.row.id;
    if (blob.account.type === "Organization") {
      token = await this.installationToken(blob.installationId, null);
      url = `${this.api}/orgs/${encodeURIComponent(blob.account.login)}/repos`;
    } else {
      token = await this.personalToken(found.row.id, blob);
      url = `${this.api}/user/repos`;
    }
    return this.postRepository(url, token, account, connectionId, input);
  }

  private async postRepository(
    url: string,
    token: string,
    account: GitHubAccount,
    connectionId: string,
    input: { name: string; private: boolean; description?: string },
  ): Promise<GitHubRepository> {
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
      throw new ZelyqError(
        "bad_request",
        `${account.login} already has a repository called ${input.name}.`,
      );
    }
    if (!response.ok) {
      throw new ZelyqError(
        "bad_request",
        `GitHub did not create the repository (${response.status}). Check that the app may create repositories on ${account.login}.`,
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
      connectionId,
    };
  }

  /**
   * A token for one GitHub repository, from the team's installation on its owner; null when
   * the address is not on github.com or the team has no installation that reaches it.
   */
  /**
   * A token for one repository of the team's GitHub. `minLifeMs` asks for one that lasts at
   * least that long (a pipeline run uses it for a while; a git command needs minutes).
   */
  async tokenFor(
    teamId: string,
    repoUrl: string | null | undefined,
    options: { minLifeMs?: number } = {},
  ): Promise<string | null> {
    const repo = githubRepoOf(repoUrl);
    if (!repo) return null;
    if (await this.oauthMode()) return (await this.oauthAccess(teamId, repo))?.token ?? null;
    if (!(await this.app())) return null;
    const owner = repo.owner.toLowerCase();
    const match = (await this.activeRows(teamId)).find(
      ({ blob }) => blob.account.login.toLowerCase() === owner,
    );
    if (!match) return null;
    try {
      const token = await this.installationToken(
        match.blob.installationId,
        repo.name,
        options.minLifeMs,
      );
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
      throw new ZelyqError(
        "bad_request",
        "GitHub is not set up on this server. A server admin turns it on in Server settings → Integrations.",
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
    minLifeMs = TOKEN_SPARE_MS,
  ): Promise<string> {
    const key = `${installationId}:${repository?.toLowerCase() ?? "*"}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - Math.max(minLifeMs, TOKEN_SPARE_MS) > this.now()) {
      return cached.token;
    }
    const request = async (body: object) =>
      this.fetch(`${this.api}/app/installations/${installationId}/access_tokens`, {
        method: "POST",
        headers: { ...this.headers(await this.appJwt()), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    let response = await request(
      repository ? { repositories: [repository], permissions: REPOSITORY_PERMISSIONS } : {},
    );
    // An installation that has not accepted every permission yet: take what it has.
    if (response.status === 422 && repository) {
      response = await request({ repositories: [repository] });
    }
    if (!response.ok) {
      throw new ZelyqError(
        "bad_request",
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
      throw new ZelyqError("bad_request", "GitHub did not confirm the connection. Try again.");
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
      throw new ZelyqError(
        "bad_request",
        `To create repositories on ${blob.account.login}, ${blob.account.login} connects GitHub here once more.`,
      );
    }
    if (!user.expiresAt || Date.parse(user.expiresAt) - TOKEN_SPARE_MS > this.now()) {
      return user.accessToken;
    }
    if (!user.refreshToken)
      throw new ZelyqError("bad_request", "Connect GitHub again to create repositories.");
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
    const all: GitHubInstallation[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await this.fetch(
        `${this.api}/user/installations?per_page=100&page=${page}`,
        { headers: this.headers(userToken) },
      );
      if (!response.ok)
        throw new ZelyqError("bad_request", "GitHub did not list your installations.");
      const batch =
        ((await response.json()) as { installations?: GitHubInstallation[] }).installations ?? [];
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  /** The person's own account, or an organization where they are an owner. */
  private async manages(
    userToken: string,
    login: string | null,
    installation: GitHubInstallation,
  ): Promise<boolean> {
    const account = installation.account;
    if (!account || !login) return false;
    if (account.type !== "Organization") return account.login.toLowerCase() === login;
    const response = await this.fetch(
      `${this.api}/user/memberships/orgs/${encodeURIComponent(account.login)}`,
      { headers: this.headers(userToken) },
    );
    if (!response.ok) return false;
    const membership = (await response.json()) as { role?: string; state?: string };
    return membership.role === "admin" && membership.state === "active";
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

  // ------------------------------------------------------------------ OAuth mode

  /** Repository access found per connection and repository, for a few minutes. */
  private readonly access = new Map<string, { ok: boolean; at: number }>();

  private async completeOAuth(
    actor: User,
    teamId: string,
    oauth: GitHubOAuthCredentials,
    code: string,
  ): Promise<{ teamId: string; linked: number }> {
    const response = await this.fetch(`${this.web}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
        code,
        redirect_uri: oauth.redirectUrl,
      }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      scope?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new ZelyqError("bad_request", "GitHub did not confirm the connection. Try again.");
    }
    const token = body.access_token;
    const scopes = (body.scope ?? "").split(/[,\s]+/).filter(Boolean);
    if (!scopes.includes("repo")) {
      throw new ZelyqError(
        "bad_request",
        "GitHub did not give Zelyq access to repositories. Connect again and allow it.",
      );
    }
    const me = await this.fetch(`${this.api}/user`, { headers: this.headers(token) });
    if (!me.ok)
      throw new ZelyqError("bad_request", "GitHub did not confirm the connection. Try again.");
    const user = (await me.json()) as { login: string; avatar_url?: string };
    const blob: UserBlob = {
      kind: "github_user",
      account: { login: user.login, type: "User", avatarUrl: user.avatar_url ?? null },
      token,
      scopes,
    };
    const same = (await this.userRows(teamId)).find(
      ({ blob: one }) => one.account.login.toLowerCase() === user.login.toLowerCase(),
    );
    if (same) {
      await this.store.providerConnections.updateConnectionCredential(same.row.id, {
        encryptedBlob: this.secrets.encrypt(JSON.stringify(blob)),
      });
      this.forgetAccess(same.row.id);
    } else {
      await this.store.providerConnections.createConnection({
        id: newId("providerConnection"),
        provider: "github",
        credentialType: "github_oauth",
        encryptedBlob: this.secrets.encrypt(JSON.stringify(blob)),
        createdBy: actor.id,
        teamId,
      });
    }
    return { teamId, linked: 1 };
  }

  private async userRows(teamId: string) {
    const rows = await this.store.providerConnections.listConnections("github", teamId);
    const out: Array<{ row: (typeof rows)[number]; blob: UserBlob }> = [];
    for (const row of rows) {
      if (row.status !== "active") continue;
      const plain = this.secrets.decrypt(row.encryptedBlob);
      if (!plain) continue;
      try {
        const blob = JSON.parse(plain) as UserBlob;
        if (blob.kind === "github_user" && typeof blob.token === "string") out.push({ row, blob });
      } catch {
        // Not an OAuth connection.
      }
    }
    return out;
  }

  private forgetAccess(connectionId: string): void {
    for (const key of this.access.keys()) {
      if (key.startsWith(`${connectionId}:`)) this.access.delete(key);
    }
  }

  /**
   * The connection that may push to a repository: the person's own repositories first, then
   * any connection GitHub says can push there (organizations, shared repositories).
   */
  private async oauthAccess(
    teamId: string,
    repo: { owner: string; name: string },
  ): Promise<{ token: string; connectionId: string } | null> {
    const rows = await this.userRows(teamId);
    const owner = repo.owner.toLowerCase();
    rows.sort(
      (a, b) =>
        Number(b.blob.account.login.toLowerCase() === owner) -
        Number(a.blob.account.login.toLowerCase() === owner),
    );
    for (const { row, blob } of rows) {
      const key = `${row.id}:${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
      const known = this.access.get(key);
      let ok: boolean;
      if (known && this.now() - known.at < 10 * 60_000) {
        ok = known.ok;
      } else {
        const response = await this.fetch(
          `${this.api}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`,
          { headers: this.headers(blob.token) },
        ).catch(() => null);
        const body = response?.ok
          ? ((await response.json()) as { permissions?: { push?: boolean } })
          : null;
        ok = Boolean(body?.permissions?.push);
        // A failure GitHub did not answer is not remembered.
        if (response) this.access.set(key, { ok, at: this.now() });
      }
      if (ok) {
        await this.store.providerConnections.markConnectionUsed(row.id).catch(() => undefined);
        return { token: blob.token, connectionId: row.id };
      }
    }
    return null;
  }

  private async oauthRepositories(teamId: string): Promise<GitHubRepository[]> {
    const seen = new Map<string, GitHubRepository>();
    for (const { row, blob } of await this.userRows(teamId)) {
      for (let page = 1; page <= 5; page++) {
        const response = await this.fetch(
          `${this.api}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
          { headers: this.headers(blob.token) },
        );
        if (!response.ok) break;
        const batch = (await response.json()) as Array<{
          full_name: string;
          private: boolean;
          default_branch: string;
          clone_url: string;
          html_url: string;
          permissions?: { push?: boolean };
        }>;
        for (const repo of batch) {
          if (repo.permissions && !repo.permissions.push) continue;
          if (seen.has(repo.full_name.toLowerCase())) continue;
          seen.set(repo.full_name.toLowerCase(), {
            fullName: repo.full_name,
            private: repo.private,
            defaultBranch: repo.default_branch,
            cloneUrl: repo.clone_url,
            htmlUrl: repo.html_url,
            connectionId: row.id,
          });
        }
        if (batch.length < 100) break;
      }
    }
    return [...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /**
   * Puts a pipeline trigger's webhook on its GitHub repository (OAuth mode), so nobody copies
   * an address and a secret by hand. False when that is not possible here.
   */
  async addRepositoryHook(
    teamId: string,
    repoUrl: string | null | undefined,
    hook: { url: string; secret: string; pullRequests: boolean },
  ): Promise<boolean> {
    const repo = githubRepoOf(repoUrl);
    if (!repo || !(await this.oauthMode()) || !reachableFromGitHub(this.publicUrl)) return false;
    const access = await this.oauthAccess(teamId, repo);
    if (!access) return false;
    const base = `${this.api}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/hooks`;
    const response = await this.fetch(base, {
      method: "POST",
      headers: { ...this.headers(access.token), "content-type": "application/json" },
      body: JSON.stringify({
        name: "web",
        active: true,
        events: hook.pullRequests ? ["push", "pull_request"] : ["push"],
        config: { url: hook.url, secret: hook.secret, content_type: "json", insecure_ssl: "0" },
      }),
    }).catch(() => null);
    return Boolean(response?.ok);
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
