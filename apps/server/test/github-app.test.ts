import assert from "node:assert/strict";
import { createHmac, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId, type User } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import { GitHubAppService, githubRepoOf, reachableFromGitHub } from "../src/services/github-app.js";
import { SecretBox } from "../src/services/secrets.js";

/**
 * Zelyq's GitHub App, against a fake GitHub. What matters most: an installation is linked only
 * when the person's own GitHub token shows it, the round trip belongs to whoever started it,
 * tokens are limited to the one repository and never stored, and webhooks need the signature.
 */

const tmp = path.join(os.tmpdir(), `zelyq-github-app-${Date.now()}`);
let store: Store;
const secrets = new SecretBox(randomBytes(32));
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const WEBHOOK_SECRET = "hook-secret-123";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fake GitHub: answers by (method, path) and keeps every call. */
function fakeGitHub(
  routes: Array<{ method: string; path: RegExp; status?: number; json: unknown }>,
) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url,
      method,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: typeof init?.body === "string" ? init.body : "",
    });
    const { pathname, search } = new URL(url);
    const route = routes.find((one) => one.method === method && one.path.test(pathname + search));
    if (!route) return new Response("not stubbed", { status: 599 });
    return new Response(JSON.stringify(route.json), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const ENV = {
  ZELYQ_GITHUB_APP_ID: "42",
  ZELYQ_GITHUB_APP_SLUG: "zelyq-test",
  ZELYQ_GITHUB_APP_CLIENT_ID: "Iv1.client",
  ZELYQ_GITHUB_APP_CLIENT_SECRET: "client-secret",
  ZELYQ_GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, "\\n"),
  ZELYQ_GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

async function person(suffix: string, role: "owner" | "editor" = "owner") {
  const user = (await store.users.create({
    id: newId("user"),
    email: `${suffix}-${Date.now()}@example.com`,
    name: suffix,
    passwordHash: "x",
  })) as User;
  const team = await store.teams.create({
    id: newId("team"),
    name: `Team ${suffix}`,
    slug: `team-${suffix}-${Date.now()}`,
  });
  await store.teams.addMember(team.id, user.id, role);
  return { user, teamId: team.id };
}

/** The routes of a person who installed the app on their own account and on an organization. */
function installedRoutes(
  extra: Array<{ method: string; path: RegExp; status?: number; json: unknown }> = [],
) {
  return [
    ...extra,
    {
      method: "POST",
      path: /^\/login\/oauth\/access_token$/,
      json: { access_token: "ghu_person", refresh_token: "ghr_refresh", expires_in: 28800 },
    },
    {
      method: "GET",
      path: /^\/user\/installations/,
      json: {
        installations: [
          { id: 1001, account: { login: "Ada", type: "User", avatar_url: "https://a/1" } },
          { id: 2002, account: { login: "acme", type: "Organization", avatar_url: null } },
        ],
      },
    },
    { method: "GET", path: /^\/user$/, json: { login: "ada" } },
    {
      method: "POST",
      path: /^\/app\/installations\/\d+\/access_tokens$/,
      status: 201,
      json: {
        token: "ghs_installation",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  ];
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  const url = `file:${path.join(tmp, "github.db")}`;
  await runMigrations(url);
  store = createStore(url);
});
after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test("addresses: only https github.com repositories count, and only public addresses get webhooks", () => {
  assert.deepEqual(githubRepoOf("https://github.com/Acme/Shop.git"), {
    owner: "Acme",
    name: "Shop",
  });
  assert.deepEqual(githubRepoOf("https://github.com/acme/shop/"), { owner: "acme", name: "shop" });
  assert.equal(githubRepoOf("git@github.com:acme/shop.git"), null);
  assert.equal(githubRepoOf("https://gitlab.com/acme/shop"), null);
  assert.equal(githubRepoOf("https://github.com/acme"), null);
  assert.equal(githubRepoOf("https://github.com/acme/shop/tree/main"), null);
  assert.equal(reachableFromGitHub("https://zelyq.example.com"), true);
  assert.equal(reachableFromGitHub("http://zelyq.example.com"), false);
  assert.equal(reachableFromGitHub("https://localhost:5173"), false);
  assert.equal(reachableFromGitHub("https://192.168.1.4"), false);
  assert.equal(reachableFromGitHub("https://10.0.0.2"), false);
  assert.equal(reachableFromGitHub(null), false);
});

test("not set up: nothing is offered and connecting says how to turn it on", async () => {
  const github = new GitHubAppService(store, secrets, { env: {} });
  const status = await github.status();
  assert.equal(status.configured, false);
  assert.equal(status.installUrl, null);
  const { user, teamId } = await person("none");
  await assert.rejects(github.beginConnect(user, teamId), /Server settings → GitHub/);
  assert.equal(await github.tokenFor(teamId, "https://github.com/acme/shop"), null);
});

test("the admin creates the app with GitHub's manifest: its keys are kept sealed", async () => {
  const { user } = await person("admin");
  const { user: other } = await person("other");
  const gh = fakeGitHub([
    {
      method: "POST",
      path: /^\/app-manifests\/the-code\/conversions$/,
      status: 201,
      json: {
        id: 7,
        slug: "zelyq-made",
        client_id: "Iv1.made",
        client_secret: "made-secret",
        pem: PEM,
        webhook_secret: WEBHOOK_SECRET,
        html_url: "https://github.com/apps/zelyq-made",
        owner: { login: "acme" },
      },
    },
  ]);
  const github = new GitHubAppService(store, secrets, {
    env: {},
    publicUrl: "https://zelyq.example.com",
    fetch: gh.fetch,
  });
  const { action, manifest } = await github.manifest(user, { organization: "acme", public: false });
  assert.match(action, /^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/);
  const state = new URL(action).searchParams.get("state") as string;
  assert.equal((manifest.hook_attributes as { active: boolean }).active, true);
  assert.deepEqual(manifest.default_events, ["push", "pull_request"]);
  assert.equal(manifest.request_oauth_on_install, true);
  assert.equal(
    manifest.redirect_url,
    "https://zelyq.example.com/api/integrations/github/app/created",
  );
  assert.equal((manifest.default_permissions as Record<string, string>).contents, "write");
  await assert.rejects(
    github.manifest(user, { organization: "bad name!", public: false }),
    /organization/,
  );

  // Someone else cannot finish the admin's setup.
  await assert.rejects(github.completeManifest(other, state, "the-code"), /expired/);
  const second = await github.manifest(user, { public: true });
  const secondState = new URL(second.action).searchParams.get("state") as string;
  assert.match(second.action, /^https:\/\/github\.com\/settings\/apps\/new\?state=/);
  const status = await github.completeManifest(user, secondState, "the-code");
  assert.equal(status.configured, true);
  assert.equal(status.source, "settings");
  assert.equal(status.slug, "zelyq-made");
  assert.equal(status.webhooks, true);
  // Stored sealed: the private key is not readable in the settings table.
  const raw = (await store.settings.get("github.app")) as string;
  assert.ok(raw && !raw.includes("PRIVATE KEY") && !raw.includes("made-secret"));
  // A new service (a restart) reads it back.
  const again = new GitHubAppService(store, secrets, { env: {} });
  assert.equal((await again.status()).slug, "zelyq-made");
  await again.removeApp();
  assert.equal((await again.status()).configured, false);
});

test("a private address: the app is made without webhooks", async () => {
  const { user } = await person("local");
  const github = new GitHubAppService(store, secrets, {
    env: {},
    publicUrl: "http://localhost:5173",
  });
  const { manifest } = await github.manifest(user, { public: false });
  assert.equal((manifest.hook_attributes as { active: boolean }).active, false);
  assert.deepEqual(manifest.default_events, []);
});

test("an app given by the environment cannot be replaced or removed here", async () => {
  const { user } = await person("envadmin");
  const github = new GitHubAppService(store, secrets, { env: ENV });
  assert.equal((await github.status()).source, "env");
  assert.equal(
    (await github.status()).installUrl,
    "https://github.com/apps/zelyq-test/installations/new",
  );
  await assert.rejects(github.manifest(user, { public: false }), /environment/);
  await assert.rejects(github.removeApp(), /environment/);
});

test("connecting links only the installations the person's own GitHub shows, to the team they started from", async () => {
  const { user, teamId } = await person("ada");
  const { user: stranger } = await person("stranger");
  const gh = fakeGitHub(installedRoutes());
  const github = new GitHubAppService(store, secrets, { env: ENV, fetch: gh.fetch });

  // Nobody started: refused.
  await assert.rejects(github.completeConnect(user, "code", null), /expired/);

  const { url } = await github.beginConnect(user, teamId);
  assert.equal(url, "https://github.com/apps/zelyq-test/installations/new");
  // Another signed-in person cannot finish it.
  await assert.rejects(github.completeConnect(stranger, "code", 1001), /expired/);
  // An installation GitHub does not show this person: refused, nothing linked.
  await github.beginConnect(user, teamId);
  await assert.rejects(github.completeConnect(user, "code", 9999), /does not show/);
  assert.equal((await github.connections(teamId)).length, 0);

  await github.beginConnect(user, teamId);
  const result = await github.completeConnect(user, "code", 1001);
  assert.deepEqual(result, { teamId, linked: 1 });
  const [personal] = await github.connections(teamId);
  assert.equal(personal?.account.login, "Ada");
  assert.equal(personal?.canCreateRepositories, true);
  assert.equal(personal?.manageUrl, "https://github.com/settings/installations/1001");

  // No installation named: every one the person can see; linking again does not duplicate.
  await github.beginConnect(user, teamId);
  await github.completeConnect(user, "code", null);
  const all = await github.connections(teamId);
  assert.deepEqual(all.map((one) => one.account.login).sort(), ["Ada", "acme"]);
  const org = all.find((one) => one.account.login === "acme");
  assert.equal(org?.manageUrl, "https://github.com/organizations/acme/settings/installations/2002");
  // The code went to GitHub with the app's own client keys.
  const exchange = gh.calls.find((call) => call.url.endsWith("/login/oauth/access_token"));
  assert.match(exchange?.body ?? "", /client_id=Iv1\.client/);
  assert.match(exchange?.body ?? "", /code=code/);
  // Nothing sealed is readable in the table.
  const rows = await store.providerConnections.listConnections("github", teamId);
  for (const row of rows) assert.ok(!row.encryptedBlob.includes("ghu_person"));
});

test("tokens: made for one repository, kept until they near their end, and only for the owner the team linked", async () => {
  const { user, teamId } = await person("tok");
  const gh = fakeGitHub(installedRoutes());
  const github = new GitHubAppService(store, secrets, { env: ENV, fetch: gh.fetch });
  await github.beginConnect(user, teamId);
  await github.completeConnect(user, "code", 2002);

  const token = await github.tokenFor(teamId, "https://github.com/ACME/shop.git");
  assert.equal(token, "ghs_installation");
  const mint = gh.calls.filter((call) => /access_tokens$/.test(call.url));
  assert.equal(mint.length, 1);
  assert.match(mint[0]?.url ?? "", /\/app\/installations\/2002\/access_tokens$/);
  assert.deepEqual(JSON.parse(mint[0]?.body ?? "{}"), { repositories: ["shop"] });
  // The app speaks with a JWT signed by its key: RS256, from the client id, short.
  const jwt = (mint[0]?.headers.authorization ?? "").replace(/^Bearer /, "");
  const [head, payload, signature] = jwt.split(".");
  assert.ok(
    createVerify("RSA-SHA256")
      .update(`${head}.${payload}`)
      .verify(publicKey, signature as string, "base64url"),
  );
  const claims = JSON.parse(Buffer.from(payload as string, "base64url").toString());
  assert.equal(claims.iss, "Iv1.client");
  assert.ok(claims.exp - claims.iat <= 600);

  // Cached: the same repository again asks GitHub nothing.
  await github.tokenFor(teamId, "https://github.com/acme/shop");
  assert.equal(gh.calls.filter((call) => /access_tokens$/.test(call.url)).length, 1);
  // Another owner, another host: no token.
  assert.equal(await github.tokenFor(teamId, "https://github.com/someone-else/shop"), null);
  assert.equal(await github.tokenFor(teamId, "https://gitlab.com/acme/shop"), null);
  // Another team does not get this team's installation.
  const { teamId: otherTeam } = await person("other-team");
  assert.equal(await github.tokenFor(otherTeam, "https://github.com/acme/shop"), null);

  // Disconnected: no more tokens.
  const [connection] = await github.connections(teamId);
  await github.disconnect(teamId, connection?.id as string);
  assert.equal(await github.tokenFor(teamId, "https://github.com/acme/shop"), null);
  assert.equal((await github.connections(teamId)).length, 0);
});

test("a repository the installation does not include gets no token", async () => {
  const { user, teamId } = await person("norepo");
  const gh = fakeGitHub(
    installedRoutes([
      {
        method: "POST",
        path: /^\/app\/installations\/2002\/access_tokens$/,
        status: 422,
        json: {
          message: "There is at least one repository that does not exist or is not accessible",
        },
      },
    ]),
  );
  const github = new GitHubAppService(store, secrets, { env: ENV, fetch: gh.fetch });
  await github.beginConnect(user, teamId);
  await github.completeConnect(user, "code", 2002);
  assert.equal(await github.tokenFor(teamId, "https://github.com/acme/private-thing"), null);
});

test("repositories: listed for the pickers, and created on an organization or a personal account", async () => {
  const { user, teamId } = await person("repos");
  const gh = fakeGitHub(
    installedRoutes([
      {
        method: "GET",
        path: /^\/installation\/repositories/,
        json: {
          repositories: [
            {
              full_name: "acme/shop",
              private: true,
              default_branch: "main",
              clone_url: "https://github.com/acme/shop.git",
              html_url: "https://github.com/acme/shop",
            },
          ],
        },
      },
      {
        method: "POST",
        path: /^\/orgs\/acme\/repos$/,
        status: 201,
        json: {
          full_name: "acme/new-one",
          private: true,
          default_branch: null,
          clone_url: "https://github.com/acme/new-one.git",
          html_url: "https://github.com/acme/new-one",
        },
      },
      {
        method: "POST",
        path: /^\/user\/repos$/,
        status: 201,
        json: {
          full_name: "Ada/mine",
          private: false,
          default_branch: "main",
          clone_url: "https://github.com/Ada/mine.git",
          html_url: "https://github.com/Ada/mine",
        },
      },
    ]),
  );
  const github = new GitHubAppService(store, secrets, { env: ENV, fetch: gh.fetch });
  await github.beginConnect(user, teamId);
  await github.completeConnect(user, "code", null);
  const connections = await github.connections(teamId);
  const org = connections.find((one) => one.account.type === "Organization");
  const personal = connections.find((one) => one.account.type === "User");

  const repositories = await github.repositories(teamId);
  assert.ok(repositories.some((repo) => repo.fullName === "acme/shop" && repo.private));

  const made = await github.createRepository(teamId, {
    connectionId: org?.id as string,
    name: "new-one",
    private: true,
  });
  assert.equal(made.fullName, "acme/new-one");
  assert.equal(made.defaultBranch, "main");
  const orgCall = gh.calls.find((call) => call.url.endsWith("/orgs/acme/repos"));
  assert.equal(orgCall?.headers.authorization, "Bearer ghs_installation");
  assert.deepEqual(JSON.parse(orgCall?.body ?? "{}"), {
    name: "new-one",
    private: true,
    description: "",
    auto_init: false,
  });

  const mine = await github.createRepository(teamId, {
    connectionId: personal?.id as string,
    name: "mine",
    private: false,
  });
  assert.equal(mine.fullName, "Ada/mine");
  const userCall = gh.calls.find((call) => call.url.endsWith("/user/repos"));
  assert.equal(userCall?.headers.authorization, "Bearer ghu_person");

  await assert.rejects(
    github.createRepository(teamId, {
      connectionId: org?.id as string,
      name: "bad name",
      private: true,
    }),
    /letters, digits/,
  );
  await assert.rejects(
    github.createRepository(teamId, { connectionId: "nope", name: "x", private: true }),
    /not connected/,
  );
});

test("the person's token is refreshed when it has run out", async () => {
  const { user, teamId } = await person("refresh");
  let now = Date.now();
  const routes = installedRoutes([
    {
      method: "POST",
      path: /^\/user\/repos$/,
      status: 201,
      json: {
        full_name: "Ada/later",
        private: true,
        default_branch: "main",
        clone_url: "https://github.com/Ada/later.git",
        html_url: "https://github.com/Ada/later",
      },
    },
  ]);
  const gh = fakeGitHub(routes);
  const github = new GitHubAppService(store, secrets, {
    env: ENV,
    fetch: gh.fetch,
    now: () => now,
  });
  await github.beginConnect(user, teamId);
  await github.completeConnect(user, "code", 1001);
  const [personal] = await github.connections(teamId);
  now += 9 * 3600_000;
  await github.createRepository(teamId, {
    connectionId: personal?.id as string,
    name: "later",
    private: true,
  });
  const refresh = gh.calls.filter((call) => call.url.endsWith("/login/oauth/access_token")).pop();
  assert.match(refresh?.body ?? "", /grant_type=refresh_token/);
  assert.match(refresh?.body ?? "", /refresh_token=ghr_refresh/);
});

test("webhooks: only with the app's signature, and they reach the teams that linked the installation", async () => {
  const { user, teamId } = await person("hooks");
  const gh = fakeGitHub(installedRoutes());
  const github = new GitHubAppService(store, secrets, { env: ENV, fetch: gh.fetch });
  const body = Buffer.from(JSON.stringify({ installation: { id: 2002 } }));
  const sign = (secret: string) =>
    `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(
    await github.verifyWebhook({ "x-hub-signature-256": sign(WEBHOOK_SECRET) }, body),
    true,
  );
  assert.equal(await github.verifyWebhook({ "x-hub-signature-256": sign("wrong") }, body), false);
  assert.equal(await github.verifyWebhook({}, body), false);

  assert.equal((await github.teamsFor(2002)).includes(teamId), false);
  await github.beginConnect(user, teamId);
  await github.completeConnect(user, "code", 2002);
  assert.equal((await github.teamsFor(2002)).includes(teamId), true);
  assert.equal((await github.teamsFor(1001)).includes(teamId), false);
  const [connection] = await github.connections(teamId);
  await github.disconnect(teamId, connection?.id as string);
  assert.equal((await github.teamsFor(2002)).includes(teamId), false);
});
