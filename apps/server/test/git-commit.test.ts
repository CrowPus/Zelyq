import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { Store } from "@zelyq/db";
import { LocalRuntimeDriver, type RuntimeDriver } from "@zelyq/runtime";
import type { ServerConfig } from "../src/config.js";
import { ProjectService } from "../src/services/projects.js";

/**
 * Git integration, part A. Against a real `LocalRuntimeDriver` and real
 * git, not a mock of git's own behaviour.
 *
 * `ensureGitRepo`/`commitTurn` only ever touch `runtime` — `store` and
 * `config` are never read by either, so real ones here would be pure
 * overhead.
 */
const workspaceDir = path.join(os.tmpdir(), `zelyq-git-commit-${Date.now()}`);
const driver = new LocalRuntimeDriver({
  kind: "local",
  workspaceDir,
  execTimeoutMs: 15_000,
  previewPortRange: [4970, 4980],
  previewHost: "127.0.0.1",
});
const projects = new ProjectService({} as Store, driver, {} as ServerConfig);

after(async () => {
  await driver.dispose();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("a scaffolded project's first turn produces a real git repository with one commit", async () => {
  await driver.ensureProject("prj_first");
  await driver.scaffold("prj_first", [{ path: "index.html", content: "<html></html>" }]);

  await projects.ensureGitRepo("prj_first");
  await projects.commitTurn("prj_first", "build a landing page");

  const log = await driver.exec("prj_first", { command: "git log --oneline" });
  assert.equal(log.exitCode, 0);
  assert.equal(log.stdout.trim().split("\n").length, 1);
  assert.match(log.stdout, /Before: build a landing page/);
});

test("a second turn that changes files produces a second commit with that turn's own message", async () => {
  await driver.ensureProject("prj_second");
  await driver.scaffold("prj_second", [{ path: "index.html", content: "<html></html>" }]);
  await projects.ensureGitRepo("prj_second");
  await projects.commitTurn("prj_second", "first turn");

  await driver.writeFile("prj_second", "index.html", "<html>changed</html>", "utf8");
  await projects.commitTurn("prj_second", "second turn");

  const log = await driver.exec("prj_second", { command: "git log --oneline" });
  const lines = log.stdout.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", /second turn/);
  assert.match(lines[1] ?? "", /first turn/);
});

test("a turn that changes nothing produces no empty commit", async () => {
  await driver.ensureProject("prj_noop");
  await driver.scaffold("prj_noop", [{ path: "index.html", content: "<html></html>" }]);
  await projects.ensureGitRepo("prj_noop");
  await projects.commitTurn("prj_noop", "first turn");

  await projects.commitTurn("prj_noop", "did nothing"); // no file changed since

  const log = await driver.exec("prj_noop", { command: "git log --oneline" });
  assert.equal(log.stdout.trim().split("\n").length, 1, "still exactly one commit");
});

test("ensureGitRepo is idempotent — a second call does not reset anything", async () => {
  await driver.ensureProject("prj_idempotent");
  await driver.scaffold("prj_idempotent", [{ path: "index.html", content: "<html></html>" }]);

  await projects.ensureGitRepo("prj_idempotent");
  await projects.commitTurn("prj_idempotent", "first turn");
  await projects.ensureGitRepo("prj_idempotent"); // must not throw or reset the repo

  const log = await driver.exec("prj_idempotent", { command: "git log --oneline" });
  assert.equal(
    log.stdout.trim().split("\n").length,
    1,
    "the existing commit survives a second init",
  );
});

test("the default commit identity is Zelyq's own", async () => {
  await driver.ensureProject("prj_identity");
  await driver.scaffold("prj_identity", [{ path: "index.html", content: "<html></html>" }]);
  await projects.ensureGitRepo("prj_identity");

  const name = await driver.exec("prj_identity", { command: "git config --local user.name" });
  const email = await driver.exec("prj_identity", { command: "git config --local user.email" });
  assert.equal(name.stdout.trim(), "Zelyq");
  assert.equal(email.stdout.trim(), "noreply@zelyq.dev");
});

test("a project with its own already-configured identity is not overwritten", async () => {
  await driver.ensureProject("prj_own_identity");
  await driver.scaffold("prj_own_identity", [{ path: "index.html", content: "<html></html>" }]);
  // Standing in for a cloned repository that already has a local identity
  // set, however that came to be, before Zelyq ever touches it.
  await driver.exec("prj_own_identity", { command: "git init -q" });
  await driver.exec("prj_own_identity", { command: 'git config --local user.name "Someone Else"' });
  await driver.exec("prj_own_identity", {
    command: 'git config --local user.email "someone@example.com"',
  });

  await projects.ensureGitRepo("prj_own_identity");

  const name = await driver.exec("prj_own_identity", { command: "git config --local user.name" });
  assert.equal(name.stdout.trim(), "Someone Else", "an existing identity must not be clobbered");
});

test("commitTurn on a project with no .git at all fails loudly rather than corrupting anything", async () => {
  await driver.ensureProject("prj_no_git");
  await driver.scaffold("prj_no_git", [{ path: "index.html", content: "<html></html>" }]);
  // Deliberately never calling ensureGitRepo — this is the caller's
  // contract, not something commitTurn silently repairs on its own.
  await assert.rejects(() => projects.commitTurn("prj_no_git", "oops"));
});

test("a project inside an enclosing repository gets its own, and never touches the outer one", async () => {
  // The default workspace directory sits inside the Zelyq checkout, so on the
  // local runtime every project directory has a git repository above it.
  // Checking only that *a* repository exists skipped `git init`, wrote Zelyq's
  // identity into the developer's own config, and committed their whole
  // working tree under the project's turn prompt. Found by running the e2e
  // suite, which does exactly that.
  const outerRoot = path.join(os.tmpdir(), `zelyq-git-outer-${Date.now()}`);
  const outerWorkspace = path.join(outerRoot, "workspace");
  await fs.mkdir(outerWorkspace, { recursive: true });
  const outer = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir: outerWorkspace,
    execTimeoutMs: 15_000,
    previewPortRange: [4981, 4990],
    previewHost: "127.0.0.1",
  });
  const nested = new ProjectService({} as Store, outer, {} as ServerConfig);

  const git = async (args: string) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    return promisify(execFile)("git", args.split(" "), { cwd: outerRoot });
  };
  await git("init -q");
  await git("config --local user.name Outer");
  await git("config --local user.email outer@example.invalid");
  await fs.writeFile(path.join(outerRoot, "untracked.txt"), "the developer's work in progress");

  try {
    await outer.ensureProject("prj_nested");
    await outer.scaffold("prj_nested", [{ path: "index.html", content: "<html></html>" }]);
    await nested.ensureGitRepo("prj_nested");
    await nested.commitTurn("prj_nested", "build a landing page");

    const inner = await outer.exec("prj_nested", { command: "git log --oneline" });
    assert.match(inner.stdout, /Before: build a landing page/, "the project has its own history");

    const outerLog = await git("log --oneline").catch((error: unknown) => ({
      stdout: String(error),
    }));
    assert.doesNotMatch(
      outerLog.stdout,
      /Before:/,
      "the enclosing repository must have no commits from a project's turn",
    );
    const identity = await git("config --local user.name");
    assert.equal(identity.stdout.trim(), "Outer", "the developer's own identity is untouched");
  } finally {
    await outer.dispose();
    await fs.rm(outerRoot, { recursive: true, force: true });
  }
});

/**
 * Git integration, part B: the environment has no git in it at all.
 *
 * This is not hypothetical. Project containers ran on `node:22-bookworm-slim`,
 * which ships no git, so `git init` and every per-turn commit failed with the
 * shell's own "command not found" — and because `gateway.ts` treats both as
 * best-effort, silently. What the user eventually saw was that raw shell line
 * pasted into a push dialog, which explains nothing and names no fix.
 *
 * A fake runtime rather than a real one, deliberately: the only way to get a
 * real driver to have no git is to uninstall git from the machine running the
 * tests.
 */
function runtimeWithoutGit(): RuntimeDriver {
  const notFound = {
    stdout: "",
    stderr: "/bin/bash: line 1: git: command not found",
    exitCode: 127,
    durationMs: 1,
    truncated: false,
    timedOut: false,
  };
  return {
    exec: async (_id: string, options: { command: string }) =>
      options.command.startsWith("git") ? notFound : { ...notFound, stderr: "", exitCode: 0 },
  } as unknown as RuntimeDriver;
}

test("a project environment with no git says so, rather than repeating the shell's error", async () => {
  const service = new ProjectService({} as Store, runtimeWithoutGit(), {} as ServerConfig);

  await assert.rejects(
    () => service.ensureGitRepo("prj_nogit"),
    (error: Error) => {
      assert.match(error.message, /git is not installed/i);
      assert.doesNotMatch(error.message, /command not found/i);
      return true;
    },
  );

  await assert.rejects(
    () => service.commitTurn("prj_nogit", "build a landing page"),
    /git is not installed/i,
  );

  await assert.rejects(
    () => service.pushToRemote("prj_nogit", "https://example.invalid/repo.git"),
    /git is not installed/i,
  );
});

/**
 * Git integration, part C: pushing a project that has never had a turn.
 *
 * `ensureGitRepo` runs at the *start of a turn*, so a project built before
 * Zelyq kept histories — or one simply not prompted since — has no `.git` at
 * all. Push assumed one was there, and what the user got was git's own "fatal:
 * not a git repository", from a dialog that had just asked them for a
 * repository address. The push has to be able to stand on its own.
 *
 * Pushing for real needs a remote, so this stops at the point the old code
 * failed: the repository, and a first commit for `HEAD` to name.
 */
test("pushing a project that has never had a turn prepares its history first", async () => {
  await driver.ensureProject("prj_neverturned");
  await driver.scaffold("prj_neverturned", [{ path: "index.html", content: "<html></html>" }]);

  const before = await driver.exec("prj_neverturned", { command: "git rev-parse --show-toplevel" });
  assert.notEqual(before.exitCode, 0, "this project must genuinely have no repository yet");

  // The remote is unreachable, so the push itself fails — after the part that
  // used to fail first has already succeeded.
  await projects
    .pushToRemote("prj_neverturned", "https://example.invalid/nope.git")
    .catch(() => undefined);

  const log = await driver.exec("prj_neverturned", { command: "git log --oneline" });
  assert.equal(log.exitCode, 0, "the project now has a repository");
  assert.match(log.stdout, /Initial commit/);
});

test("pushing an empty project says there is nothing to push", async () => {
  await driver.ensureProject("prj_emptypush");

  await assert.rejects(
    () => projects.pushToRemote("prj_emptypush", "https://example.invalid/nope.git"),
    /no files yet/i,
  );
});

test("a project with no .gitignore of its own does not commit node_modules", async () => {
  await driver.ensureProject("prj_noignore");
  await driver.scaffold("prj_noignore", [
    { path: "index.html", content: "<html></html>" },
    { path: "node_modules/left-pad/index.js", content: "module.exports = 1;" },
    { path: ".env", content: "SECRET=hunter2" },
  ]);

  await projects.ensureGitRepo("prj_noignore");
  await projects.commitTurn("prj_noignore", "build a landing page");

  const files = await driver.exec("prj_noignore", { command: "git ls-files" });
  assert.match(files.stdout, /index\.html/, "the project's own files are committed");
  assert.doesNotMatch(files.stdout, /node_modules/, "dependencies are not");
  assert.doesNotMatch(files.stdout, /\.env/, "nor are secrets");
});

test("a project's own .gitignore is left to decide for itself", async () => {
  await driver.ensureProject("prj_ownignore");
  await driver.scaffold("prj_ownignore", [
    { path: ".gitignore", content: "dist\n" },
    { path: "index.html", content: "<html></html>" },
    { path: "node_modules/left-pad/index.js", content: "module.exports = 1;" },
  ]);

  await projects.ensureGitRepo("prj_ownignore");

  const exclude = await driver
    .readFile("prj_ownignore", ".git/info/exclude")
    .then((f) => f.content)
    .catch(() => "");
  assert.doesNotMatch(exclude, /node_modules/, "Zelyq must not override the project's own rules");
});
