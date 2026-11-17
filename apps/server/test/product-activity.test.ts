import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { cleanProductDetail, newId, type ProductEventName } from "@zelyq/core";
import { createStore, runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { ProductActivity } from "../src/services/product-activity.js";

/**
 * Product activity: what people do is recorded where it happens (never what
 * they typed or made), and the admin API's analytics calls turn it into the
 * numbers a business runs on.
 */

const tmp = path.join(os.tmpdir(), `zelyq-activity-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const ALL = { from: "2000-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z" };
const DAY = 24 * 60 * 60 * 1000;

let server: ZelyqServer;
let adminCookie = "";
let key = "";

function cookieOf(response: { cookies: Array<{ name: string; value: string }> }): string {
  const session = response.cookies.find((c) => c.name === "zelyq_session")!;
  return `zelyq_session=${session.value}`;
}

async function register(email: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email.split("@")[0], password: "a-long-password-1" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return {
    cookie: cookieOf(response),
    user: response.json().user,
    teamId: response.json().teams[0].id,
  };
}

const events = async (name: ProductEventName) => {
  await server.activity.settled();
  return await server.store.productEvents.list({ ...ALL, name, limit: 1000 });
};

const metrics = (url: string, withKey = key) =>
  server.app.inject({
    method: "GET",
    url: `/api/admin/v1${url}`,
    headers: { authorization: `Bearer ${withKey}` },
  });

/** An event in the past, as if it had happened then. */
async function past(
  name: ProductEventName,
  daysAgo: number,
  who: { userId?: string; teamId?: string },
  detail = {},
) {
  await server.store.productEvents.record({
    id: newId("productEvent"),
    name,
    userId: who.userId ?? null,
    teamId: who.teamId ?? null,
    projectId: null,
    detail: cleanProductDetail(name, detail),
    createdAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
  });
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  const config = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "zelyq.db")}`,
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
    secretKeyFile: path.join(tmp, "secret.key"),
    attachmentsDir: path.join(tmp, "attachments"),
    uploadedSkillsDir: path.join(tmp, "skills"),
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4970, 4973],
      previewHost: "127.0.0.1",
    },
  } as ServerConfig;
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  adminCookie = (await register("admin@example.com")).cookie;
  key = (
    await server.app.inject({
      method: "POST",
      url: "/api/admin-keys",
      headers: { cookie: adminCookie },
      payload: { name: "Analytics", scopes: ["analytics"] },
    })
  ).json().key;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

test("only the allowed short facts are kept: never content", () => {
  assert.deepEqual(
    cleanProductDetail("app.created", {
      template: "vite-react",
      prompt: "build my secret startup idea",
      name: "Top secret",
    }),
    { template: "vite-react" },
  );
  assert.deepEqual(cleanProductDetail("feature.used", { feature: "a\nmultiline\nvalue" }), {});
  assert.deepEqual(cleanProductDetail("agent.build_finished", { ok: false, seconds: 12.7 }), {
    ok: false,
    seconds: 13,
  });
  assert.deepEqual(cleanProductDetail("account.created", { via: "x".repeat(200) }), {});
});

test("signing up records the account, its team and the sign-in", async () => {
  const { user, teamId } = await register("ama@example.com");
  const created = (await events("account.created")).filter((event) => event.userId === user.id);
  assert.equal(created.length, 1);
  assert.equal(created[0]!.teamId, teamId);
  assert.deepEqual(created[0]!.detail, { via: "password" });
  assert.ok((await events("team.created")).some((event) => event.teamId === teamId));
  assert.ok((await events("account.signed_in")).some((event) => event.userId === user.id));
});

test("signing in again is recorded, with how", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "ama@example.com", password: "a-long-password-1" },
  });
  assert.equal(response.statusCode, 200);
  const user = response.json().user;
  const signIns = (await events("account.signed_in")).filter((event) => event.userId === user.id);
  assert.equal(signIns.length, 2);
  assert.deepEqual(signIns[1]!.detail, { method: "password" });
});

test("apps, teams and members are recorded where they already are", async () => {
  const kofi = await register("kofi@example.com");
  const app = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie: kofi.cookie },
    payload: { name: "Shop", template: "vite-react" },
  });
  assert.equal(app.statusCode, 201, app.body);
  const made = (await events("app.created")).find(
    (event) => event.projectId === app.json().project.id,
  );
  assert.ok(made);
  assert.equal(made.teamId, kofi.teamId);
  assert.equal(made.userId, kofi.user.id);
  assert.deepEqual(
    made.detail,
    { template: "vite-react", from: "template" },
    "never the app's name",
  );

  const team = await server.app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { cookie: kofi.cookie },
    payload: { name: "Agency" },
  });
  const teamId = team.json().team.id;
  assert.ok(
    (await events("team.created")).some(
      (event) => event.teamId === teamId && event.detail.via === "app",
    ),
  );

  const added = await server.app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/members`,
    headers: { cookie: kofi.cookie },
    payload: { email: "ama@example.com", role: "editor" },
  });
  assert.ok(added.statusCode < 300, added.body);
  assert.ok((await events("member.joined")).some((event) => event.teamId === teamId));
});

test("a plan limit that stops someone is recorded", async () => {
  const response = await server.app.inject({
    method: "PUT",
    url: "/api/plans",
    headers: { cookie: adminCookie },
    payload: { plans: [{ id: "tiny", name: "Tiny", limits: { apps: 1 } }], defaultPlan: "tiny" },
  });
  assert.equal(response.statusCode, 200, response.body);
  const kofi = await server.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "kofi@example.com", password: "a-long-password-1" },
  });
  const refused = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie: cookieOf(kofi) },
    payload: { name: "Second" },
  });
  assert.equal(refused.statusCode, 403, refused.body);
  const hits = await events("limit.reached");
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0]!.detail, { limit: "apps", plan: "tiny" });
});

test("the analytics key reads raw events a page at a time; other keys cannot", async () => {
  const first = await metrics("/product-events?limit=3");
  assert.equal(first.statusCode, 200, first.body);
  const page = first.json();
  assert.equal(page.events.length, 3);
  assert.ok(page.nextCursor);
  const next = (await metrics(`/product-events?limit=3&cursor=${page.nextCursor}`)).json();
  assert.ok(
    !next.events.some((event: { id: string }) =>
      page.events.some((seen: { id: string }) => seen.id === event.id),
    ),
  );

  const named = (await metrics("/product-events?name=app.created")).json();
  assert.ok(named.events.every((event: { name: string }) => event.name === "app.created"));
  assert.equal((await metrics("/product-events?name=nonsense")).statusCode, 400);
  assert.equal((await metrics("/metrics/overview?from=yesterday-ish")).statusCode, 400);

  const other = (
    await server.app.inject({
      method: "POST",
      url: "/api/admin-keys",
      headers: { cookie: adminCookie },
      payload: { name: "Accounts only", scopes: ["accounts"] },
    })
  ).json().key;
  assert.equal((await metrics("/metrics/overview", other)).statusCode, 403);
});

test("overview: sign-ups, active people and the main things done, per day", async () => {
  await past("agent.build_finished", 2, { userId: "usr_x", teamId: "tem_x" }, { ok: false });
  await past("agent.build_finished", 2, { userId: "usr_x", teamId: "tem_x" }, { ok: true });
  await past("deploy.finished", 2, { teamId: "tem_x" }, { ok: true });
  const body = (await metrics("/metrics/overview")).json();
  const today = new Date().toISOString().slice(0, 10);
  const todays = body.days.find((day: { day: string }) => day.day === today);
  assert.ok(todays);
  assert.equal(todays.signups, 3, "admin, ama, kofi");
  assert.equal(todays.appsCreated, 1);
  assert.equal(todays.limitsReached, 1);
  assert.ok(todays.activePeople >= 3);
  const twoDaysAgo = body.days.find(
    (day: { day: string }) => day.day === new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10),
  );
  assert.equal(twoDaysAgo.builds, 2);
  assert.equal(twoDaysAgo.buildsFailed, 1);
  assert.equal(twoDaysAgo.deploys, 1);
  assert.equal(body.totals.signups, 3);
  assert.ok(body.monthly.people >= 4);
  assert.ok(body.daily.people >= 3);
});

test("funnel: of the teams that signed up, how many reached each step", async () => {
  const body = (await metrics("/metrics/funnel")).json();
  const step = (name: string) => body.steps.find((entry: { step: string }) => entry.step === name);
  assert.equal(step("signed_up").teams, 3);
  assert.equal(step("first_app").teams, 1, "only kofi's team made an app");
  assert.equal(step("first_app").share, 33.3);
  assert.equal(step("first_deploy").teams, 0);
});

test("retention: of each week's sign-ups, who came back in the weeks after", async () => {
  // Three people joined three weeks ago; two came back a week later, one two weeks later.
  for (const id of ["usr_r1", "usr_r2", "usr_r3"]) {
    await past("account.created", 21, { userId: id, teamId: `tem_${id}` });
  }
  await past("agent.message", 13, { userId: "usr_r1" });
  await past("agent.message", 12, { userId: "usr_r2" });
  await past("agent.message", 6, { userId: "usr_r3" });
  const body = (await metrics("/metrics/retention?weeks=4")).json();
  const cohort = body.cohorts.find((entry: { people: number }) => entry.people === 3);
  assert.ok(cohort, JSON.stringify(body));
  assert.equal(cohort.returned[0], 66.7, "week 1: two of three");
  assert.equal(cohort.returned[1], 33.3, "week 2: one of three");
  assert.equal(cohort.returned[2], null, "week 3 is not over yet");
});

test("features: uses, teams, and on which plan", async () => {
  const ama = (await server.store.users.findByEmail("ama@example.com"))!;
  const amaTeam = (await server.store.teams.listForUser(ama.id))[0]!.id;
  server.activity.feature("studio_image", { userId: ama.id, teamId: amaTeam });
  server.activity.feature("studio_image", { userId: ama.id, teamId: amaTeam });
  server.activity.feature("ops", { userId: ama.id, teamId: amaTeam });
  await server.activity.settled();
  const body = (await metrics("/metrics/features")).json();
  const image = body.features.find(
    (entry: { feature: string }) => entry.feature === "studio_image",
  );
  assert.equal(image.uses, 2);
  assert.equal(image.teams, 1);
  assert.deepEqual(image.byPlan, { tiny: 2 });
  const voice = body.features.find((entry: { feature: string }) => entry.feature === "voice");
  assert.equal(voice.uses, 0, "every feature is listed, used or not");
});

test("plans: teams per plan, close to a limit, and which limits stopped people", async () => {
  const body = (await metrics("/metrics/plans")).json();
  assert.ok(body.teamsPerPlan.tiny >= 2);
  assert.ok(body.nearLimit.some((team: { limits: string[] }) => team.limits.includes("apps")));
  assert.deepEqual(body.limitsReached.apps, { times: 1, teams: 1 });
});

test("old activity is folded into daily totals, and still counted", async () => {
  await past("account.created", 500, { userId: "usr_old1", teamId: "tem_old1" });
  await past("account.created", 500, { userId: "usr_old2", teamId: "tem_old2" });
  await past("app.created", 500, { userId: "usr_old1", teamId: "tem_old1" });
  const day = new Date(Date.now() - 500 * DAY).toISOString().slice(0, 10);
  const folded = await server.activity.fold();
  assert.ok(folded >= 2);
  const left = await server.store.productEvents.list({
    from: `${day}T00:00:00.000Z`,
    to: `${day}T23:59:59.999Z`,
    limit: 10,
  });
  assert.equal(left.length, 0, "the rows are gone");
  const body = (
    await metrics(
      `/metrics/overview?from=${day}&to=${new Date(Date.now() - 499 * DAY).toISOString()}`,
    )
  ).json();
  const entry = body.days.find((row: { day: string }) => row.day === day);
  assert.equal(entry.signups, 2);
  assert.equal(entry.appsCreated, 1);
  assert.equal(await server.activity.fold(), 0, "a day is folded once");
});

test("ZELYQ_PRODUCT_EVENTS=off records nothing", async () => {
  const store = createStore(`file:${path.join(tmp, "zelyq.db")}`);
  const off = new ProductActivity(store, { enabled: false, keepMonths: 13 });
  const before = (await store.productEvents.list({ ...ALL, limit: 100_000 })).length;
  off.record("app.created", { userId: "usr_off" });
  await off.settled();
  assert.equal((await store.productEvents.list({ ...ALL, limit: 100_000 })).length, before);
  await store.close();
});
