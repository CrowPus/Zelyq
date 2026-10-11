import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * The pipeline views: favourites, and what a run remembers about where its
 * code came from — the pull request (number, title, link) and the commit
 * message — from GitHub and GitLab, kept on a re-run.
 */

const tmp = path.join(os.tmpdir(), `zelyq-views-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "views.db")}`,
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

let lastSecret = { id: "", secret: "" };

async function pushTrigger(id: string, extra: Record<string, unknown>) {
  const added = await call("POST", team(`/pipelines/${id}/triggers`), {
    kind: "push",
    branches: ["main"],
    ...extra,
  });
  assert.equal(added.statusCode, 201, added.body);
  const { trigger, secret } = added.json() as { trigger: { id: string }; secret: string };
  lastSecret = { id: trigger.id, secret };
  return (event: string, body: object) => {
    const payload = JSON.stringify(body);
    return server.app.inject({
      method: "POST",
      url: `/api/hooks/pipelines/${trigger.id}`,
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
      },
      payload,
    });
  };
}

const SIMPLE = (name: string) =>
  `name: ${name}\nruns-on: local\nstages:\n  - name: A\n    steps:\n      - run: echo hi\n`;

type RunInfo = {
  id: string;
  number: number;
  trigger: string;
  branch: string | null;
  commit: string | null;
  commitMessage: string | null;
  pullRequest: { number: number; title: string; url: string | null; base: string } | null;
};

test("a run keeps its pull request and commit message, from GitHub and GitLab", async () => {
  const id = await create(SIMPLE("Sources"));
  const hook = await pushTrigger(id, { pullRequests: true });

  const pushed = await hook("push", {
    ref: "refs/heads/main",
    after: "a".repeat(40),
    head_commit: { message: "Fix the login page\n\nLonger explanation." },
    commits: [{ id: "a".repeat(40), message: "Fix the login page", modified: ["x"] }],
  });
  assert.equal(pushed.statusCode, 201, pushed.body);

  const opened = await hook("pull_request", {
    action: "opened",
    pull_request: {
      number: 12,
      title: "Add a cart",
      html_url: "https://github.com/team/shop/pull/12",
      head: { sha: "b".repeat(40), ref: "feature/cart", repo: { full_name: "team/shop" } },
      base: { ref: "main", repo: { full_name: "team/shop" } },
    },
  });
  assert.equal(opened.statusCode, 201, opened.body);

  const gitlab = await server.app.inject({
    method: "POST",
    url: `/api/hooks/pipelines/${lastSecret.id}`,
    headers: {
      "content-type": "application/json",
      "x-gitlab-event": "Merge Request Hook",
      "x-gitlab-token": lastSecret.secret,
    },
    payload: {
      object_kind: "merge_request",
      object_attributes: {
        action: "open",
        iid: 7,
        title: "Speed up search",
        url: "https://gitlab.com/team/shop/-/merge_requests/7",
        source_branch: "feature/search",
        target_branch: "main",
        source_project_id: 3,
        target_project_id: 3,
        last_commit: { id: "c".repeat(40), message: "Cache the index" },
      },
    },
  });
  assert.equal(gitlab.statusCode, 201, gitlab.body);

  const list = (await call("GET", team(`/pipelines/${id}/runs`))).json().runs as RunInfo[];
  const [merge, pull, push] = list;
  assert.equal(push?.branch, "main");
  assert.equal(push?.commit, "a".repeat(40));
  assert.equal(push?.commitMessage, "Fix the login page", "the first line only");
  assert.equal(push?.pullRequest, null);
  assert.deepEqual(pull?.pullRequest, {
    number: 12,
    title: "Add a cart",
    url: "https://github.com/team/shop/pull/12",
    base: "main",
  });
  assert.equal(pull?.branch, "feature/cart");
  assert.deepEqual(merge?.pullRequest, {
    number: 7,
    title: "Speed up search",
    url: "https://gitlab.com/team/shop/-/merge_requests/7",
    base: "main",
  });
  assert.equal(merge?.commitMessage, "Cache the index");

  // Run again: the same branch, commit, message and pull request.
  await finished(pull?.id as string);
  const again = await call("POST", team(`/pipeline-runs/${pull?.id}/rerun`), {});
  assert.equal(again.statusCode, 201, again.body);
  const rerun = again.json().run as RunInfo;
  assert.equal(rerun.trigger, "rerun");
  assert.equal(rerun.branch, "feature/cart");
  assert.equal(rerun.commit, "b".repeat(40));
  assert.equal(rerun.pullRequest?.number, 12);
});

test("a pull request link is kept only when it is https", async () => {
  const id = await create(SIMPLE("Links"));
  const hook = await pushTrigger(id, { pullRequests: true });
  const opened = await hook("pull_request", {
    action: "opened",
    pull_request: {
      number: 3,
      title: "Odd link",
      html_url: "javascript:alert(1)",
      head: { sha: "e".repeat(40), ref: "x", repo: { full_name: "t/s" } },
      base: { ref: "main", repo: { full_name: "t/s" } },
    },
  });
  assert.equal(opened.statusCode, 201, opened.body);
  const [run] = (await call("GET", team(`/pipelines/${id}/runs`))).json().runs as RunInfo[];
  assert.equal(run?.pullRequest?.url, null);
});

test("favourites: a person stars a pipeline for themselves", async () => {
  const id = await create(SIMPLE("Starred"));
  const before = (await call("GET", team("/pipelines"))).json().pipelines;
  assert.equal(before.find((p: { id: string }) => p.id === id).favorite, false);
  assert.equal(
    (await call("PUT", team(`/pipelines/${id}/favorite`), { favorite: true })).statusCode,
    204,
  );
  const after = (await call("GET", team("/pipelines"))).json().pipelines;
  assert.equal(after.find((p: { id: string }) => p.id === id).favorite, true);
  assert.equal((await call("GET", team(`/pipelines/${id}`))).json().pipeline.favorite, true);

  // Someone else in another team cannot star it.
  const other = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "other@example.com", name: "Other", password: "correct-horse-battery" },
  });
  const cookie = `zelyq_session=${other.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  const refused = await server.app.inject({
    method: "PUT",
    url: team(`/pipelines/${id}/favorite`),
    headers: { cookie },
    payload: { favorite: true },
  });
  assert.ok([403, 404].includes(refused.statusCode), refused.body);

  await call("PUT", team(`/pipelines/${id}/favorite`), { favorite: false });
  const unstarred = (await call("GET", team("/pipelines"))).json().pipelines;
  assert.equal(unstarred.find((p: { id: string }) => p.id === id).favorite, false);
});
