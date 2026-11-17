import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { accountServiceLinks } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import { accountServiceFromEnv, type ServerConfig } from "../src/config.js";
import { safeReturnTo } from "../src/routes/auth.js";
import { hashPassword } from "../src/services/auth.js";

/**
 * Managed mode (docs/managed-mode.md): one setting connects a server to an
 * outside account service, and the screens change to match. With nothing set,
 * a server must behave exactly as before.
 */

const tmp = path.join(os.tmpdir(), `zelyq-managed-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

let nextClaims: Record<string, unknown> = {};
let idpBase = "";
const idp = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/.well-known/openid-configuration") {
    res.end(
      JSON.stringify({
        issuer: idpBase,
        authorization_endpoint: `${idpBase}/authorize`,
        token_endpoint: `${idpBase}/token`,
        userinfo_endpoint: `${idpBase}/userinfo`,
      }),
    );
    return;
  }
  if (url.pathname === "/token") return void res.end(JSON.stringify({ access_token: "t" }));
  if (url.pathname === "/userinfo") return void res.end(JSON.stringify(nextClaims));
  res.statusCode = 404;
  res.end();
});

function baseConfig(name: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, name, "zelyq.db")}`,
    agentUrl: "http://127.0.0.1:59999",
    serverInternalUrl: "http://127.0.0.1:59998",
    provider: "anthropic",
    model: "claude-opus-5",
    effort: "high",
    allowRegistration: true,
    sessionTtlDays: 30,
    templatesDir: path.join(repoRoot, "templates"),
    webDir: null,
    secretKey: randomBytes(32).toString("base64"),
    secretKeyFile: path.join(tmp, name, "secret.key"),
    attachmentsDir: path.join(tmp, name, "attachments"),
    uploadedSkillsDir: path.join(tmp, name, "skills"),
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, name, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4986, 4989],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
}

async function start(config: ServerConfig): Promise<ZelyqServer> {
  await fs.mkdir(path.dirname(config.databaseUrl.slice("file:".length)), { recursive: true });
  await runMigrations(config.databaseUrl);
  return await buildServer(config);
}

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string | null {
  const session = response.cookies.find((c) => c.name === "zelyq_session");
  return session ? `zelyq_session=${session.value}` : null;
}

async function register(server: ZelyqServer, email: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email.split("@")[0], password: "a-long-password-1" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return cookieOf(response)!;
}

async function oidcSignIn(server: ZelyqServer, claims: Record<string, unknown>, returnTo?: string) {
  nextClaims = claims;
  const started = await server.app.inject({
    method: "GET",
    url: `/api/auth/oidc/start${returnTo !== undefined ? `?return_to=${encodeURIComponent(returnTo)}` : ""}`,
  });
  assert.equal(started.statusCode, 302, started.body);
  const state = new URL(started.headers.location as string).searchParams.get("state")!;
  const stateCookie = started.cookies.find((c) => c.name === "zelyq_oidc_state")!;
  return await server.app.inject({
    method: "GET",
    url: `/api/auth/oidc/callback?code=c&state=${encodeURIComponent(state)}`,
    headers: { cookie: `zelyq_oidc_state=${stateCookie.value}` },
  });
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const address = idp.address();
  idpBase = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

after(async () => {
  await new Promise<void>((resolve) => idp.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("the setting", () => {
  const oidc = {
    issuer: "https://id.example.com",
    clientId: "c",
    clientSecret: "s",
    redirectUri: "https://app.example.com/api/auth/oidc/callback",
  };

  test("unset is self-hosted", () => {
    assert.equal(accountServiceFromEnv({}, oidc), undefined);
    assert.equal(accountServiceFromEnv({ ZELYQ_ACCOUNTS_URL: "  " }, oidc), undefined);
  });

  test("a good address is kept plain, with a name", () => {
    assert.deepEqual(
      accountServiceFromEnv(
        {
          ZELYQ_ACCOUNTS_URL: "https://accounts.example.com/",
          ZELYQ_ACCOUNTS_NAME: "Example Cloud",
        },
        oidc,
      ),
      { name: "Example Cloud", url: "https://accounts.example.com" },
    );
    assert.deepEqual(accountServiceFromEnv({ ZELYQ_ACCOUNTS_URL: "https://a.example.com" }, oidc), {
      name: "a.example.com",
      url: "https://a.example.com",
    });
  });

  test("plain http is refused except on this machine", () => {
    assert.throws(() =>
      accountServiceFromEnv({ ZELYQ_ACCOUNTS_URL: "http://a.example.com" }, oidc),
    );
    assert.ok(accountServiceFromEnv({ ZELYQ_ACCOUNTS_URL: "http://localhost:3000" }, oidc));
    assert.throws(() => accountServiceFromEnv({ ZELYQ_ACCOUNTS_URL: "not an address" }, oidc));
    assert.throws(() =>
      accountServiceFromEnv({ ZELYQ_ACCOUNTS_URL: "https://a.example.com/?x=1" }, oidc),
    );
  });

  test("managed without single sign-on is refused at start", () => {
    assert.throws(
      () => accountServiceFromEnv({ ZELYQ_ACCOUNTS_URL: "https://a.example.com" }, {}),
      /ZELYQ_OIDC_ISSUER/,
    );
  });

  test("the account service's pages follow the documented paths", () => {
    const links = accountServiceLinks({ name: "X", url: "https://a.example.com/base" });
    assert.equal(
      links.signup("https://app.example.com/"),
      "https://a.example.com/base/signup?return_to=https%3A%2F%2Fapp.example.com%2F",
    );
    assert.equal(links.account(), "https://a.example.com/base/account");
    assert.equal(links.billing("team_1"), "https://a.example.com/base/billing?team=team_1");
    assert.equal(
      links.upgrade("team_1", "apps"),
      "https://a.example.com/base/upgrade?team=team_1&limit=apps",
    );
    assert.equal(links.signout(), "https://a.example.com/base/signout");
  });
});

describe("self-hosted: as before", () => {
  let server: ZelyqServer;
  before(async () => {
    server = await start(baseConfig("self"));
  });
  after(async () => server.close());

  test("the server says it is self-hosted, with its own sign-up", async () => {
    const status = (await server.app.inject({ method: "GET", url: "/api/auth/status" })).json();
    assert.equal(status.mode, "self_hosted");
    assert.equal(status.accounts, null);
    assert.equal(status.firstRun, true);
    assert.equal(status.signIn.password, true);
    assert.equal(status.signIn.register, true);
    assert.equal(status.signIn.oidcOnly, false);
  });

  let ownerCookie = "";

  test("a signed-in person has no account service, and a team on Unlimited shows no plan", async () => {
    ownerCookie = await register(server, "owner@example.com");
    const me = (
      await server.app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: ownerCookie },
      })
    ).json();
    assert.equal(me.accounts, null);
    const usage = (
      await server.app.inject({
        method: "GET",
        url: `/api/teams/${me.teams[0].id}/usage`,
        headers: { cookie: ownerCookie },
      })
    ).json();
    assert.equal(usage.plansVisible, false);
  });

  test("with registration closed, the sign-in screen is told not to offer it", async () => {
    let status = (await server.app.inject({ method: "GET", url: "/api/auth/status" })).json();
    assert.equal(status.signIn.register, true);
    const saved = await server.app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { cookie: ownerCookie },
      payload: { allowRegistration: false },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    status = (await server.app.inject({ method: "GET", url: "/api/auth/status" })).json();
    assert.equal(status.signIn.register, false);
    assert.equal(status.signIn.password, true);
  });

  test("once a plan exists, plans show", async () => {
    const saved = await server.app.inject({
      method: "PUT",
      url: "/api/plans",
      headers: { cookie: ownerCookie },
      payload: {
        plans: [{ id: "starter", name: "Starter", limits: { apps: 3 } }],
        defaultPlan: "starter",
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const me = (
      await server.app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { cookie: ownerCookie },
      })
    ).json();
    const usage = (
      await server.app.inject({
        method: "GET",
        url: `/api/teams/${me.teams[0].id}/usage`,
        headers: { cookie: ownerCookie },
      })
    ).json();
    assert.equal(usage.plansVisible, true);
  });
});

describe("managed: connected to an account service", () => {
  let server: ZelyqServer;
  before(async () => {
    const config = baseConfig("managed");
    config.allowRegistration = false;
    config.oidc = {
      issuer: idpBase,
      clientId: "c",
      clientSecret: "s",
      redirectUri: "http://localhost/api/auth/oidc/callback",
    };
    config.accounts = { name: "Example Cloud", url: "https://accounts.example.com" };
    server = await start(config);
  });
  after(async () => server.close());

  test("before set-up, the server's own administrator sets it up here", async () => {
    const status = (await server.app.inject({ method: "GET", url: "/api/auth/status" })).json();
    assert.equal(status.mode, "managed");
    assert.equal(status.firstRun, true);
    assert.equal(status.signIn.password, true, "the set-up form");
    assert.equal(status.signIn.oidcOnly, false);
  });

  test("the first person through the account service never becomes the server's owner", async () => {
    const response = await oidcSignIn(server, {
      sub: "early",
      email: "early@example.com",
      email_verified: true,
    });
    assert.equal(response.headers.location, "/signin?error=oidc");
    assert.equal(cookieOf(response), null);
    assert.equal(await server.store.users.findByEmail("early@example.com"), null);
  });

  test("once set up, sign-in is the account service's alone", async () => {
    await register(server, "admin@example.com");
    const status = (await server.app.inject({ method: "GET", url: "/api/auth/status" })).json();
    assert.deepEqual(status.accounts, {
      name: "Example Cloud",
      url: "https://accounts.example.com",
    });
    assert.equal(status.signIn.oidcOnly, true);
    assert.equal(status.signIn.password, false);
    assert.equal(status.signIn.register, false);
    assert.equal(status.signIn.passwordReset, false);
    assert.equal(status.signIn.oidcLabel, "Continue with Example Cloud");
  });

  test("a customer signs in through the account service, even with this server's sign-up closed", async () => {
    const response = await oidcSignIn(server, {
      sub: "cust-1",
      email: "customer@example.com",
      email_verified: true,
      name: "Customer",
    });
    assert.equal(response.headers.location, "/signin");
    const cookie = cookieOf(response);
    assert.ok(cookie);
    const me = (
      await server.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })
    ).json();
    assert.equal(me.user.instanceRole, "member");
    assert.deepEqual(me.accounts, { name: "Example Cloud", url: "https://accounts.example.com" });

    const usage = (
      await server.app.inject({
        method: "GET",
        url: `/api/teams/${me.teams[0].id}/usage`,
        headers: { cookie },
      })
    ).json();
    assert.equal(usage.plansVisible, true, "plans are what people pay for: always shown");
  });

  test("an unverified email still gets nowhere", async () => {
    const response = await oidcSignIn(server, {
      sub: "cust-2",
      email: "unverified@example.com",
      email_verified: false,
    });
    assert.equal(response.headers.location, "/signin?error=oidc");
  });

  test("signing in through the service comes back to the page they wanted; never to another site", async () => {
    const claims = { sub: "cust-1", email: "customer@example.com", email_verified: true };
    const back = await oidcSignIn(server, claims, "/projects/prj_123?tab=files");
    assert.equal(back.headers.location, "/projects/prj_123?tab=files");
    const invite = await oidcSignIn(server, claims, "/invite#token=abc");
    assert.equal(invite.headers.location, "/invite#token=abc");
    for (const bad of [
      "//evil.example.com/x",
      "https://evil.example.com",
      "/\\evil.example.com",
      "/api/auth/logout",
      "javascript:alert(1)",
    ]) {
      const response = await oidcSignIn(server, claims, bad);
      assert.equal(response.headers.location, "/signin", bad);
    }
  });

  test("a person of the service has no password here: sign-up, password, email and deleting are the service's", async () => {
    const signedIn = await oidcSignIn(server, {
      sub: "cust-1",
      email: "customer@example.com",
      email_verified: true,
    });
    const cookie = cookieOf(signedIn)!;
    const call = (method: "POST" | "PATCH" | "DELETE", url: string, payload: object) =>
      server.app.inject({ method, url, headers: { cookie }, payload });

    const password = await call("POST", "/api/auth/password", {
      currentPassword: "x".repeat(12),
      newPassword: "y".repeat(12),
    });
    assert.equal(password.statusCode, 403);
    assert.equal(password.json().error.message, "Change your password at Example Cloud.");
    const email = await call("PATCH", "/api/auth/profile", { email: "new@example.com" });
    assert.equal(email.statusCode, 403);
    const name = await call("PATCH", "/api/auth/profile", { name: "Customer Renamed" });
    assert.equal(name.statusCode, 200, "a display name is fine to change here");
    const removed = await call("DELETE", "/api/auth/me", { password: "anything" });
    assert.equal(removed.statusCode, 403);
    assert.match(removed.json().error.message, /Delete your account at Example Cloud/);

    const signUp = await server.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "late@example.com", name: "Late", password: "a-long-password-1" },
    });
    assert.equal(signUp.statusCode, 403);
    assert.equal(signUp.json().error.message, "Create your account at Example Cloud.");

    const invite = await server.app.inject({
      method: "POST",
      url: "/api/auth/invite/accept",
      payload: { token: "x".repeat(43), name: "New", password: "a-long-password-1" },
    });
    assert.equal(invite.statusCode, 403, invite.body);
  });

  test("only the server's own administrators sign in with a password; a wrong password says nothing", async () => {
    await server.store.users.create({
      id: "usr_pw_member",
      email: "member-with-password@example.com",
      name: "Old member",
      passwordHash: await hashPassword("a-long-password-1"),
    });
    const login = (email: string, password: string) =>
      server.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
    const member = await login("member-with-password@example.com", "a-long-password-1");
    assert.equal(member.statusCode, 403);
    assert.equal(member.json().error.message, "Sign in with your account at Example Cloud.");
    assert.equal(
      (await login("member-with-password@example.com", "wrong-password-1")).statusCode,
      401,
    );
    const admin = await login("admin@example.com", "a-long-password-1");
    assert.equal(admin.statusCode, 200, "the way in when the service is down");
  });

  test("a plan limit says the owner can upgrade, and carries what the Upgrade button needs", async () => {
    const signedIn = await oidcSignIn(server, {
      sub: "cust-limit",
      email: "limited@example.com",
      email_verified: true,
    });
    const cookie = cookieOf(signedIn)!;
    const me = (
      await server.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } })
    ).json();
    const teamId = me.teams[0].id;
    await server.usage.savePlans({
      plans: [{ id: "free", name: "Free", limits: { apps: 0 } }],
      defaultPlan: "free",
    });
    await server.usage.setPlan(teamId, "free");
    const refused = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "One too many" },
    });
    assert.equal(refused.statusCode, 403, refused.body);
    const error = refused.json().error;
    assert.match(error.message, /The team's owner can choose a bigger plan\./);
    assert.ok(!error.message.includes("server admin"));
    assert.deepEqual(error.details, { reason: "plan_limit", teamId, limit: "apps", plan: "free" });
  });
});

test("return_to only ever names a path on this server", () => {
  assert.equal(safeReturnTo("/teams/tem_1/settings"), "/teams/tem_1/settings");
  assert.equal(safeReturnTo("/invite#token=abc"), "/invite#token=abc");
  for (const bad of [
    undefined,
    "",
    "teams",
    "//evil.example.com",
    "/\\evil.example.com",
    "https://evil.example.com/",
    "/api/admin/v1/whoami",
    "/signin?x=1",
    "/a\nb",
    `/${"a".repeat(2001)}`,
  ]) {
    assert.equal(safeReturnTo(bad), null, String(bad));
  }
});
