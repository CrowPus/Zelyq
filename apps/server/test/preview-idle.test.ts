import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { previewHostLabel } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Previews nobody uses stop ("Stop previews nobody uses after"), and wake when
 * someone opens their address again — but only those stopped for that, and
 * never on a dev server's own reconnect pings.
 */

const tmp = path.join(os.tmpdir(), `zelyq-preview-idle-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct-horse-battery";
const DOMAIN = "previews.test";
const MINUTE = 60_000;

let server: ZelyqServer;
let cookie: string;
let project: { id: string; slug: string };
let devServer: http.Server;
let devPort: number;
let host: string;
const records = path.join(tmp, "workspace", ".zelyq-previews");
let starts = 0;
let stops = 0;

async function writeRecord(startedAt = new Date().toISOString()) {
  await fs.mkdir(records, { recursive: true });
  await fs.writeFile(
    path.join(records, `${project.id}.json`),
    JSON.stringify({ pid: 1, port: devPort, startedAt, ownerPid: 1 }),
  );
}
const recordExists = () =>
  fs.access(path.join(records, `${project.id}.json`)).then(
    () => true,
    () => false,
  );

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  devServer = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<h1>the project</h1>");
  });
  await new Promise<void>((resolve) => devServer.listen(0, "127.0.0.1", resolve));
  devPort = (devServer.address() as AddressInfo).port;

  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "idle.db")}`,
    agentUrl: "http://127.0.0.1:59992",
    provider: "anthropic",
    model: "claude-opus-5",
    effort: "high",
    allowRegistration: true,
    sessionTtlDays: 30,
    templatesDir: path.join(repoRoot, "templates"),
    webDir: null,
    secretKey: randomBytes(32).toString("base64"),
    secretKeyFile: path.join(tmp, "secret.key"),
    attachmentsDir: path.join(tmp, "attachments"),
    uploadedSkillsDir: path.join(tmp, "skills"),
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4925, 4928],
      previewHost: "127.0.0.1",
      previewUrlTemplate: `https://{name}.${DOMAIN}`,
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: PASSWORD },
  });
  cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "Shop", template: "vite-react" },
  });
  assert.equal(created.statusCode, 201, created.body);
  project = created.json().project;
  host = `${previewHostLabel(project)}.${DOMAIN}`;

  // The runtime, stood in for: a preview is its record on disk, as the proxy reads it.
  const running = (projectId: string) => ({
    projectId,
    status: "running" as const,
    url: `http://127.0.0.1:${devPort}`,
    port: devPort,
    pid: 1,
    startedAt: new Date().toISOString(),
    lastError: null,
  });
  server.runtime.stopPreview = async (projectId: string) => {
    stops++;
    await fs.rm(path.join(records, `${projectId}.json`), { force: true });
    return { ...running(projectId), status: "stopped" as const, url: null, port: null, pid: null };
  };
  server.runtime.startPreview = async (projectId: string) => {
    starts++;
    await writeRecord();
    return running(projectId);
  };
  server.runtime.previewStatus = async (projectId: string) =>
    (await recordExists())
      ? running(projectId)
      : { ...running(projectId), status: "stopped" as const, url: null, port: null, pid: null };

  const set = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie },
    payload: { previewIdleMinutes: 20 },
  });
  assert.equal(set.statusCode, 200, set.body);
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => devServer.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  starts = 0;
  stops = 0;
  await server.previewIdle.forget(project.id);
  await writeRecord(new Date(Date.now() - 60 * MINUTE).toISOString());
});

const visit = (headers: Record<string, string> = {}) =>
  server.app.inject({
    method: "GET",
    url: "/",
    headers: { host, "sec-fetch-mode": "navigate", accept: "text/html", ...headers },
  });

test("a preview nobody used for the set minutes is stopped; one in use is not", async () => {
  // Just used: kept, even at 19 minutes.
  assert.equal((await visit()).statusCode, 200);
  assert.deepEqual(await server.previewIdle.sweep(Date.now() + 19 * MINUTE), []);
  assert.equal(stops, 0);
  // At 21 minutes with nothing since: stopped.
  assert.deepEqual(await server.previewIdle.sweep(Date.now() + 21 * MINUTE), [project.id]);
  assert.equal(stops, 1);
  assert.equal(await recordExists(), false);
});

test("a chat or editor use counts, and 0 turns the stopping off", async () => {
  server.usage.touch(project.id);
  assert.deepEqual(await server.previewIdle.sweep(Date.now() + 19 * MINUTE), []);
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie },
    payload: { previewIdleMinutes: 0 },
  });
  assert.deepEqual(await server.previewIdle.sweep(Date.now() + 999 * MINUTE), []);
  await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie },
    payload: { previewIdleMinutes: 20 },
  });
});

test("opening a preview stopped for being unused starts it again, and says so meanwhile", async () => {
  await server.previewIdle.sweep(Date.now() + 61 * MINUTE);
  assert.equal(await recordExists(), false);

  // The dev server's own reconnect ping does not wake it.
  const ping = await server.app.inject({
    method: "GET",
    url: "/",
    headers: { host, accept: "text/x-vite-ping", "sec-fetch-mode": "cors" },
  });
  assert.equal(ping.statusCode, 404);
  assert.equal(starts, 0);

  // A person opening the page does.
  const opened = await visit();
  assert.equal(opened.statusCode, 503);
  assert.match(opened.body, /Starting this app/);
  assert.match(opened.body, /http-equiv="refresh"/);
  await server.previewIdle.wakeInProgress(project.id);
  assert.equal(starts, 1);

  // The page's own reload then reaches the app.
  const reloaded = await visit();
  assert.equal(reloaded.statusCode, 200);
  assert.match(reloaded.body, /the project/);
});

test("a preview its person stopped stays stopped when its address is opened", async () => {
  const stopped = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/preview/stop`,
    headers: { cookie },
  });
  assert.equal(stopped.statusCode, 200, stopped.body);
  const opened = await visit();
  assert.equal(opened.statusCode, 404);
  assert.match(opened.body, /not running/);
  assert.equal(starts, 0);
});

test("stopped for being unused, then started by hand: no longer woken by a visit", async () => {
  await server.previewIdle.sweep(Date.now() + 61 * MINUTE);
  assert.equal(await server.previewIdle.stoppedForIdle(project.id), true);
  const started = await server.app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/preview/start`,
    headers: { cookie },
  });
  assert.equal(started.statusCode, 200, started.body);
  assert.equal(await server.previewIdle.stoppedForIdle(project.id), false);
});
