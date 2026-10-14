import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * A git token named from the team's Vault instead of pasted: the server reads
 * the value itself and hands it to git, after the same check a project
 * variable pointing at that secret gets.
 *
 * The "host" here asks for credentials and writes down what git sends, then
 * refuses — enough to prove which token git actually used, end to end through
 * the real route, without a git server that accepts pushes.
 */
const tmp = path.join(os.tmpdir(), `zelyq-git-vault-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "git-vault.db")}`,
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
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4971, 4974],
    previewHost: "127.0.0.1",
  },
};

const TOKEN_VALUE = "ghp_from_the_vault_never_pasted";
const PROTECTED_VALUE = "ghp_protected_admins_only";

let server: ZelyqServer;
let owner: string;
let editor: string;
let teamId: string;
let projectId: string;
let host: http.Server;
let hostUrl: string;
const presented: string[] = [];

async function register(email: string, name: string): Promise<string> {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

const asUser = (cookie: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  owner = await register("owner@example.com", "Owner");
  editor = await register("editor@example.com", "Editor");
  teamId = (await asUser(owner, "GET", "/api/teams")).json().teams[0].id;
  await asUser(owner, "POST", `/api/teams/${teamId}/members`, {
    email: "editor@example.com",
    role: "editor",
  });
  for (const [name, value, isProtected] of [
    ["GITHUB_TOKEN", TOKEN_VALUE, false],
    ["RELEASE_TOKEN", PROTECTED_VALUE, true],
  ] as const) {
    const created = await asUser(owner, "POST", `/api/teams/${teamId}/vault`, {
      name,
      value,
      protected: isProtected,
    });
    assert.equal(created.statusCode, 201, created.body);
  }
  const project = await asUser(owner, "POST", "/api/projects", {
    teamId,
    name: "Git from Vault",
    template: "vite-react",
  });
  assert.equal(project.statusCode, 201, project.body);
  projectId = project.json().project.id;

  host = http.createServer((request, response) => {
    const authorization = request.headers.authorization;
    if (!authorization) {
      response.writeHead(401, { "www-authenticate": 'Basic realm="git"' }).end();
      return;
    }
    presented.push(Buffer.from(authorization.replace(/^Basic /, ""), "base64").toString());
    response.writeHead(403).end("no pushes here");
  });
  await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
  hostUrl = `http://127.0.0.1:${(host.address() as { port: number }).port}/team/app.git`;
});

after(async () => {
  await new Promise<void>((resolve) => host.close(() => resolve()));
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a push named from Vault sends the Vault value to the host, and never back", async () => {
  presented.length = 0;
  const response = await asUser(editor, "POST", `/api/projects/${projectId}/git/push`, {
    gitUrl: hostUrl,
    gitTokenVault: "GITHUB_TOKEN",
  });
  assert.equal(response.statusCode, 400, "this host refuses every push");
  assert.ok(
    presented.includes(`x-access-token:${TOKEN_VALUE}`),
    `git should have offered the Vault value, offered: ${JSON.stringify(presented)}`,
  );
  assert.ok(!response.body.includes(TOKEN_VALUE), "the value must never come back to the browser");
});

test("an editor cannot push with a Protected Vault secret", async () => {
  presented.length = 0;
  const response = await asUser(editor, "POST", `/api/projects/${projectId}/git/push`, {
    gitTokenVault: "RELEASE_TOKEN",
  });
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(presented.length, 0, "nothing may reach the host");
});

test("a name that is not in Vault is refused before git runs", async () => {
  presented.length = 0;
  const response = await asUser(owner, "POST", `/api/projects/${projectId}/git/fetch`, {
    gitTokenVault: "NO_SUCH_SECRET",
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.json().error.message, /NO_SUCH_SECRET is not in Vault/);
  assert.equal(presented.length, 0);
});

test("a pull request needs a token one way or the other", async () => {
  const response = await asUser(owner, "POST", `/api/projects/${projectId}/git/pull-request`, {
    title: "No token",
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.match(response.body, /paste one, or choose one from Vault/);
});
