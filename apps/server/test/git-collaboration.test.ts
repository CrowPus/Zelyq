import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { LocalRuntimeDriver } from "@zelyq/runtime";
import {
  assertBranchName,
  GitService,
  generatedBranchName,
  parseGitHubRepo,
  redactCredentials,
  sameRemote,
} from "../src/services/git.js";

/**
 * Collaboration: two people and one repository.
 *
 * Against real git, and against a real remote — a bare repository on disk that
 * a second working copy also pushes to. Mocking git here would only prove that
 * the mock behaves the way this code expects it to, which is precisely the
 * assumption worth doubting: every rule in `GitService` exists because of
 * something git actually does (a pull refusing to fast-forward, a push
 * rejected as non-fast-forward, a rebase leaving `.git/rebase-merge` behind),
 * and none of that is observable against a fake.
 *
 * `file://` remotes are used deliberately: they exercise the same fetch, merge
 * and push machinery as a network remote without needing one.
 */
const run = promisify(execFile);

const scratch = path.join(os.tmpdir(), `zelyq-git-collab-${Date.now()}`);
const workspaceDir = path.join(scratch, "workspace");
/** Stands in for GitHub: what both sides push to and pull from. */
const remoteDir = path.join(scratch, "remote.git");
/** The collaborator's own checkout, entirely outside Zelyq. */
const otherDir = path.join(scratch, "collaborator");

const driver = new LocalRuntimeDriver({
  kind: "local",
  workspaceDir,
  execTimeoutMs: 30_000,
  previewPortRange: [4960, 4969],
  previewHost: "127.0.0.1",
});
const git = new GitService(driver);

/** git in the collaborator's checkout — the other person in every test below. */
async function collaborator(...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: otherDir });
  return stdout;
}

before(async () => {
  await fs.mkdir(remoteDir, { recursive: true });
  await run("git", ["init", "--bare", "-q", "--initial-branch=main", remoteDir]);

  await fs.mkdir(otherDir, { recursive: true });
  await collaborator("init", "-q", "--initial-branch=main");
  await collaborator("config", "user.name", "Collaborator");
  await collaborator("config", "user.email", "collaborator@example.invalid");
  await collaborator("remote", "add", "origin", remoteDir);
  await fs.writeFile(path.join(otherDir, "README.md"), "# shared\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Shared history");
  await collaborator("push", "-q", "-u", "origin", "main");
});

after(async () => {
  await driver.dispose();
  await fs.rm(scratch, { recursive: true, force: true });
});

/** A project that already tracks the shared repository, as a clone would leave it. */
async function clonedProject(id: string): Promise<void> {
  await driver.ensureProject(id);
  await run("git", ["clone", "-q", remoteDir, "."], { cwd: path.join(workspaceDir, id) });
  await run("git", ["config", "user.name", "Zelyq"], { cwd: path.join(workspaceDir, id) });
  await run("git", ["config", "user.email", "noreply@zelyq.dev"], {
    cwd: path.join(workspaceDir, id),
  });
}

// -------------------------------------------------------------------------
// Status
// -------------------------------------------------------------------------

test("a project with no repository says so instead of failing", async () => {
  await driver.ensureProject("prj_norepo");
  const status = await git.status("prj_norepo");

  assert.equal(status.repository, false);
  assert.equal(status.branch, null);
  assert.equal(status.remote, null);
  assert.equal(status.commits, 0);
});

test("status reports branch, remote, commits and cleanliness", async () => {
  await clonedProject("prj_status");
  const status = await git.status("prj_status");

  assert.equal(status.repository, true);
  assert.equal(status.branch, "main");
  assert.equal(status.commits, 1);
  assert.equal(status.ahead, 0);
  assert.equal(status.behind, 0);
  assert.equal(status.dirty, false);
  assert.deepEqual(status.conflicts, []);
  assert.equal(status.inProgress, null);
  assert.match(status.remote ?? "", /remote\.git$/);
});

test("status counts what is waiting in each direction", async () => {
  await clonedProject("prj_counts");

  // The collaborator moves on.
  await fs.writeFile(path.join(otherDir, "theirs.txt"), "their work\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Their change");
  await collaborator("push", "-q", "origin", "main");

  // And so does this project.
  await driver.writeFile("prj_counts", "ours.txt", "our work", "utf8");
  await git.commitTurn("prj_counts", "add our work");

  const stale = await git.status("prj_counts");
  assert.equal(stale.ahead, 1, "one commit of ours is waiting to be pushed");
  assert.equal(stale.behind, 0, "and until a fetch, theirs is not visible at all");

  const fetched = await git.fetch("prj_counts");
  assert.equal(fetched.ahead, 1);
  assert.equal(fetched.behind, 1, "after a fetch, theirs is");
  assert.notEqual(fetched.fetchedAt, null, "and when that was is recorded");
});

// -------------------------------------------------------------------------
// The remote — the confusion this design exists to prevent
// -------------------------------------------------------------------------

test("pointing a project somewhere new is refused until it is confirmed", async () => {
  await driver.ensureProject("prj_repoint");
  await git.ensureRepo("prj_repoint");
  await git.setRemote("prj_repoint", "https://example.invalid/first.git", false);

  await assert.rejects(
    () => git.setRemote("prj_repoint", "https://example.invalid/second.git", false),
    (error: Error & { details?: Record<string, unknown> }) => {
      assert.match(error.message, /already pushes to/i);
      assert.equal(error.details?.currentRemote, "https://example.invalid/first.git");
      return true;
    },
    "a silent repoint is how commits end up somewhere nobody is looking",
  );

  // Still pointing at the original, because the change was refused.
  assert.equal(
    (await git.status("prj_repoint")).remote,
    "https://example.invalid/first.git",
    "a refused change must not have half-happened",
  );

  await git.setRemote("prj_repoint", "https://example.invalid/second.git", true);
  assert.equal((await git.status("prj_repoint")).remote, "https://example.invalid/second.git");
});

test("re-entering the same address is not treated as a change", async () => {
  await driver.ensureProject("prj_sameurl");
  await git.ensureRepo("prj_sameurl");
  await git.setRemote("prj_sameurl", "https://example.invalid/repo.git", false);

  // Same repository, written the way a different page would show it.
  await git.setRemote("prj_sameurl", "https://example.invalid/repo", false);
  assert.equal((await git.status("prj_sameurl")).remote, "https://example.invalid/repo.git");
});

test("there is only ever one remote, and it is always origin", async () => {
  await driver.ensureProject("prj_oneremote");
  await git.ensureRepo("prj_oneremote");
  await git.setRemote("prj_oneremote", "https://example.invalid/a.git", false);
  await git.setRemote("prj_oneremote", "https://example.invalid/b.git", true);

  const remotes = await driver.exec("prj_oneremote", { command: "git remote" });
  assert.equal(remotes.stdout.trim(), "origin", "a second remote is a second way to push wrong");
});

test("pushing to an address other than the project's own remote is refused", async () => {
  await clonedProject("prj_wrongtarget");

  await assert.rejects(
    () => git.push("prj_wrongtarget", "https://example.invalid/somewhere-else.git"),
    (error: Error) => {
      assert.match(error.message, /not the address given/i);
      return true;
    },
    "the old code ignored the address and pushed to the existing remote anyway",
  );
});

// -------------------------------------------------------------------------
// Pulling
// -------------------------------------------------------------------------

test("a pull that only needs fast-forwarding just works", async () => {
  await clonedProject("prj_ff");

  await fs.writeFile(path.join(otherDir, "ff.txt"), "from them\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Their fast-forward");
  await collaborator("push", "-q", "origin", "main");

  const status = await git.pull("prj_ff", { strategy: "ff-only", onConflict: "abort" });
  assert.equal(status.pulled, true);
  assert.equal(status.behind, 0);

  const file = await driver.readFile("prj_ff", "ff.txt");
  assert.equal(file.content, "from them\n");
});

test("a pull onto uncommitted work is refused before anything is touched", async () => {
  await clonedProject("prj_dirtypull");
  await driver.writeFile("prj_dirtypull", "wip.txt", "not committed yet", "utf8");

  await assert.rejects(
    () => git.pull("prj_dirtypull", { strategy: "ff-only", onConflict: "abort" }),
    /not committed yet/i,
  );

  const still = await driver.readFile("prj_dirtypull", "wip.txt");
  assert.equal(still.content, "not committed yet", "the uncommitted work is still there");
});

test("diverged histories are reported with both counts, not silently merged", async () => {
  await clonedProject("prj_diverged");

  await fs.writeFile(path.join(otherDir, "theirs-diverge.txt"), "theirs\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Theirs");
  await collaborator("push", "-q", "origin", "main");

  await driver.writeFile("prj_diverged", "ours-diverge.txt", "ours", "utf8");
  await git.commitTurn("prj_diverged", "ours");

  await assert.rejects(
    () => git.pull("prj_diverged", { strategy: "ff-only", onConflict: "abort" }),
    (error: Error & { details?: Record<string, unknown> }) => {
      assert.match(error.message, /both moved on/i);
      assert.equal(error.details?.ahead, 1);
      assert.equal(error.details?.behind, 1);
      return true;
    },
    "choosing between a merge and a rebase is the user's call, not this code's",
  );

  // Asked for explicitly, it goes through.
  const rebased = await git.pull("prj_diverged", { strategy: "rebase", onConflict: "abort" });
  assert.equal(rebased.pulled, true);
  assert.equal(rebased.behind, 0);
  assert.equal(rebased.ahead, 1, "our commit is now on top of theirs, still unpushed");
});

test("a conflicting pull is undone, leaving the project exactly as it was", async () => {
  await clonedProject("prj_conflict");

  // Both sides change the same line of the same file.
  await fs.writeFile(path.join(otherDir, "shared.txt"), "their version\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Their edit");
  await collaborator("push", "-q", "origin", "main");

  await driver.writeFile("prj_conflict", "shared.txt", "our version\n", "utf8");
  await git.commitTurn("prj_conflict", "our edit");
  const before = await git.status("prj_conflict");

  await assert.rejects(
    () => git.pull("prj_conflict", { strategy: "merge", onConflict: "abort" }),
    (error: Error & { details?: Record<string, unknown> }) => {
      assert.match(error.message, /clash/i);
      assert.deepEqual(error.details?.conflicts, ["shared.txt"]);
      return true;
    },
  );

  const after = await git.status("prj_conflict");
  assert.equal(after.inProgress, null, "no half-finished merge is left behind");
  assert.deepEqual(after.conflicts, [], "and no conflict markers in the tree");
  assert.equal(after.dirty, false);
  assert.equal(after.commits, before.commits, "history is untouched");

  const file = await driver.readFile("prj_conflict", "shared.txt");
  assert.equal(file.content, "our version\n", "our file is exactly as it was");
});

test("keeping a conflict is possible when it is asked for explicitly", async () => {
  await clonedProject("prj_keepconflict");

  await fs.writeFile(path.join(otherDir, "keep.txt"), "theirs\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Their keep");
  await collaborator("push", "-q", "origin", "main");

  await driver.writeFile("prj_keepconflict", "keep.txt", "ours\n", "utf8");
  await git.commitTurn("prj_keepconflict", "our keep");

  const status = await git.pull("prj_keepconflict", { strategy: "merge", onConflict: "keep" });
  assert.equal(status.pulled, false);
  assert.deepEqual(status.conflicts, ["keep.txt"]);
  assert.equal(status.inProgress, "merge");
});

// -------------------------------------------------------------------------
// The agent, while all of that is going on
// -------------------------------------------------------------------------

test("the agent will not commit into an unfinished merge", async () => {
  await clonedProject("prj_noturn");

  await fs.writeFile(path.join(otherDir, "block.txt"), "theirs\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Their block");
  await collaborator("push", "-q", "origin", "main");

  await driver.writeFile("prj_noturn", "block.txt", "ours\n", "utf8");
  await git.commitTurn("prj_noturn", "our block");
  await git.pull("prj_noturn", { strategy: "merge", onConflict: "keep" }).catch(() => undefined);

  assert.equal((await git.status("prj_noturn")).inProgress, "merge", "set up as intended");

  // This is what stops a turn: committing here would put conflict markers into
  // the history and then into the collaborator's next pull.
  await assert.rejects(() => git.assertCommittable("prj_noturn"), /middle of a merge/i);
  await assert.rejects(() => git.commitTurn("prj_noturn", "another turn"), /middle of a merge/i);
});

test("a turn reports how far the remote has moved on, without any network call", async () => {
  await clonedProject("prj_behindreport");

  await fs.writeFile(path.join(otherDir, "ahead.txt"), "theirs\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Their commit");
  await collaborator("push", "-q", "origin", "main");
  await git.fetch("prj_behindreport"); // as a pull or an earlier check would have

  await driver.writeFile("prj_behindreport", "mine.txt", "ours", "utf8");
  const result = await git.commitTurn("prj_behindreport", "build something");

  assert.equal(result.committed, true);
  assert.equal(result.behind, 1, "so the user is told before they try to push");
  assert.equal(result.branch, "main");
});

test("a turn that changes nothing produces no commit and no noise", async () => {
  await clonedProject("prj_nochange");
  const result = await git.commitTurn("prj_nochange", "read some files");
  assert.equal(result.committed, false);
});

// -------------------------------------------------------------------------
// Pushing
// -------------------------------------------------------------------------

test("a push sets up tracking, so later counts are possible at all", async () => {
  await clonedProject("prj_tracking");
  await driver.exec("prj_tracking", { command: "git checkout -q -b feature" });
  await driver.writeFile("prj_tracking", "feature.txt", "work", "utf8");
  await git.commitTurn("prj_tracking", "a feature");

  assert.equal((await git.status("prj_tracking")).upstream, null, "no tracking yet");

  const pushed = await git.push("prj_tracking");
  assert.equal(pushed.branch, "feature", "the current branch, not a bare HEAD");
  assert.equal((await git.status("prj_tracking")).upstream, "origin/feature");
});

test("a push that would overwrite a collaborator's work is refused", async () => {
  await clonedProject("prj_norace");

  await fs.writeFile(path.join(otherDir, "race.txt"), "theirs\n");
  await collaborator("add", "-A");
  await collaborator("commit", "-q", "-m", "Their race");
  await collaborator("push", "-q", "origin", "main");

  await driver.writeFile("prj_norace", "ours-race.txt", "ours", "utf8");
  await git.commitTurn("prj_norace", "ours");

  await assert.rejects(
    () => git.push("prj_norace"),
    (error: Error) => {
      assert.match(error.message, /pull first|does not|doesn't/i);
      return true;
    },
    "never force-push: the collaborator's commit must survive",
  );

  // And it did.
  const remoteLog = await run("git", ["log", "--oneline", "main"], { cwd: remoteDir });
  assert.match(remoteLog.stdout, /Their race/);
});

// -------------------------------------------------------------------------
// Branches
// -------------------------------------------------------------------------

test("switching branch is refused while there is uncommitted work", async () => {
  await clonedProject("prj_branchdirty");
  await driver.writeFile("prj_branchdirty", "loose.txt", "uncommitted", "utf8");

  await assert.rejects(
    () => git.switchBranch("prj_branchdirty", "somewhere-else", true),
    /not committed yet/i,
  );
});

test("switching to a new branch, and back", async () => {
  await clonedProject("prj_branches");
  const created = await git.switchBranch("prj_branches", "feature/login", true);
  assert.equal(created.branch, "feature/login");

  const back = await git.switchBranch("prj_branches", "main", false);
  assert.equal(back.branch, "main");

  await assert.rejects(
    () => git.switchBranch("prj_branches", "never-created", false),
    /no branch called/i,
  );
});

// -------------------------------------------------------------------------
// The small pieces, checked directly
// -------------------------------------------------------------------------

test("branch names that git would reject are refused with a readable reason", () => {
  assert.doesNotThrow(() => assertBranchName("feature/add-login"));
  assert.doesNotThrow(() => assertBranchName("zelyq/fix-2"));
  for (const bad of ["has space", "-leading", "trailing/", "dots..inside", "star*", "ends.lock"]) {
    assert.throws(() => assertBranchName(bad), /not a usable branch name/i, bad);
  }
});

test("credentials in a URL never leave the server", () => {
  assert.equal(
    redactCredentials("https://user:ghp_secret@github.com/o/r.git"),
    "https://github.com/o/r.git",
  );
  assert.equal(redactCredentials("https://github.com/o/r.git"), "https://github.com/o/r.git");
  assert.equal(redactCredentials(null), null);
});

test("the same repository written two ways is one repository", () => {
  assert.equal(sameRemote("https://x/r.git", "https://x/r"), true);
  assert.equal(sameRemote("https://x/r/", "https://x/r"), true);
  assert.equal(sameRemote("https://x/r", "https://x/other"), false);
});

test("only real GitHub addresses are treated as GitHub", () => {
  assert.deepEqual(parseGitHubRepo("https://github.com/CrowPus/edsa-app.git"), {
    owner: "CrowPus",
    name: "edsa-app",
  });
  assert.deepEqual(parseGitHubRepo("https://github.com/o/r"), { owner: "o", name: "r" });
  assert.equal(parseGitHubRepo("https://gitlab.com/o/r.git"), null);
  // The one that matters: a host that merely contains the word.
  assert.equal(parseGitHubRepo("https://github.com.evil.example/o/r.git"), null);
});

test("a generated branch name is readable and unlikely to collide", () => {
  const first = generatedBranchName("Add a contact form!");
  assert.match(first, /^zelyq\/add-a-contact-form-[0-9a-f]{6}$/);
  assert.notEqual(first, generatedBranchName("Add a contact form!"));
  assert.doesNotThrow(() => assertBranchName(first));
  assert.match(generatedBranchName("!!!"), /^zelyq\/changes-/);
});
