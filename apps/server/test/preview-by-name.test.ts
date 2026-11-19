import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { previewHostLabel } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { WebSocket, WebSocketServer } from "ws";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * Previews reached by name instead of by port.
 *
 * `shop-a1b2c3.example.com` has to end up at whichever port that project's
 * dev server is on, carry a Host the dev server will accept, and pass the
 * live-reload socket through — a preview that loads once and then never
 * updates is worse than one that plainly does not work.
 */

const tmp = path.join(os.tmpdir(), `zelyq-preview-name-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PASSWORD = "correct-horse-battery";
const DOMAIN = "previews.test";

let server: ZelyqServer;
let cookie: string;
let project: { id: string; slug: string };
let devServer: http.Server;
let devPort: number;
/** What the fake dev server was told the Host was, for the header assertion. */
let lastHost: string | undefined;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });

  // A dev server that behaves like Vite: it serves a page, and it has a
  // live-reload socket.
  devServer = http.createServer((request, response) => {
    lastHost = request.headers.host;
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<h1>the project</h1><p>host=${request.headers.host}</p>`);
  });
  const hmr = new WebSocketServer({
    server: devServer,
    // Like Vite: the handshake is completed only for its own subprotocol.
    handleProtocols: (protocols) => (protocols.has("vite-hmr") ? "vite-hmr" : false),
  });
  hmr.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data}`));
    socket.send("hello from the dev server");
  });
  await new Promise<void>((resolve) => devServer.listen(0, "127.0.0.1", resolve));
  devPort = (devServer.address() as AddressInfo).port;

  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "preview.db")}`,
    agentUrl: "http://127.0.0.1:59993",
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
      previewPortRange: [4921, 4924],
      previewHost: "127.0.0.1",
      previewUrlTemplate: `https://{name}.${DOMAIN}`,
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  await server.app.listen({ host: "127.0.0.1", port: 0 });

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

  // Stand in for a started preview, in both places it is looked for. The
  // editor's status call asks the runtime, so stub that; the proxy reads
  // the record the runtime writes when a dev server starts — not a status
  // call, which runs a command in the container per request and is exactly
  // the cost the proxy now avoids — so write one too.
  server.runtime.previewStatus = async (projectId: string) => ({
    projectId,
    status: "running" as const,
    url: `http://127.0.0.1:${devPort}`,
    port: devPort,
    pid: 1,
    startedAt: new Date().toISOString(),
    lastError: null,
  });
  const records = path.join(tmp, "workspace", ".zelyq-previews");
  await fs.mkdir(records, { recursive: true });
  await fs.writeFile(
    path.join(records, `${project.id}.json`),
    JSON.stringify({ pid: 1, port: devPort, startedAt: new Date().toISOString(), ownerPid: 1 }),
  );
});

after(async () => {
  await server.close();
  await new Promise<void>((resolve) => devServer.close(() => resolve()));
  await fs.rm(tmp, { recursive: true, force: true });
});

test("the app shows the project's own address, not a port", async () => {
  const response = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/preview`,
    headers: { cookie },
  });

  const url = response.json().preview.url as string;
  assert.equal(url, `https://${previewHostLabel(project)}.${DOMAIN}`);
  assert.match(url, /^https:\/\/shop-[a-z0-9]{6}\./, "readable name, unguessable tail");
  // The tail is six hex characters and can legitimately contain digits, so
  // the check is for the actual port number, not for "any four digits".
  assert.ok(!url.includes(String(devPort)), "no port in the address");
});

test("a request on that address reaches the project's dev server, quickly", async () => {
  const started = Date.now();
  const response = await server.app.inject({
    method: "GET",
    url: "/",
    headers: { host: `${previewHostLabel(project)}.${DOMAIN}` },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /the project/);
  // Dev servers refuse a Host they do not know, so the upstream one must be
  // loopback while the real name travels on X-Forwarded-Host.
  assert.equal(lastHost, `127.0.0.1:${devPort}`);
  // A page is dozens of requests; each one has to be cheap, not a container
  // probe. Generous bound — the point is "milliseconds, not seconds".
  assert.ok(Date.now() - started < 1_000, "resolving a preview must not take seconds");
});

test("a renamed project keeps answering on the address people already have", async () => {
  // Only the tail identifies the project, so the readable half can be
  // anything — including what it used to be.
  const response = await server.app.inject({
    method: "GET",
    url: "/",
    headers: { host: `something-else-${project.id.slice(-6)}.${DOMAIN}` },
  });
  assert.equal(response.statusCode, 200);
});

test("an address for a project that does not exist says so in words", async () => {
  const response = await server.app.inject({
    method: "GET",
    url: "/",
    headers: { host: `ghost-abcdef.${DOMAIN}` },
  });

  assert.equal(response.statusCode, 404);
  assert.match(response.body, /not running/i);
  assert.match(response.body, /start its preview/i);
});

test("the live-reload socket is proxied, both ways, with its subprotocol", async () => {
  const address = server.app.server.address() as AddressInfo;
  // Vite's client asks for `vite-hmr`; the proxy has to carry that to the
  // dev server as a real subprotocol and echo the chosen one back. Passing
  // it as a plain header closed every socket on open — 159 page reloads in
  // fifteen seconds, measured on the trial.
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/?token=abc`, ["vite-hmr"], {
    headers: { host: `${previewHostLabel(project)}.${DOMAIN}` },
  });
  // Collected from the start: the dev server speaks the moment the socket
  // opens, and a listener attached afterwards would miss it.
  const received: string[] = [];
  const waiters: Array<(message: string) => void> = [];
  client.on("message", (data) => {
    const text = data.toString();
    const waiter = waiters.shift();
    if (waiter) waiter(text);
    else received.push(text);
  });
  const next = () =>
    new Promise<string>((resolve, reject) => {
      const queued = received.shift();
      if (queued !== undefined) return resolve(queued);
      waiters.push(resolve);
      setTimeout(() => reject(new Error("no message from the dev server")), 10_000).unref();
    });

  const opened = await new Promise<string>((resolve, reject) => {
    client.once("open", () => resolve(client.protocol));
    client.once("error", reject);
    setTimeout(() => reject(new Error("socket never opened")), 10_000).unref();
  });
  assert.equal(opened, "vite-hmr", "the negotiated subprotocol reaches the visitor");

  assert.equal(await next(), "hello from the dev server");
  client.send("ping");
  assert.equal(await next(), "echo:ping");
  client.close();
});

test("Zelyq's own address is untouched by any of this", async () => {
  const response = await server.app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: `zelyq.${DOMAIN}` },
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /zelyq-server/);
});

test("a record whose dev server has gone shows the not-running page, not an error", async () => {
  // A record pointing at a port nobody listens on: what is left behind when
  // a dev server dies, or is stopped, without its record being cleared.
  const ghost = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { cookie },
    payload: { name: "Ghost", template: "vite-react" },
  });
  const ghostProject = ghost.json().project as { id: string; slug: string };
  await fs.writeFile(
    path.join(tmp, "workspace", ".zelyq-previews", `${ghostProject.id}.json`),
    JSON.stringify({ pid: 1, port: 1, startedAt: new Date().toISOString(), ownerPid: 1 }),
  );

  const response = await server.app.inject({
    method: "GET",
    url: "/",
    headers: { host: `${previewHostLabel(ghostProject)}.${DOMAIN}` },
  });

  assert.equal(response.statusCode, 404);
  assert.match(response.body, /not running/i);
  assert.doesNotMatch(response.body, /ECONNREFUSED/);
});
