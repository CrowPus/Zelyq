import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { base32Encode, matchTotp, totpCode, totpStep } from "../src/services/totp.js";

const tmp = path.join(os.tmpdir(), `zelyq-security-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct-horse-battery";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "security.db")}`,
  agentUrl: "http://127.0.0.1:59997",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
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
    previewPortRange: [4981, 4984],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let adminCookie = "";

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  const session = response.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session, "expected a session cookie");
  return `zelyq_session=${session.value}`;
}

async function register(email: string): Promise<{ cookie: string; id: string }> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/130.0" },
    payload: { email, name: email.split("@")[0], password: PASSWORD },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { cookie: cookieOf(response), id: response.json().user.id };
}

async function login(email: string) {
  return await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari" },
    payload: { email, password: PASSWORD },
  });
}

/** Turns two-factor on for a cookie's account; returns its secret and recovery codes. */
async function turnOn(cookie: string): Promise<{ secret: string; codes: string[] }> {
  const setup = await server.app.inject({
    method: "POST",
    url: "/api/auth/two-factor/setup",
    headers: { cookie },
    payload: { password: PASSWORD },
  });
  assert.equal(setup.statusCode, 200, setup.body);
  const { secret, otpauthUri } = setup.json();
  assert.match(otpauthUri, /^otpauth:\/\/totp\/Zelyq%3A/);
  // The step before now, so the next code (now) is still fresh to use.
  const enable = await server.app.inject({
    method: "POST",
    url: "/api/auth/two-factor/enable",
    headers: { cookie },
    payload: { code: totpCode(secret, totpStep() - 1) },
  });
  assert.equal(enable.statusCode, 200, enable.body);
  const { recoveryCodes } = enable.json();
  assert.equal(recoveryCodes.length, 10);
  return { secret, codes: recoveryCodes };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  adminCookie = (await register("owner@example.com")).cookie;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("codes match the RFC 6238 test values", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpCode(secret, Math.floor(59 / 30)), "287082");
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totpCode(secret, Math.floor(1234567890 / 30)), "005924");
  // One step of clock drift either way is accepted, two are not.
  const at = 1111111109 * 1000;
  assert.notEqual(matchTotp(secret, totpCode(secret, totpStep(at) + 1), at), null);
  assert.equal(matchTotp(secret, totpCode(secret, totpStep(at) + 2), at), null);
  assert.equal(matchTotp(secret, "12345", at), null);
});

test("with two-factor on, the password alone opens nothing; the code does, once", async () => {
  const { cookie } = await register("ada@example.com");
  const { secret } = await turnOn(cookie);

  const first = await login("ada@example.com");
  assert.equal(first.statusCode, 200, first.body);
  assert.ok(first.json().twoFactor?.challenge, "a challenge, not a session");
  assert.equal(
    first.cookies.find((c) => c.name === "zelyq_session"),
    undefined,
    "no cookie before the code",
  );

  const wrong = await server.app.inject({
    method: "POST",
    url: "/api/auth/login/two-factor",
    payload: { challenge: first.json().twoFactor.challenge, code: "000000" },
  });
  assert.equal(wrong.statusCode, 401);

  const code = totpCode(secret, totpStep());
  const ok = await server.app.inject({
    method: "POST",
    url: "/api/auth/login/two-factor",
    payload: { challenge: first.json().twoFactor.challenge, code },
  });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().user.twoFactorEnabled, true);
  cookieOf(ok);

  // The same code cannot be used again, even within its 30 seconds.
  const second = await login("ada@example.com");
  const replay = await server.app.inject({
    method: "POST",
    url: "/api/auth/login/two-factor",
    payload: { challenge: second.json().twoFactor.challenge, code },
  });
  assert.equal(replay.statusCode, 401, "a used code is refused");
});

test("a recovery code works once", async () => {
  const { cookie } = await register("grace@example.com");
  const { codes } = await turnOn(cookie);

  const use = async () => {
    const start = await login("grace@example.com");
    return await server.app.inject({
      method: "POST",
      url: "/api/auth/login/two-factor",
      payload: { challenge: start.json().twoFactor.challenge, code: codes[0]!.toUpperCase() },
    });
  };
  assert.equal((await use()).statusCode, 200);
  assert.equal((await use()).statusCode, 401, "crossed off after one use");

  const status = await server.app.inject({
    method: "GET",
    url: "/api/auth/two-factor",
    headers: { cookie },
  });
  assert.deepEqual(status.json(), { enabled: true, recoveryCodesLeft: 9 });
});

test("guessing codes pauses the account's code checks", async () => {
  const { cookie } = await register("eve@example.com");
  await turnOn(cookie);
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const start = await login("eve@example.com");
    const guess = await server.app.inject({
      method: "POST",
      url: "/api/auth/login/two-factor",
      payload: { challenge: start.json().twoFactor.challenge, code: String(100000 + i) },
    });
    statuses.push(guess.statusCode);
  }
  assert.ok(statuses.includes(429), `expected a pause, got ${statuses.join(",")}`);
});

test("signed-in devices: a session from before devices were noted learns its browser", async () => {
  const made = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: { "user-agent": "" },
    payload: { email: "old@example.com", name: "old", password: PASSWORD },
  });
  assert.equal(made.statusCode, 201, made.body);
  const cookie = cookieOf(made);
  const look = async () =>
    (
      await server.app.inject({
        method: "GET",
        url: "/api/auth/sessions",
        headers: { cookie, "user-agent": "Mozilla/5.0 (Windows NT 10.0) Firefox/132.0" },
      })
    ).json().sessions as Array<{ current: boolean; userAgent: string | null }>;
  const first = await look();
  assert.match(first[0]?.userAgent ?? "", /Firefox/, "filled in on the first look");
  const again = await look();
  assert.match(again[0]?.userAgent ?? "", /Firefox/, "and kept");
});

test("signed-in devices: listed with their browser, and each can be signed out", async () => {
  const { cookie } = await register("linus@example.com");
  const phone = cookieOf(await login("linus@example.com"));

  const list = await server.app.inject({
    method: "GET",
    url: "/api/auth/sessions",
    headers: { cookie },
  });
  assert.equal(list.statusCode, 200);
  const sessions = list.json().sessions as Array<{
    id: string;
    current: boolean;
    userAgent: string | null;
  }>;
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter((s) => s.current).length, 1);
  assert.ok(sessions.some((s) => s.userAgent?.includes("iPhone")));

  // Someone else cannot end it.
  const other = sessions.find((s) => !s.current)!;
  const stranger = await register("mallory@example.com");
  const refused = await server.app.inject({
    method: "DELETE",
    url: `/api/auth/sessions/${other.id}`,
    headers: { cookie: stranger.cookie },
  });
  assert.equal(refused.statusCode, 404);

  const ended = await server.app.inject({
    method: "DELETE",
    url: "/api/auth/sessions",
    headers: { cookie },
  });
  assert.deepEqual(ended.json(), { ended: 1 });
  const phoneNow = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: phone },
  });
  assert.equal(phoneNow.statusCode, 401, "the other device is signed out");
  const here = await server.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
  assert.equal(here.statusCode, 200, "this one stays signed in");
});

test("preferences: language and time zone are checked and kept", async () => {
  const { cookie } = await register("kofi@example.com");
  const saved = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/preferences",
    headers: { cookie },
    payload: { locale: "fr-FR", timeZone: "Africa/Freetown" },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().user.locale, "fr-FR");
  assert.equal(saved.json().user.timeZone, "Africa/Freetown");

  const bad = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/preferences",
    headers: { cookie },
    payload: { timeZone: "Mars/Olympus" },
  });
  assert.equal(bad.statusCode, 400);

  const cleared = await server.app.inject({
    method: "PATCH",
    url: "/api/auth/preferences",
    headers: { cookie },
    payload: { locale: null, timeZone: null },
  });
  assert.equal(cleared.json().user.timeZone, null);
});

test("turning it off needs the password and a code; an admin can reset it", async () => {
  const { cookie, id } = await register("ines@example.com");
  const { codes } = await turnOn(cookie);

  const noCode = await server.app.inject({
    method: "POST",
    url: "/api/auth/two-factor/disable",
    headers: { cookie },
    payload: { password: PASSWORD, code: "000000" },
  });
  assert.equal(noCode.statusCode, 401);

  // A member cannot reset someone else's.
  const member = await register("noone@example.com");
  const forbidden = await server.app.inject({
    method: "DELETE",
    url: `/api/users/${id}/two-factor`,
    headers: { cookie: member.cookie },
  });
  assert.equal(forbidden.statusCode, 403);

  const reset = await server.app.inject({
    method: "DELETE",
    url: `/api/users/${id}/two-factor`,
    headers: { cookie: adminCookie },
  });
  assert.equal(reset.statusCode, 204);
  const signedOut = await server.app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie },
  });
  assert.equal(signedOut.statusCode, 401, "their sessions end with the reset");
  const plain = await login("ines@example.com");
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.json().twoFactor, undefined, "the password alone works again");
  assert.ok(codes.length === 10);
});

test("guessing during set-up pauses too; resetting a missing account says so", async () => {
  const { cookie } = await register("setup-guess@example.com");
  const setup = await server.app.inject({
    method: "POST",
    url: "/api/auth/two-factor/setup",
    headers: { cookie },
    payload: { password: PASSWORD },
  });
  assert.equal(setup.statusCode, 200);
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const guess = await server.app.inject({
      method: "POST",
      url: "/api/auth/two-factor/enable",
      headers: { cookie },
      payload: { code: String(200000 + i) },
    });
    statuses.push(guess.statusCode);
  }
  assert.ok(statuses.includes(429), `expected a pause, got ${statuses.join(",")}`);

  const missing = await server.app.inject({
    method: "DELETE",
    url: "/api/users/usr_does_not_exist/two-factor",
    headers: { cookie: adminCookie },
  });
  assert.equal(missing.statusCode, 404);
});

test("the same right code sent twice at once signs in once and is not counted as a guess", async () => {
  const { cookie } = await register("twice@example.com");
  const { secret } = await turnOn(cookie);
  const challenges = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(
      async () => (await login("twice@example.com")).json().twoFactor.challenge,
    ),
  );
  const code = totpCode(secret, totpStep());
  const results = await Promise.all(
    challenges.map((challenge) =>
      server.app.inject({
        method: "POST",
        url: "/api/auth/login/two-factor",
        payload: { challenge, code },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.statusCode === 200).length, 1);
  // Not paused: the losers were not guesses.
  const start = await login("twice@example.com");
  const next = await server.app.inject({
    method: "POST",
    url: "/api/auth/login/two-factor",
    payload: { challenge: start.json().twoFactor.challenge, code: "000000" },
  });
  assert.equal(next.statusCode, 401, "a wrong code is refused, not paused");
});
