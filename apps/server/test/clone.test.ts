import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Creating a project from a repository that already exists.
 *
 * Until this, every project began as a copy of one React template — which meant
 * the buyer the whole product is aimed at, a team with code they cannot send to
 * a vendor, had no way to put that code in.
 *
 * The repository here is a real one made on disk and cloned over `file://`, so
 * the test exercises git properly without needing a network.
 */

const tmp = path.join(os.tmpdir(), `zelyq-clone-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct-horse-battery";
const TOKEN = "a-token-that-should-never-be-written-down";
const origin = path.join(tmp, "origin");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "clone.db")}`,
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
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 60_000,
    previewPortRange: [4971, 4974],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let cookie: string;
let gitServer: http.Server;
let originUrl: string;
let pythonUrl: string;
let privateUrl: string;

before(async () => {
  await fs.mkdir(origin, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: origin, stdio: "pipe" });

  await fs.writeFile(path.join(origin, "README.md"), "# a project that already existed\n");
  await fs.mkdir(path.join(origin, "src"), { recursive: true });
  await fs.writeFile(path.join(origin, "src", "index.js"), "console.log('hello from the repo');\n");
  // React lives in a workspace and not at the root, which is how real monorepos
  // are shaped — and the shape a naive check declines.
  await fs.writeFile(
    path.join(origin, "package.json"),
    JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
  );
  await fs.mkdir(path.join(origin, "apps", "web"), { recursive: true });
  await fs.writeFile(
    path.join(origin, "apps", "web", "package.json"),
    JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
  );
  // Something git ignores, to prove the agent is not shown it.
  await fs.writeFile(path.join(origin, ".gitignore"), "secrets.env\n");
  await fs.writeFile(path.join(origin, "secrets.env"), "TOKEN=should-never-be-listed\n");

  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "--quiet", "-m", "initial");
  // Git's "dumb http" protocol needs this, and it lets the test clone over the
  // same kind of URL a real user would without touching the network.
  git("update-server-info");
  await fs.rename(path.join(origin, ".git"), path.join(tmp, "origin.git"));

  // A second repository that Zelyq should decline: no React anywhere.
  const other = path.join(tmp, "python");
  await fs.mkdir(other, { recursive: true });
  await fs.writeFile(path.join(other, "requirements.txt"), "flask==3.0.0\n");
  await fs.writeFile(path.join(other, "app.py"), "print('hello')\n");
  const pygit = (...args: string[]) => execFileSync("git", args, { cwd: other, stdio: "pipe" });
  pygit("init", "--quiet", "--initial-branch=main");
  pygit("config", "user.email", "test@example.com");
  pygit("config", "user.name", "Test");
  pygit("add", "-A");
  pygit("commit", "--quiet", "-m", "initial");
  pygit("update-server-info");
  await fs.rename(path.join(other, ".git"), path.join(tmp, "python.git"));

  gitServer = http.createServer(async (request, response) => {
    const url = (request.url ?? "/").split("?")[0] as string;

    // /private.git is exactly what a real private repository is: the same files,
    // behind a credential.
    if (url.startsWith("/private.git")) {
      const expected = `Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString("base64")}`;
      if (request.headers.authorization !== expected) {
        response
          .writeHead(401, { "www-authenticate": 'Basic realm="git"' })
          .end("Authentication failed");
        return;
      }
    }

    // The private repository is served from the same files as the public one.
    const file = path.join(tmp, url.replace(/^\/private\.git/, "/origin.git"));
    const body = await fs.readFile(file).catch(() => null);
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" }).end(body);
  });
  await new Promise<void>((resolve) => gitServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(gitServer.address() as { port: number }).port}`;
  originUrl = `${base}/origin.git`;
  privateUrl = `${base}/private.git`;
  pythonUrl = `${base}/python.git`;

  await runMigrations(config.databaseUrl);
  server = await buildServer(config);

  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "cloner@example.com", name: "Cloner", password: PASSWORD },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const session = registered.cookies.find((c) => c.name === "zelyq_session");
  assert.ok(session);
  cookie = `zelyq_session=${session.value}`;
});

after(async () => {
  await new Promise<void>((resolve) => gitServer?.close(() => resolve()));
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a project can be created from a repository that already exists", async () => {
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "cloned", gitUrl: originUrl },
  });
  assert.equal(created.statusCode, 201, created.body);
  const project = created.json().project;
  assert.equal(project.status, "ready", `clone left the project in ${project.status}`);

  // The repository's own files are there, not a template's.
  const readme = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/files/README.md`,
    headers: { cookie },
  });
  assert.equal(readme.statusCode, 200, readme.body);
  assert.match(readme.json().content, /a project that already existed/);

  const listed = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/files`,
    headers: { cookie },
  });
  const paths = listed.json().entries.map((entry: { path: string }) => entry.path);
  assert.ok(paths.includes("src"), `expected the repository's own tree, got ${paths.join(", ")}`);
  assert.ok(
    !paths.includes("package.json") || paths.includes("README.md"),
    "the template must not have been scaffolded over the clone",
  );
});

test("a repository that does not exist fails with something a person can act on", async () => {
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "missing", gitUrl: `${originUrl}/nope` },
  });
  assert.equal(created.statusCode, 400, created.body);
  // The message now names the likely cause rather than repeating git.
  assert.match(created.json().error.message, /was not found|could not clone/i);
});

test("ssh and local-path URLs are refused", async () => {
  for (const gitUrl of ["ssh://git@github.com/owner/repo.git", "file:///tmp/somewhere"]) {
    const created = await server.app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "refused", gitUrl },
    });
    assert.equal(created.statusCode, 400, `${gitUrl} should have been refused`);
  }
});

test("a repository that is not React is declined, and says what it looks like", async () => {
  // A repository with requirements.txt and no React anywhere.
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "not-react", gitUrl: pythonUrl },
  });

  assert.equal(created.statusCode, 400, created.body);
  const message = created.json().error.message;
  assert.match(message, /React projects at the moment/i, message);
  assert.match(message, /Python project/i, message);

  // Nothing half-built is left in the list.
  const listed = await server.app.inject({
    method: "GET",
    url: "/api/projects",
    headers: { cookie },
  });
  const names = listed.json().projects.map((project: { name: string }) => project.name);
  assert.ok(
    !names.includes("not-react"),
    `a refused repository was left behind: ${names.join(", ")}`,
  );
});

test("a private repository is refused without a token, and says what to do", async () => {
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "private-no-token", gitUrl: privateUrl },
  });

  assert.equal(created.statusCode, 400, created.body);
  const message = created.json().error.message;
  assert.match(message, /token/i, message);
  assert.match(message, /read/i, `it should say read access is enough: ${message}`);
});

test("a private repository opens with a token, and the token is not left behind", async () => {
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "private-with-token", gitUrl: privateUrl, gitToken: TOKEN },
  });
  assert.equal(created.statusCode, 201, created.body);
  const projectId = created.json().project.id;

  const readme = await server.app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/files/README.md`,
    headers: { cookie },
  });
  assert.equal(readme.statusCode, 200, readme.body);

  // The whole risk of this feature: a credential written into the clone is
  // readable by the agent and usable to push.
  const root = path.join(config.runtime.workspaceDir, projectId);
  // grep exits non-zero when it finds nothing, which is the outcome we want.
  let found = "";
  try {
    found = execFileSync("grep", ["-rl", TOKEN, root], { stdio: "pipe" }).toString().trim();
  } catch {
    found = "";
  }
  assert.equal(found, "", `the token was written into the project:\n${found}`);
});
