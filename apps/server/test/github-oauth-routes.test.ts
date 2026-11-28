import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * "Connect GitHub" with the server's GitHub sign-in app (an OAuth App, as on Zelyq Cloud): the
 * person goes to GitHub with a state Zelyq made, comes back (through Accounts) with a code, and
 * the team can then reach repositories; a push trigger's webhook is put on GitHub by Zelyq.
 */

const tmp = path.join(os.tmpdir(), `zelyq-github-oauth-routes-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

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
  publicUrl: "https://zelyq.example.com",
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

const hooks: Array<{ url: string; body: Record<string, unknown> }> = [];
const exchanges: string[] = [];

before(async () => {
  Object.assign(process.env, {
    ZELYQ_GITHUB_OAUTH_CLIENT_ID: "Ov23.login",
    ZELYQ_GITHUB_OAUTH_CLIENT_SECRET: "login-secret",
    ZELYQ_GITHUB_OAUTH_REDIRECT_URL: "https://accounts.example.com/signin/github/callback/connect",
  });
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
    if (url.pathname === "/login/oauth/access_token") {
      exchanges.push(String(init?.body ?? ""));
      return json({ access_token: "gho_owner", scope: "admin:repo_hook,read:org,repo,workflow" });
    }
    if (url.pathname === "/user") return json({ login: "owner", avatar_url: null });
    if (url.pathname === "/repos/acme/shop") return json({ permissions: { push: true } });
    if (url.pathname === "/repos/acme/shop/hooks" && init?.method === "POST") {
      hooks.push({ url: url.href, body: JSON.parse(String(init.body)) });
      return json({ id: 1 }, 201);
    }
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

test("the sign-in app connects GitHub: Zelyq's own state, the code back through Accounts, no GitHub App", async () => {
  const status = (await as(editor, "GET", "/api/integrations/github/status")).json().status;
  assert.equal(status.mode, "oauth");
  assert.equal(status.configured, true);
  assert.equal(status.hooks, true);

  const started = await as(owner, "POST", `/api/teams/${teamId}/integrations/github/connect`);
  const to = new URL(started.json().url);
  assert.equal(`${to.origin}${to.pathname}`, "https://github.com/login/oauth/authorize");
  assert.equal(to.searchParams.get("client_id"), "Ov23.login");
  assert.equal(
    to.searchParams.get("redirect_uri"),
    "https://accounts.example.com/signin/github/callback/connect",
  );
  assert.equal(to.searchParams.get("scope"), "repo workflow admin:repo_hook read:org");
  const state = to.searchParams.get("state");
  assert.ok(state && state.length >= 20);

  // A code with somebody else's state is refused, and the real connect keeps waiting.
  const forged = await as(owner, "GET", "/api/integrations/github/callback?code=evil&state=nope");
  assert.equal(forged.headers.location, `/teams/${teamId}/settings?github=expired#integrations`);
  assert.equal(exchanges.length, 0);

  const back = await as(owner, "GET", `/api/integrations/github/callback?code=abc&state=${state}`);
  assert.equal(back.headers.location, `/teams/${teamId}/settings?github=connected#integrations`);
  // The code is exchanged with the same return address GitHub was given.
  assert.match(exchanges[0] ?? "", /redirect_uri=https%3A%2F%2Faccounts\.example\.com/);

  const team = (await as(editor, "GET", `/api/teams/${teamId}/integrations/github`)).json();
  assert.equal(team.connections.length, 1);
  assert.equal(team.connections[0].account.login, "owner");
  assert.equal(team.connections[0].installationId, null);
  assert.equal(
    team.connections[0].manageUrl,
    "https://github.com/settings/connections/applications/Ov23.login",
  );
  // Nothing secret reaches the browser.
  assert.doesNotMatch(JSON.stringify(team), /gho_owner/);
});

test("a push trigger on a connected repository gets its webhook put on GitHub by Zelyq", async () => {
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
  const trigger = await as(
    editor,
    "POST",
    `/api/teams/${teamId}/pipelines/${pipelineId}/triggers`,
    {
      kind: "push",
      branches: ["main"],
      pullRequests: true,
    },
  );
  assert.equal(trigger.statusCode, 201, trigger.body);
  const answer = trigger.json();
  assert.equal(answer.addedOnGitHub, true);
  assert.equal(hooks.length, 1);
  const config = hooks[0]?.body.config as Record<string, string>;
  assert.equal(config.url, `https://zelyq.example.com/api/hooks/pipelines/${answer.trigger.id}`);
  assert.equal(config.secret, answer.secret);
  assert.deepEqual(hooks[0]?.body.events, ["push", "pull_request"]);
});
