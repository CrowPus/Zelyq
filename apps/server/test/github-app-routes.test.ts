import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * GitHub through the whole server: a team admin connects (only an admin may), the person is
 * sent back to Team settings, and GitHub's own webhook (signed with the app's secret) starts
 * the push trigger of the pipeline whose source is that repository — no webhook per trigger.
 * GitHub itself is a stand-in answering for github.com and api.github.com.
 */

const tmp = path.join(os.tmpdir(), `zelyq-github-routes-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const WEBHOOK_SECRET = "route-hook-secret";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "github.db")}`,
  agentUrl: "http://127.0.0.1:59999",
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
    previewPortRange: [4960, 4963],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let owner: string;
let editor: string;
let teamId: string;
const realFetch = globalThis.fetch;
const envBefore = { ...process.env };

async function register(email: string): Promise<string> {
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name: email, password: "correct-horse-battery" },
  });
  return `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

function as(
  cookie: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

function webhook(event: string, payload: unknown, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  return server.app.inject({
    method: "POST",
    url: "/api/integrations/github/webhook",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    payload: body,
  });
}

before(async () => {
  Object.assign(process.env, {
    ZELYQ_GITHUB_APP_ID: "42",
    ZELYQ_GITHUB_APP_SLUG: "zelyq-route-test",
    ZELYQ_GITHUB_APP_CLIENT_ID: "Iv1.route",
    ZELYQ_GITHUB_APP_CLIENT_SECRET: "route-secret",
    ZELYQ_GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    ZELYQ_GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });
  // GitHub, answered here; everything else as usual.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname !== "github.com" && url.hostname !== "api.github.com")
      return realFetch(input, init);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname === "/login/oauth/access_token") return json({ access_token: "ghu_route" });
    if (url.pathname === "/user/installations") {
      return json({
        installations: [{ id: 3003, account: { login: "acme", type: "Organization" } }],
      });
    }
    if (url.pathname === "/user") return json({ login: "owner" });
    if (url.pathname === "/user/memberships/orgs/acme")
      return json({ role: "admin", state: "active" });
    return json({ message: "not stubbed" }, 404);
  }) as typeof fetch;

  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  owner = await register("owner@example.com");
  teamId = (await as(owner, "GET", "/api/teams")).json().teams[0].id;
  await as(owner, "PUT", "/api/settings", { pipelineLocalRunner: "host" });
  editor = await register("editor@example.com");
  const invited = await as(owner, "POST", `/api/teams/${teamId}/members`, {
    email: "editor@example.com",
    role: "editor",
  });
  assert.ok(invited.statusCode < 300, invited.body);
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in envBefore)) delete process.env[key];
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a team admin connects GitHub; an editor may not", async () => {
  const status = (await as(editor, "GET", "/api/integrations/github/status")).json().status;
  assert.equal(status.configured, true);
  assert.equal(status.installUrl, "https://github.com/apps/zelyq-route-test/installations/new");

  const refused = await as(editor, "POST", `/api/teams/${teamId}/integrations/github/connect`);
  assert.equal(refused.statusCode, 403);

  const started = await as(owner, "POST", `/api/teams/${teamId}/integrations/github/connect`);
  assert.match(
    started.json().url,
    /^https:\/\/github\.com\/apps\/zelyq-route-test\/installations\/new\?state=/,
  );
  const back = await as(
    owner,
    "GET",
    "/api/integrations/github/callback?code=abc&installation_id=3003&setup_action=install",
  );
  assert.equal(back.statusCode, 302);
  assert.equal(back.headers.location, `/teams/${teamId}/settings?github=connected#integrations`);

  const team = (await as(editor, "GET", `/api/teams/${teamId}/integrations/github`)).json();
  assert.deepEqual(
    team.connections.map((one: { account: { login: string } }) => one.account.login),
    ["acme"],
  );
  // Coming back again without starting: an error, not a second link.
  const again = await as(owner, "GET", "/api/integrations/github/callback?code=abc");
  assert.equal(again.headers.location, "/?github=expired");
  // Started but refused by GitHub: back on the team's page with the reason.
  await as(owner, "POST", `/api/teams/${teamId}/integrations/github/connect`);
  const denied = await as(owner, "GET", "/api/integrations/github/callback?error=access_denied");
  assert.equal(denied.headers.location, `/teams/${teamId}/settings?github=error#integrations`);
});

test("GitHub's webhook starts the pipeline whose source is the pushed repository", async () => {
  const created = await as(owner, "POST", `/api/teams/${teamId}/pipelines`, {
    source: `name: Shop CI
runs-on: local
source:
  repo: https://github.com/acme/shop
stages:
  - name: Say
    steps:
      - run: echo hello
`,
  });
  assert.equal(created.statusCode, 201, created.body);
  const pipelineId = created.json().pipeline.id;
  const trigger = await as(owner, "POST", `/api/teams/${teamId}/pipelines/${pipelineId}/triggers`, {
    kind: "push",
    branches: ["main"],
  });
  assert.equal(trigger.statusCode, 201, trigger.body);

  const push = {
    ref: "refs/heads/main",
    after: "a".repeat(40),
    head_commit: { message: "Ship it" },
    repository: { full_name: "acme/shop" },
    installation: { id: 3003 },
  };
  assert.equal((await webhook("push", push, "wrong-secret")).statusCode, 401);
  assert.equal((await webhook("ping", {})).statusCode, 200);

  const started = await webhook("push", push);
  assert.equal(started.statusCode, 201, started.body);
  const runs = (await as(owner, "GET", `/api/teams/${teamId}/pipelines/${pipelineId}/runs`)).json()
    .runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].trigger, "push");

  // Another branch, another repository, an installation nobody linked: nothing runs.
  assert.equal((await webhook("push", { ...push, ref: "refs/heads/dev" })).statusCode, 202);
  assert.equal(
    (await webhook("push", { ...push, repository: { full_name: "acme/other" } })).statusCode,
    202,
  );
  assert.equal((await webhook("push", { ...push, installation: { id: 9 } })).statusCode, 202);
  const after = (await as(owner, "GET", `/api/teams/${teamId}/pipelines/${pipelineId}/runs`)).json()
    .runs;
  assert.equal(after.length, 1);
});

test("a team admin disconnects; the webhook then reaches no team", async () => {
  const [connection] = (await as(owner, "GET", `/api/teams/${teamId}/integrations/github`)).json()
    .connections;
  const refused = await as(
    editor,
    "DELETE",
    `/api/teams/${teamId}/integrations/github/${connection.id}`,
  );
  assert.equal(refused.statusCode, 403);
  const gone = await as(
    owner,
    "DELETE",
    `/api/teams/${teamId}/integrations/github/${connection.id}`,
  );
  assert.equal(gone.statusCode, 200);
  assert.deepEqual(gone.json().connections, []);
  const push = {
    ref: "refs/heads/main",
    after: "b".repeat(40),
    repository: { full_name: "acme/shop" },
    installation: { id: 3003 },
  };
  assert.equal((await webhook("push", push)).statusCode, 202);
});
