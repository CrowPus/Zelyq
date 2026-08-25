import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-server-test-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "test.db")}`,
  agentUrl: "http://127.0.0.1:59999", // deliberately unreachable
  provider: "anthropic",
  model: "claude-opus-5",
  allowRegistration: true,
  sessionTtlDays: 30,
  effort: "high",
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4920, 4930],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
/** Every project route needs a session now; these tests sign in once. */
let cookie: string;
const as = () => ({ cookie });

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);

  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "api-test@example.com", name: "Api Test", password: "correct-horse-battery" },
  });
  const session = registered.cookies.find((c) => c.name === "zelyq_session");
  cookie = `zelyq_session=${session!.value}`;
});

after(async () => {
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("health degrades gracefully when the agent is unreachable", async () => {
  const response = await server.app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.runtime.ok, true);
  assert.equal(body.database.dialect, "sqlite");
});

test("templates are discovered from the templates directory", async () => {
  const response = await server.app.inject({
    method: "GET",
    url: "/api/templates",
    headers: as(),
  });
  assert.equal(response.statusCode, 200);
  const names = response.json().templates.map((template: { name: string }) => template.name);
  assert.ok(names.includes("vite-react"), `expected vite-react in ${names.join(", ")}`);
});

test("creating a project scaffolds real files on disk", async () => {
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: as(),
    payload: { name: "Test App", template: "vite-react" },
  });
  assert.equal(created.statusCode, 201);

  const project = created.json().project;
  assert.equal(project.status, "ready");
  assert.equal(project.slug, "test-app");

  const files = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/files`,
    headers: as(),
  });
  const paths = files.json().entries.map((entry: { path: string }) => entry.path);
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("src/App.tsx"));

  const read = await server.app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/files/package.json`,
    headers: as(),
  });
  assert.match(read.json().content, /"name": "test-app"/);
});

test("file writes are confined to the project", async () => {
  const created = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: as(),
    payload: { name: "Jail Test", template: "vite-react" },
  });
  const projectId = created.json().project.id;

  // A plain `../` never reaches a handler: the HTTP layer normalises the path
  // and routing simply does not match.
  const normalised = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/files/../../escaped.txt`,
    headers: as(),
    payload: { content: "nope" },
  });
  assert.equal(normalised.statusCode, 404);

  // Percent-encoded traversal does survive routing and arrives at the handler
  // as `../../escaped.txt`. This is the case the runtime's path jail exists for.
  const encoded = await server.app.inject({
    method: "PUT",
    url: `/api/projects/${projectId}/files/..%2F..%2Fescaped.txt`,
    headers: as(),
    payload: { content: "nope" },
  });
  assert.equal(encoded.statusCode, 400);
  assert.equal(encoded.json().error.code, "bad_request");

  const absolute = await server.app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/files/%2Fetc%2Fpasswd`,
    headers: as(),
  });
  assert.equal(absolute.statusCode, 400);
});

test("unknown projects and routes return structured errors", async () => {
  const missing = await server.app.inject({
    method: "GET",
    url: "/api/projects/prj_nope",
    headers: as(),
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "not_found");

  const badRoute = await server.app.inject({ method: "GET", url: "/api/nope", headers: as() });
  assert.equal(badRoute.statusCode, 404);
  assert.equal(badRoute.json().error.code, "not_found");
});

test("static assets keep their own content, and unknown routes get the SPA", async () => {
  // A hashed asset created after boot must still be served as itself. When the
  // static handler enumerates files at startup instead of resolving per
  // request, every rebuild silently serves index.html as JavaScript and the app
  // renders blank.
  const webDir = path.join(tmp, "webdir");
  await fs.mkdir(path.join(webDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(webDir, "index.html"), "<!doctype html><title>shell</title>");

  const spa = await buildServer({ ...config, webDir });
  try {
    await fs.writeFile(path.join(webDir, "assets", "app-after-boot.js"), "export const x = 1;\n");

    const asset = await spa.app.inject({ method: "GET", url: "/assets/app-after-boot.js" });
    assert.equal(asset.statusCode, 200);
    assert.match(asset.body, /export const x = 1/);
    assert.ok(!asset.body.includes("<!doctype html>"), "asset was served as the HTML shell");

    const route = await spa.app.inject({
      method: "GET",
      url: "/projects/prj_anything",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    assert.equal(route.statusCode, 200);
    assert.match(route.body, /<title>shell<\/title>/);

    // A missing asset must fail loudly. Serving the shell instead turns a
    // broken reference into a 200 that nothing ever reports.
    const missingAsset = await spa.app.inject({
      method: "GET",
      url: "/assets/deleted.png",
      headers: { accept: "image/png,*/*" },
    });
    assert.equal(missingAsset.statusCode, 404);

    const missingAssetFromBrowser = await spa.app.inject({
      method: "GET",
      url: "/zelyq-logo.png",
      headers: { accept: "text/html,image/png,*/*" },
    });
    assert.equal(missingAssetFromBrowser.statusCode, 404, "extension means asset, not navigation");

    const missingApi = await spa.app.inject({ method: "GET", url: "/api/nope" });
    assert.equal(missingApi.statusCode, 404);
    assert.equal(missingApi.json().error.code, "not_found");
  } finally {
    await spa.close();
  }
});

test("validation failures explain which field was wrong", async () => {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/projects",
    headers: as(),
    payload: { name: "" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "bad_request");
});
