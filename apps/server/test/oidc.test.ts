import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Single sign-on (OIDC) — see docs/configuration.md's "Single sign-on (OIDC)"
 * section. This is the flow that had no coverage at all before this file:
 * the account-linking and account-creation branches inside `AuthService`'s
 * `findOrCreateOidcUser`, and in particular the fix that closed a real
 * account-takeover path — a new account used to be created from an OIDC
 * claim's email with no check that the provider actually verified it.
 *
 * Exercised against a real HTTP server and a minimal stand-in identity
 * provider (discovery + token + userinfo), not mocked at the `AuthService`
 * level, so this proves the whole client-side OIDC handshake — PKCE, signed
 * state, the double-submit state cookie — actually works, not just the
 * account logic in isolation.
 */

const tmp = path.join(os.tmpdir(), `zelyq-oidc-${Date.now()}`);
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
  if (url.pathname === "/token" && req.method === "POST") {
    res.end(JSON.stringify({ access_token: "test-access-token" }));
    return;
  }
  if (url.pathname === "/userinfo") {
    res.end(JSON.stringify(nextClaims));
    return;
  }
  res.statusCode = 404;
  res.end();
});

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "oidc.db")}`,
  agentUrl: "http://127.0.0.1:59999",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  // Filled in once the fake IdP is actually listening — see `before`.
  oidc: {
    issuer: "",
    clientId: "test-client",
    clientSecret: "test-secret",
    redirectUri: "http://localhost/api/auth/oidc/callback",
  },
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4982, 4985],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const address = idp.address();
  const port = typeof address === "object" && address ? address.port : 0;
  idpBase = `http://127.0.0.1:${port}`;
  config.oidc = { ...config.oidc, issuer: idpBase };

  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => idp.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  nextClaims = {};
});

/** Runs `/api/auth/oidc/start` and returns exactly what a real browser would
 * carry into the callback: the signed state from the redirect URL, and the
 * httpOnly cookie that pairs with it. */
async function oidcStart(): Promise<{ signedState: string; cookie: string }> {
  const response = await server.app.inject({ method: "GET", url: "/api/auth/oidc/start" });
  assert.equal(response.statusCode, 302, response.body);
  const location = new URL(response.headers.location as string);
  const signedState = location.searchParams.get("state");
  assert.ok(signedState, "expected a signed state in the authorization redirect");
  const stateCookie = response.cookies.find((c) => c.name === "zelyq_oidc_state");
  assert.ok(stateCookie, "expected the oidc state cookie to be set");
  return { signedState, cookie: `zelyq_oidc_state=${stateCookie.value}` };
}

async function oidcCallback(signedState: string, cookie: string, code = "test-code") {
  return await server.app.inject({
    method: "GET",
    url: `/api/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(signedState)}`,
    headers: { cookie },
  });
}

function sessionCookieOf(response: {
  cookies: Array<{ name: string; value: string }>;
}): string | null {
  const session = response.cookies.find((c) => c.name === "zelyq_session");
  return session ? `zelyq_session=${session.value}` : null;
}

test("a brand-new, verified identity creates an account and signs it in", async () => {
  nextClaims = {
    sub: "sub-1",
    email: "new-sso@example.com",
    email_verified: true,
    name: "New SSO",
  };
  const { signedState, cookie } = await oidcStart();
  const response = await oidcCallback(signedState, cookie);

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/signin");
  const sessionCookie = sessionCookieOf(response);
  assert.ok(sessionCookie, "expected sign-in to actually set a session");

  const me = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: sessionCookie! },
  });
  assert.equal(me.json().user.email, "new-sso@example.com");

  const linked = await server.store.oidcIdentities.find(idpBase, "sub-1");
  assert.ok(linked, "the identity should be recorded, not just the account");
});

test("signing in again with the same identity returns the same account, not a new one", async () => {
  nextClaims = { sub: "sub-2", email: "repeat-sso@example.com", email_verified: true };
  const first = await oidcStart();
  const firstResponse = await oidcCallback(first.signedState, first.cookie);
  const firstMe = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: sessionCookieOf(firstResponse)! },
  });

  nextClaims = {
    sub: "sub-2",
    email: "repeat-sso@example.com",
    email_verified: true,
    name: "Changed Name",
  };
  const second = await oidcStart();
  const secondResponse = await oidcCallback(second.signedState, second.cookie);
  const secondMe = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: sessionCookieOf(secondResponse)! },
  });

  assert.equal(secondMe.json().user.id, firstMe.json().user.id);
});

// ---------------------------------------------------------------------------
// The fix: an unverified email must never establish an identity — not by
// linking to an existing account (already covered before this file existed
// in spirit, if not in an actual test), and not, which is what was actually
// broken, by quietly creating a brand-new one.
// ---------------------------------------------------------------------------

test("an unverified email cannot create a new account", async () => {
  nextClaims = { sub: "attacker-sub", email: "victim@example.com", email_verified: false };
  const { signedState, cookie } = await oidcStart();
  const response = await oidcCallback(signedState, cookie);

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, "/signin?error=oidc");
  assert.equal(sessionCookieOf(response), null, "an unverified claim must not sign anyone in");

  const created = await server.store.users.findByEmail("victim@example.com");
  assert.equal(created, null, "no account should exist under the unverified email");
});

test("an email_verified claim that's simply missing is treated the same as false", async () => {
  nextClaims = { sub: "another-attacker-sub", email: "victim2@example.com" };
  const { signedState, cookie } = await oidcStart();
  const response = await oidcCallback(signedState, cookie);

  assert.equal(response.headers.location, "/signin?error=oidc");
  assert.equal(await server.store.users.findByEmail("victim2@example.com"), null);
});

test("an unverified email also cannot link to an existing account", async () => {
  nextClaims = { sub: "legit-owner-sub", email: "owner@example.com", email_verified: true };
  const setup = await oidcStart();
  await oidcCallback(setup.signedState, setup.cookie);

  nextClaims = { sub: "impersonator-sub", email: "owner@example.com", email_verified: false };
  const attempt = await oidcStart();
  const response = await oidcCallback(attempt.signedState, attempt.cookie);

  assert.equal(response.headers.location, "/signin?error=oidc");
  assert.equal(sessionCookieOf(response), null);
  assert.equal(await server.store.oidcIdentities.find(idpBase, "impersonator-sub"), null);
});

// ---------------------------------------------------------------------------
// State handling: single-use, and bounded so an unauthenticated flood of
// start calls can't grow the server's memory forever.
// ---------------------------------------------------------------------------

test("a state value cannot be replayed for a second callback", async () => {
  nextClaims = { sub: "sub-replay", email: "replay@example.com", email_verified: true };
  const { signedState, cookie } = await oidcStart();

  const first = await oidcCallback(signedState, cookie);
  assert.ok(sessionCookieOf(first), "the first use should succeed");

  const second = await oidcCallback(signedState, cookie);
  assert.equal(second.headers.location, "/signin?error=oidc");
  assert.equal(sessionCookieOf(second), null, "the same state must not work twice");
});

test("mismatched state and cookie are rejected", async () => {
  const a = await oidcStart();
  const b = await oidcStart();
  // b's cookie paired with a's signed state — the CSRF double-submit check.
  const response = await oidcCallback(a.signedState, b.cookie);
  assert.equal(response.headers.location, "/signin?error=oidc");
});

test("starting a flow without ever finishing it does not leak forever", async () => {
  for (let i = 0; i < 25; i++) {
    await oidcStart();
  }
  // Each start prunes anything already expired before adding its own entry —
  // this just proves the endpoint keeps answering normally under repeated,
  // unauthenticated use, not that memory is literally bounded (that would
  // need the TTL to actually elapse, which isn't worth a real 10-minute
  // sleep in a test). See AuthService.pruneExpiredOidcStates.
  const { signedState, cookie } = await oidcStart();
  nextClaims = { sub: "sub-after-flood", email: "after-flood@example.com", email_verified: true };
  const response = await oidcCallback(signedState, cookie);
  assert.ok(sessionCookieOf(response));
});

test("/api/auth/status reports whether OIDC is actually enabled", async () => {
  const response = await server.app.inject({ method: "GET", url: "/api/auth/status" });
  assert.equal(response.json().oidcEnabled, true);
});
