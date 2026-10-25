import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { GUIDE_FILE_NAME, GUIDE_PDF_URL } from "@zelyq/core";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/**
 * The Docs page's Download button. The PDF lives on another site, where a
 * browser would open it rather than save it, so the server passes it through
 * with an attachment header. The published copy is never fetched here: the
 * request to it is answered in-process, so this runs offline.
 */

const tmp = path.join(os.tmpdir(), `zelyq-guide-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const PDF = Buffer.from("%PDF-1.7\nthe guide\n%%EOF\n");

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "guide.db")}`,
  agentUrl: "http://127.0.0.1:9",
  provider: "google",
  model: "gemini-3.7-flash",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: randomBytes(32).toString("base64"),
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  codexCredentialsPath: path.join(tmp, "codex-auth.json"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4978, 4979],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let cookie: string;
let published: "ok" | "missing" = "ok";
const realFetch = globalThis.fetch;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  globalThis.fetch = (async (url, init) => {
    if (String(url) !== GUIDE_PDF_URL) return realFetch(url, init);
    return published === "ok"
      ? new Response(PDF, {
          headers: { "content-type": "application/pdf", "content-length": String(PDF.length) },
        })
      : new Response("gone", { status: 404 });
  }) as typeof fetch;

  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")!.value}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await server.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("the guide downloads as a file, not a page", async () => {
  published = "ok";
  const response = await server.app.inject({
    method: "GET",
    url: "/api/guide/download",
    headers: { cookie },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/pdf");
  assert.equal(
    response.headers["content-disposition"],
    `attachment; filename="${GUIDE_FILE_NAME}"`,
  );
  assert.deepEqual(response.rawPayload, PDF);
});

test("only signed-in people can download it through this server", async () => {
  const response = await server.app.inject({ method: "GET", url: "/api/guide/download" });
  assert.equal(response.statusCode, 401);
});

test("a guide that cannot be fetched says so, rather than saving an error as a PDF", async () => {
  published = "missing";
  const response = await server.app.inject({
    method: "GET",
    url: "/api/guide/download",
    headers: { cookie },
  });
  assert.equal(response.statusCode, 500);
  assert.match(response.body, /could not be fetched/);
});
