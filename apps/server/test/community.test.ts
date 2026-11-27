import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { CommunityStars } from "../src/services/community.js";

/** Zelyq on GitHub: the star button's count, asked of GitHub by the server, at most hourly. */

test("the count is asked once an hour; a failure keeps the last number, or none", async () => {
  let now = 0;
  let calls = 0;
  let answer: () => Response = () => Response.json({ stargazers_count: 42 });
  const fake = (async () => {
    calls += 1;
    return answer();
  }) as unknown as typeof fetch;
  const stars = new CommunityStars(fake, "https://api.github.test/repos/x", () => now);
  assert.equal(await stars.stars(), 42);
  assert.equal(await stars.stars(), 42);
  assert.equal(calls, 1, "cached");
  now += 61 * 60_000;
  answer = () => new Response("rate limited", { status: 403 });
  assert.equal(await stars.stars(), 42, "the last known number");
  assert.equal(calls, 2);
  const offline = new CommunityStars((async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch);
  assert.equal(await offline.stars(), null);
});

const tmp = path.join(os.tmpdir(), `zelyq-community-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "community.db")}`,
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
    previewPortRange: [4986, 4989],
    previewHost: "127.0.0.1",
  },
};
let server: ZelyqServer;
let cookie = "";
const realFetch = globalThis.fetch;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  // GitHub, as far as this test sees it.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("https://api.github.com/")
      ? Response.json({ stargazers_count: 1234 })
      : realFetch(input, init)) as typeof fetch;
  server = await buildServer(config);
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("signed in: the button is shown with the count and the repository; signed out: nothing", async () => {
  assert.equal((await server.app.inject({ method: "GET", url: "/api/community" })).statusCode, 401);
  const shown = await server.app.inject({
    method: "GET",
    url: "/api/community",
    headers: { cookie },
  });
  assert.deepEqual(shown.json(), {
    showStar: true,
    stars: 1234,
    url: "https://github.com/CrowPus/Zelyq",
  });
});

test("an instance can turn the star button off", async () => {
  const off = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie },
    payload: { showGitHubStar: "false" },
  });
  assert.equal(off.statusCode, 200, off.body);
  const hidden = await server.app.inject({
    method: "GET",
    url: "/api/community",
    headers: { cookie },
  });
  assert.deepEqual(hidden.json(), {
    showStar: false,
    stars: null,
    url: "https://github.com/CrowPus/Zelyq",
  });
});
