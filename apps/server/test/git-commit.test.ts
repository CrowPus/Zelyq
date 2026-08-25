import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { Store } from "@zelyq/db";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import type { ServerConfig } from "../src/config.js";
import { ProjectService } from "../src/services/projects.js";

/**
 * Git integration Part A — see `035` in the council notes. Against a real
 * `LocalRuntimeDriver` and real git, not a mock of git's own behaviour —
 * the same standard `031` and `034` already held their own live-system
 * claims to.
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
