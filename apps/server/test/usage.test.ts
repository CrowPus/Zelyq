import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { folderBytes } from "../src/services/usage.js";

/**
 * Plans: what a team uses, measured, against what its plan allows. One plan,
 * used first, and the server's only serve the teams a server admin belongs to,
 * new, and the admin's own teams stay Unlimited unless put on a plan.
 */

const tmp = path.join(os.tmpdir(), `zelyq-usage-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "usage.db")}`,
  agentUrl: "http://127.0.0.1:59995",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  pipelinesDir: path.join(tmp, "pipelines"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4984, 4987],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let ownerCookie: string;
let guestCookie: string;
let ownerTeam: string;
let guestTeam: string;

const call = (
  cookie: string,
  method: "GET" | "PUT" | "DELETE" | "POST",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  assert.equal(response.statusCode, 201, response.body);
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

const source = async (cookie: string, team: string, provider: string) =>
  (await call(cookie, "GET", `/api/teams/${team}/ai-keys`))
    .json()
    .keys.find((key: { provider: string }) => key.provider === provider).source;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  ownerCookie = await register("owner@example.com", "Owner");
  guestCookie = await register("guest@example.com", "Guest");
  ownerTeam = (await call(ownerCookie, "GET", "/api/teams")).json().teams[0].id;
  guestTeam = (await call(guestCookie, "GET", "/api/teams")).json().teams[0].id;
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const app = (cookie: string, teamId: string, name: string) =>
  call(cookie, "POST", "/api/projects", { teamId, name });

test("measuring counts a person's own files, not what can be reinstalled; a hard link once", async () => {
  const dir = path.join(tmp, "measure");
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "node_modules", "big"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "app.js"), "x".repeat(1000));
  await fs.writeFile(path.join(dir, "node_modules", "big", "lib.js"), "y".repeat(50_000));
  await fs.link(path.join(dir, "src", "app.js"), path.join(dir, "src", "same.js"));
  assert.equal(await folderBytes(dir, true), 1000);
  assert.equal(await folderBytes(dir, false), 51_000);
});

test("with no plans set, every team is Unlimited and nothing is stopped", async () => {
  const used = (await call(guestCookie, "GET", `/api/teams/${guestTeam}/usage`)).json();
  assert.equal(used.plan.id, "unlimited");
  assert.ok(used.lines.every((line: { limit: number | null }) => line.limit === null));
  for (const name of ["One", "Two"]) {
    assert.equal((await app(guestCookie, guestTeam, name)).statusCode, 201);
  }
  const fresh = (await call(guestCookie, "GET", `/api/teams/${guestTeam}/usage?fresh=1`)).json();
  assert.equal(fresh.lines.find((line: { key: string }) => line.key === "apps").used, 2);
  assert.ok(fresh.measuredAt);
});

test("the server admin defines plans; a new team's plan stops one app too many, in plain words", async () => {
  const saved = await call(ownerCookie, "PUT", "/api/plans", {
    plans: [{ id: "free", name: "Free", limits: { apps: 2, pipelines: 1 } }],
    defaultPlan: "free",
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const used = (await call(guestCookie, "GET", `/api/teams/${guestTeam}/usage`)).json();
  assert.equal(used.plan.name, "Free");
  assert.equal(used.lines.find((line: { key: string }) => line.key === "apps").limit, 2);
  const third = await app(guestCookie, guestTeam, "Three");
  assert.equal(third.statusCode, 403);
  assert.match(third.json().error.message, /plan \(Free\) allows 2 apps, and the team has 2/);
  // Nothing that exists is touched: both apps are still there.
  assert.equal((await call(guestCookie, "GET", "/api/projects")).json().projects.length, 2);
  // The admin's own team stays Unlimited unless put on a plan by name.
  assert.equal(
    (await call(ownerCookie, "GET", `/api/teams/${ownerTeam}/usage`)).json().plan.id,
    "unlimited",
  );
  for (const name of ["A", "B", "C"]) {
    assert.equal((await app(ownerCookie, ownerTeam, name)).statusCode, 201);
  }
});

test("moving a team to another plan lifts its limit; only the server admin decides plans", async () => {
  await call(ownerCookie, "PUT", "/api/plans", {
    plans: [
      { id: "free", name: "Free", limits: { apps: 2 } },
      { id: "pro", name: "Pro", limits: { apps: 50 } },
    ],
    defaultPlan: "free",
  });
  const moved = await call(ownerCookie, "PUT", `/api/teams/${guestTeam}/plan`, { plan: "pro" });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal((await app(guestCookie, guestTeam, "Three")).statusCode, 201);
  const asGuest = await call(guestCookie, "PUT", "/api/plans", {
    plans: [],
    defaultPlan: "unlimited",
  });
  assert.equal(asGuest.statusCode, 403);
  const selfUpgrade = await call(guestCookie, "PUT", `/api/teams/${guestTeam}/plan`, {
    plan: "unlimited",
  });
  assert.equal(selfUpgrade.statusCode, 403);
  const list = (await call(ownerCookie, "GET", "/api/plans/teams")).json().teams;
  assert.equal(list.find((team: { id: string }) => team.id === guestTeam).plan.id, "pro");
  // The history says who moved it.
  const log = (await call(guestCookie, "GET", `/api/teams/${guestTeam}/audit-log`)).json().entries;
  assert.ok(log.some((entry: { action: string }) => entry.action === "team.plan_changed"));
});

test("storage over the limit stops new things, and says what to do", async () => {
  await call(ownerCookie, "PUT", "/api/plans", {
    plans: [{ id: "tiny", name: "Tiny", limits: { storageMb: 0 } }],
    defaultPlan: "unlimited",
  });
  await call(ownerCookie, "PUT", `/api/teams/${guestTeam}/plan`, { plan: "tiny" });
  // Give the team something it made: a file in one of its apps, measured.
  const project = (await call(guestCookie, "GET", "/api/projects")).json().projects[0];
  await fs.writeFile(
    path.join(config.runtime.workspaceDir, project.id, "big.bin"),
    Buffer.alloc(2 * 1024 * 1024),
  );
  await server.usage.measure(guestTeam);
  const blocked = await app(guestCookie, guestTeam, "Four");
  assert.equal(blocked.statusCode, 403);
  assert.match(blocked.json().error.message, /storage.*Delete what it no longer needs/);
});
