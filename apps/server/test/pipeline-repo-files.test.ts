import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { RepoFiles } from "../src/services/pipelines/repo-files.js";

/**
 * A pipeline file kept in its repository: each run reads it at its own
 * branch or commit, the default branch's file becomes the saved copy, and a
 * push cannot reach a secret or another repository the saved copy does not.
 * The repository is a real git repository in a local folder.
 */

const tmp = path.join(os.tmpdir(), `zelyq-repo-files-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "repo-files.db")}`,
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
    previewPortRange: [4950, 4953],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let owner: string;
let teamId: string;

function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  return server.app.inject({
    method,
    url,
    headers: { cookie: owner },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}
const team = (suffix: string) => `/api/teams/${teamId}${suffix}`;

async function create(source: string): Promise<string> {
  const response = await call("POST", team("/pipelines"), { source });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().pipeline.id;
}

async function finished(runId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = (await call("GET", team(`/pipeline-runs/${runId}`))).json().run;
    if (["passed", "failed", "cancelled", "timed_out"].includes(run.status)) {
      const lines = (await call("GET", team(`/pipeline-runs/${runId}/logs?after=0`))).json().lines;
      return { run, log: lines.map((line: { text: string }) => line.text).join("\n") as string };
    }
    if (Date.now() > deadline) throw new Error(`run ${runId} still ${run.status}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  owner = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  teamId = (await call("GET", "/api/teams")).json().teams[0].id;
  await call("PUT", "/api/settings", { pipelineLocalRunner: "host" });
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const REPO = "https://git.example.test/team/shop";
const work = path.join(tmp, "work");
const bare = path.join(tmp, "shop.git");

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: work,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "T",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  })
    .toString()
    .trim();
}

/** Writes the file on a branch and pushes it; returns the commit. */
async function commitFile(branch: string, file: string, text: string): Promise<string> {
  git("checkout", "-q", "-B", branch, branch === "main" ? "main" : "origin/main");
  await fs.mkdir(path.dirname(path.join(work, file)), { recursive: true });
  await fs.writeFile(path.join(work, file), text);
  git("add", "-A");
  git("commit", "-q", "-m", `change on ${branch}`);
  git("push", "-q", "-f", "origin", branch);
  return git("rev-parse", "HEAD");
}

before(async () => {
  await fs.mkdir(work, { recursive: true });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", bare);
  await fs.writeFile(path.join(work, "README.md"), "shop\n");
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  git("push", "-q", "origin", "main");
  git("fetch", "-q", "origin");
  // The pipeline names an https:// repository; reads go to the local one.
  const local = new RepoFiles("file");
  const url = `file://${bare}`;
  server.pipelines.repoFiles = {
    read: (input) => local.read({ ...input, repo: input.repo === REPO ? url : input.repo }),
    defaultBranch: (repo, token) => local.defaultBranch(repo === REPO ? url : repo, token),
  };
});

const FILE = ".zelyq/pipelines/shop.yml";
const PIPELINE = (say: string, extra = "") =>
  `name: Shop\nsource:\n  repo: ${REPO}\nruns-on: local\nstages:\n  - name: Build\n    steps:\n      - run: echo ${say}${extra}\n`;

async function pushHook(id: string) {
  const added = await call("POST", team(`/pipelines/${id}/triggers`), {
    kind: "push",
    branches: ["**"],
  });
  assert.equal(added.statusCode, 201, added.body);
  const { trigger, secret } = added.json() as { trigger: { id: string }; secret: string };
  return (branch: string, commit: string) => {
    const payload = JSON.stringify({ ref: `refs/heads/${branch}`, after: commit });
    return server.app.inject({
      method: "POST",
      url: `/api/hooks/pipelines/${trigger.id}`,
      headers: {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
      },
      payload,
    });
  };
}

async function newestRun(id: string) {
  const runs = (await call("GET", team(`/pipelines/${id}/runs`))).json().runs as { id: string }[];
  return finished(runs[0]?.id ?? "");
}

test("a file kept in the repository: linked, run per branch, kept current from main", async () => {
  const id = await create(PIPELINE("from-zelyq"));

  // Not on the default branch yet: linking says so and changes nothing.
  const early = await call("PUT", team(`/pipelines/${id}/repo`), { path: FILE });
  assert.equal(early.statusCode, 400, early.body);
  assert.match(early.json().error.message, /There is no \.zelyq\/pipelines\/shop\.yml/);
  const bad = await call("PUT", team(`/pipelines/${id}/repo`), { path: "../outside.yml" });
  assert.equal(bad.statusCode, 400, bad.body);

  const mainCommit = await commitFile("main", FILE, PIPELINE("from-main"));
  const linked = await call("PUT", team(`/pipelines/${id}/repo`), { path: FILE });
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.json().pipeline.repoPath, FILE);
  assert.match(linked.json().pipeline.source, /from-main/);

  // Saving from Zelyq would disagree with the repository: refused.
  const save = await call("PUT", team(`/pipelines/${id}`), { source: PIPELINE("edited-here") });
  assert.equal(save.statusCode, 409, save.body);

  // Run with no branch: the default branch's file, pinned to its commit.
  const started = await call("POST", team(`/pipelines/${id}/runs`), {});
  assert.equal(started.statusCode, 201, started.body);
  const manual = await finished(started.json().run.id);
  assert.equal(manual.run.status, "passed", manual.log);
  assert.match(manual.log, /from-main/);
  assert.equal(manual.run.commit, mainCommit);

  // A branch runs its own file.
  const hook = await pushHook(id);
  const featureCommit = await commitFile("feature/a", FILE, PIPELINE("from-feature"));
  assert.equal((await hook("feature/a", featureCommit)).statusCode, 201);
  const feature = await newestRun(id);
  assert.equal(feature.run.status, "passed", feature.log);
  assert.match(feature.log, /from-feature/);
  const kept = (await call("GET", team(`/pipelines/${id}`))).json().pipeline;
  assert.match(kept.source, /from-main/, "a branch does not change the saved copy");

  // A push to main changes the saved copy, keeping who last saved it.
  const newMain = await commitFile("main", FILE, PIPELINE("main-again"));
  assert.equal((await hook("main", newMain)).statusCode, 201);
  const onMain = await newestRun(id);
  assert.match(onMain.log, /main-again/);
  const after = (await call("GET", team(`/pipelines/${id}`))).json().pipeline;
  assert.match(after.source, /main-again/);
  assert.equal(after.updatedBy?.name, "Owner");

  // Stop keeping it in the repository: saving works again.
  const unlinked = await call("DELETE", team(`/pipelines/${id}/repo`));
  assert.equal(unlinked.json().pipeline.repoPath, null);
  const saved = await call("PUT", team(`/pipelines/${id}`), { source: PIPELINE("edited-here") });
  assert.equal(saved.statusCode, 200, saved.body);
});

test("a push cannot reach what the saved copy does not allow", async () => {
  await commitFile(
    "main",
    ".zelyq/pipelines/guard.yml",
    PIPELINE("guard").replace("Shop", "Guard"),
  );
  const id = await create(PIPELINE("guard").replace("Shop", "Guard"));
  const linked = await call("PUT", team(`/pipelines/${id}/repo`), {
    path: ".zelyq/pipelines/guard.yml",
  });
  assert.equal(linked.statusCode, 200, linked.body);
  const hook = await pushHook(id);

  const cases: [string, string, RegExp][] = [
    [
      "secret",
      PIPELINE("x", "\n        env: { TOKEN: vault://DEPLOY_KEY }").replace("Shop", "Guard"),
      /uses DEPLOY_KEY from Vault, which this pipeline may not use yet/,
    ],
    [
      "elsewhere",
      PIPELINE("x").replace("Shop", "Guard").replace(REPO, "https://evil.example.test/x"),
      /changes source:/,
    ],
    ["broken", "name: Guard\nstages: nope\n", /is not valid/],
  ];
  for (const [branch, text, expected] of cases) {
    const commit = await commitFile(branch, ".zelyq/pipelines/guard.yml", text);
    assert.equal((await hook(branch, commit)).statusCode, 201);
    const run = await newestRun(id);
    assert.equal(run.run.status, "failed", branch);
    assert.match(run.run.error ?? "", expected, branch);
  }

  // A branch without the file.
  git("checkout", "-q", "-B", "empty", "origin/main");
  git("rm", "-q", "-r", ".zelyq");
  git("commit", "-q", "-m", "no pipelines");
  git("push", "-q", "-f", "origin", "empty");
  assert.equal((await hook("empty", git("rev-parse", "HEAD"))).statusCode, 201);
  const missing = await newestRun(id);
  assert.match(missing.run.error ?? "", /There is no \.zelyq\/pipelines\/guard\.yml/);

  // Run again reads the same commit from the repository again: never the saved copy.
  const again = await call("POST", team(`/pipeline-runs/${missing.run.id}/rerun`), {
    fromStage: null,
  });
  assert.equal(again.statusCode, 400, again.body);
  assert.match(again.json().error.message, /There is no \.zelyq\/pipelines\/guard\.yml/);
});
