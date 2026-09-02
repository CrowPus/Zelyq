import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import type { Store } from "@zelyq/db";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import type { ServerConfig } from "../src/config.js";
import { ProjectService } from "../src/services/projects.js";

/**
 * Any git command that itself makes an HTTP request back to `gitServer` —
 * running in this same process — has to be async, not `execFileSync`.
 * Node is single-threaded: a synchronous call blocks the very event loop
 * `gitServer` needs free to spawn its own CGI child and write a response,
 * which deadlocks the subprocess waiting for a reply that can never come.
 * `initBareRepo` and reading a bare repo straight off disk never talk to
 * `gitServer`, so those stay synchronous; anything hitting `baseUrl` does not.
 */
const execFileAsync = promisify(execFile);

/**
 * Git integration, part B — push to a remote.
 *
 * Push needs the *smart* HTTP protocol (`git-receive-pack`), unlike clone,
 * which `clone.test.ts` already tests over git's "dumb" HTTP by serving
 * static files. A static file server cannot accept a push at all — there
 * is no request a client sends that would mean anything to it. `git
 * http-backend` is git's own reference implementation of the smart
 * protocol; wired up here as a small CGI bridge so pushToRemote is
 * exercised against a real HTTP git server, including real 401 responses,
 * not a mock of what one would say.
 */

function gitHttpBackend(
  reposRoot: string,
  requireAuthFor: (pathInfo: string) => boolean,
  token: string,
) {
  return (request: http.IncomingMessage, response: http.ServerResponse) => {
    const [pathInfo = "/", queryString = ""] = (request.url ?? "/").split("?");

    if (requireAuthFor(pathInfo)) {
      const expected = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
      if (request.headers.authorization !== expected) {
        response
          .writeHead(401, { "www-authenticate": 'Basic realm="git"' })
          .end("Authentication failed");
        return;
      }
    }

    const cgi = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: reposRoot,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: decodeURIComponent(pathInfo),
        QUERY_STRING: queryString,
        REQUEST_METHOD: request.method ?? "GET",
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: request.headers["content-length"] ?? "",
        REMOTE_ADDR: "127.0.0.1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    request.pipe(cgi.stdin);

    let headerBuffer = Buffer.alloc(0);
    let headersSent = false;

    cgi.stdout.on("data", (chunk: Buffer) => {
      if (headersSent) {
        response.write(chunk);
        return;
      }
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      // CGI's own header/body separator — a blank line, either line ending.
      const crlf = headerBuffer.indexOf("\r\n\r\n");
      const lf = headerBuffer.indexOf("\n\n");
      const sepAt = crlf !== -1 ? crlf : lf;
      const sepLen = crlf !== -1 ? 4 : 2;
      if (sepAt === -1) return; // headers not fully buffered yet

      const headerText = headerBuffer.slice(0, sepAt).toString("utf8");
      const body = headerBuffer.slice(sepAt + sepLen);
      const headers: http.OutgoingHttpHeaders = {};
      let status = 200;
      for (const line of headerText.split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === "status") status = Number.parseInt(value, 10) || 200;
        else headers[key] = value;
      }
      response.writeHead(status, headers);
      if (body.length > 0) response.write(body);
      headersSent = true;
    });

    cgi.stdout.on("end", () => {
      if (!headersSent) response.writeHead(200);
      response.end();
    });
    cgi.stderr.on("data", () => undefined); // git-http-backend's own diagnostics, not test output
  };
}

/** A real bare repository — `git push` needs a genuine remote, not a fake one. */
function initBareRepo(dir: string): void {
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", dir], {
    stdio: "pipe",
  });
  // git-http-backend refuses receive-pack for anonymous users by default —
  // this test server never sets REMOTE_USER (its own auth check is a plain
  // 401 gate on the path, done before git is even involved), so every
  // request looks anonymous to git itself unless this is set explicitly.
  execFileSync("git", ["config", "--bool", "http.receivepack", "true"], {
    cwd: dir,
    stdio: "pipe",
  });
}

const workspaceDir = path.join(os.tmpdir(), `zelyq-git-push-${Date.now()}`);
const reposRoot = path.join(os.tmpdir(), `zelyq-git-push-remotes-${Date.now()}`);
const driver = new LocalRuntimeDriver({
  kind: "local",
  workspaceDir,
  execTimeoutMs: 15_000,
  previewPortRange: [4981, 4990],
  previewHost: "127.0.0.1",
});
const projects = new ProjectService({} as Store, driver, {} as ServerConfig);

const TOKEN = "a-token-that-should-never-be-written-down";
let gitServer: http.Server;
let baseUrl: string;
let freshRepoCounter = 0;

/**
 * Every test that actually completes a push gets its own bare repo, never
 * shared — reusing one bare repo across tests risks two *unrelated*
 * projects' first commits landing on the same branch there, which is
 * exactly the non-fast-forward situation one of these tests exists to
 * construct on purpose. Sharing it would make that test's "before" state
 * an accident of test order, not a controlled setup.
 */
function createFreshPublicRepo(): string {
  const name = `public-${++freshRepoCounter}.git`;
  initBareRepo(path.join(reposRoot, name));
  return `${baseUrl}/${name}`;
}

before(async () => {
  const fs = await import("node:fs/promises");
  await fs.mkdir(reposRoot, { recursive: true });
  initBareRepo(path.join(reposRoot, "private.git"));

  gitServer = http.createServer(
    gitHttpBackend(reposRoot, (pathInfo) => pathInfo.startsWith("/private.git"), TOKEN),
  );
  await new Promise<void>((resolve) => gitServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(gitServer.address() as { port: number }).port}`;
});

after(async () => {
  const fs = await import("node:fs/promises");
  await new Promise<void>((resolve) => gitServer.close(() => resolve()));
  await driver.dispose();
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await fs.rm(reposRoot, { recursive: true, force: true });
});

async function projectWithOneCommit(id: string): Promise<void> {
  await driver.ensureProject(id);
  await driver.scaffold(id, [{ path: "index.html", content: "<html></html>" }]);
  await projects.ensureGitRepo(id);
  await projects.commitTurn(id, "first turn");
}

test("a project with no remote yet gets one, and the push lands on the real remote", async () => {
  const repoUrl = createFreshPublicRepo();
  await projectWithOneCommit("prj_fresh_push");

  await projects.pushToRemote("prj_fresh_push", repoUrl);

  const remoteLog = execFileSync("git", ["log", "--oneline", "--all"], {
    cwd: path.join(reposRoot, new URL(repoUrl).pathname.slice(1)),
    encoding: "utf8",
  });
  assert.match(remoteLog, /first turn/);
});

test("a second push reuses the already-configured remote, no URL needed again", async () => {
  const repoUrl = createFreshPublicRepo();
  await projectWithOneCommit("prj_second_push");
  await projects.pushToRemote("prj_second_push", repoUrl);

  await driver.writeFile("prj_second_push", "index.html", "<html>v2</html>", "utf8");
  await projects.commitTurn("prj_second_push", "second turn");
  await projects.pushToRemote("prj_second_push"); // no gitUrl this time

  const remoteLog = execFileSync("git", ["log", "--oneline", "--all"], {
    cwd: path.join(reposRoot, new URL(repoUrl).pathname.slice(1)),
    encoding: "utf8",
  });
  assert.match(remoteLog, /second turn/);
});

test("pushing with no remote and no URL is refused with a clear reason, not a raw git error", async () => {
  await projectWithOneCommit("prj_no_remote");
  await assert.rejects(() => projects.pushToRemote("prj_no_remote"), /no remote yet/i);
});

test("a private repository refuses a push with no token, and says what to do", async () => {
  await projectWithOneCommit("prj_private_no_token");
  await assert.rejects(
    () => projects.pushToRemote("prj_private_no_token", `${baseUrl}/private.git`),
    /needs a token with write access/i,
  );
});

test("a private repository refuses a bad token with clear, specific wording — not a raw git error", async () => {
  await projectWithOneCommit("prj_bad_token");
  await assert.rejects(
    () =>
      projects.pushToRemote("prj_bad_token", `${baseUrl}/private.git`, "the-wrong-token-entirely"),
    /that token was refused/i,
  );
});

test("a private repository accepts the right token, and the token is never left behind", async () => {
  await projectWithOneCommit("prj_good_token");
  await projects.pushToRemote("prj_good_token", `${baseUrl}/private.git`, TOKEN);

  const remoteLog = execFileSync("git", ["log", "--oneline", "--all"], {
    cwd: path.join(reposRoot, "private.git"),
    encoding: "utf8",
  });
  assert.match(remoteLog, /first turn/);

  const config = await driver
    .readFile("prj_good_token", ".git/config")
    .then((file) => file.content);
  assert.ok(!config.includes(TOKEN), "the token must never be written into the project");
});

test("a push is never a force push — a non-fast-forward is refused, and history is untouched", async () => {
  const repoUrl = createFreshPublicRepo();
  const repoDir = path.join(reposRoot, new URL(repoUrl).pathname.slice(1));
  await projectWithOneCommit("prj_diverged");
  await projects.pushToRemote("prj_diverged", repoUrl);

  const beforeLog = execFileSync("git", ["log", "--oneline"], {
    cwd: path.join(workspaceDir, "prj_diverged"),
    encoding: "utf8",
  });

  // Someone else pushes to the same remote in the meantime.
  const other = path.join(os.tmpdir(), `zelyq-git-push-other-${Date.now()}`);
  await execFileAsync("git", ["clone", "--quiet", repoUrl, other]);
  execFileSync("git", ["config", "user.email", "other@example.com"], { cwd: other, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Other"], { cwd: other, stdio: "pipe" });
  execFileSync(
    "git",
    ["commit", "--quiet", "--allow-empty", "-m", "a commit this project never saw"],
    {
      cwd: other,
      stdio: "pipe",
    },
  );
  await execFileAsync("git", ["push", "--quiet", "origin", "HEAD"], { cwd: other });

  await driver.writeFile("prj_diverged", "index.html", "<html>diverged</html>", "utf8");
  await projects.commitTurn("prj_diverged", "a conflicting turn");

  await assert.rejects(
    () => projects.pushToRemote("prj_diverged"),
    /never force-pushes|resolving by hand/i,
  );

  // The rejected push must not have corrupted or altered the project's own
  // history — asserted directly.
  const afterLog = execFileSync("git", ["log", "--oneline", "-2"], {
    cwd: path.join(workspaceDir, "prj_diverged"),
    encoding: "utf8",
  });
  assert.match(afterLog, /a conflicting turn/);
  assert.match(afterLog, /first turn/);
  assert.notEqual(beforeLog, afterLog, "the local commit from this turn is still there, untouched");

  const remoteLog = execFileSync("git", ["log", "--oneline", "--all", "-2"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.doesNotMatch(remoteLog, /a conflicting turn/, "the rejected push must not have landed");
});
