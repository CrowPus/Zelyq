import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import {
  type CertificateFacts,
  PreviewHealth,
  type PreviewHealthProbes,
  watchPreviewHealth,
} from "../src/services/preview-health.js";

/**
 * Named previews' own health, and the preview domain as a setting the admin
 * portal changes: checked from outside, applied at once.
 */

const days = (n: number): CertificateFacts => ({
  validTo: new Date(Date.now() + n * 86_400_000 + 3_600_000).toISOString(),
  daysLeft: n,
  issuer: "Let's Encrypt",
  coversName: true,
  trusted: true,
});

function probes(overrides: Partial<PreviewHealthProbes> = {}): PreviewHealthProbes {
  return {
    lookup: async () => ["136.112.104.233"],
    certificate: async () => days(60),
    routerPage: async () => ({ status: 404, body: "<h1>This preview is not running</h1>" }),
    ...overrides,
  };
}

test("all well: the name resolves, the certificate has time left, the router answers", async () => {
  const report = await new PreviewHealth(() => "zelyq.app", probes()).report();
  assert.equal(report.status, "ok");
  assert.match(report.detail, /\*\.zelyq\.app: certificate 60 days left, router answering/);
  assert.equal(report.name, "zelyq-health-zzzzzz.zelyq.app");
});

test("no preview domain: off, and nothing is looked up", async () => {
  let looked = false;
  const report = await new PreviewHealth(
    () => null,
    probes({
      lookup: async () => {
        looked = true;
        return [];
      },
    }),
  ).report();
  assert.equal(report.status, "off");
  assert.equal(looked, false);
});

test("a certificate under three weeks warns; under one week, or untrusted, is down", async () => {
  const warn = await new PreviewHealth(
    () => "zelyq.app",
    probes({ certificate: async () => days(15) }),
  ).report();
  assert.equal(warn.status, "slow");
  assert.match(warn.detail, /runs out in 15 days/);

  const down = await new PreviewHealth(
    () => "zelyq.app",
    probes({ certificate: async () => days(3) }),
  ).report();
  assert.equal(down.status, "down");

  const untrusted = await new PreviewHealth(
    () => "zelyq.app",
    probes({ certificate: async () => ({ ...days(80), trusted: false }) }),
  ).report();
  assert.equal(untrusted.status, "down");
  assert.match(untrusted.detail, /not trusted/);
});

test("behind Cloudflare, the certificate on this server is judged too", async () => {
  const report = await new PreviewHealth(
    () => "zelyq.app",
    probes({
      // Cloudflare's certificate is fine; the server's own is about to run out.
      certificate: async (host) => (host === "127.0.0.1" ? days(5) : days(80)),
    }),
  ).report();
  assert.equal(report.status, "down");
  assert.match(report.detail, /the server certificate runs out in 5 days/);
});

test("a name that does not resolve, or a router that does not answer, is down", async () => {
  const noDns = await new PreviewHealth(
    () => "zelyq.app",
    probes({ lookup: async () => [] }),
  ).report();
  assert.equal(noDns.status, "down");
  assert.match(noDns.detail, /does not resolve/);

  const noRouter = await new PreviewHealth(
    () => "zelyq.app",
    probes({ routerPage: async () => ({ status: 502, body: "Bad gateway" }) }),
  ).report();
  assert.equal(noRouter.status, "down");
  assert.match(noRouter.detail, /did not answer \(got 502\)/);
});

test("the watcher speaks on a change for the worse and on recovery, never every hour", async () => {
  const days_ = [60, 60, 15, 15, 60, 60];
  let call = 0;
  const health = new PreviewHealth(
    () => "zelyq.app",
    probes({ certificate: async () => days(days_[Math.min(call, days_.length - 1)] as number) }),
  );
  const said: string[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  let tick: (() => void) | null = null;
  // Run the watcher by hand rather than waiting an hour.
  globalThis.setTimeout = ((fn: () => void) => {
    tick = fn;
    return { unref() {} } as never;
  }) as never;
  globalThis.setInterval = ((fn: () => void) => {
    tick = fn;
    return { unref() {} } as never;
  }) as never;
  const stop = watchPreviewHealth(health, ({ status }) => {
    said.push(status);
  });
  globalThis.setTimeout = realSetTimeout;
  globalThis.setInterval = realSetInterval;
  for (call = 0; call < days_.length; call++) {
    (tick as unknown as () => void)();
    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }
  stop();
  assert.deepEqual(said, ["slow", "ok"]);
});

// ------------------------------------------------------------ the setting

const tmp = path.join(os.tmpdir(), `zelyq-preview-domain-${Date.now()}`);
let server: ZelyqServer;
let cookie: string;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    isProduction: true,
    corsOrigin: ["*"],
    databaseUrl: `file:${path.join(tmp, "z.db")}`,
    agentUrl: "http://127.0.0.1:59999",
    provider: "anthropic",
    model: "claude-opus-5",
    effort: "high",
    allowRegistration: true,
    sessionTtlDays: 30,
    templatesDir: path.join(import.meta.dirname, "..", "..", "..", "templates"),
    webDir: null,
    secretKey: undefined,
    secretKeyFile: path.join(tmp, "secret.key"),
    attachmentsDir: path.join(tmp, "attachments"),
    uploadedSkillsDir: path.join(tmp, "skills"),
    pipelinesDir: path.join(tmp, "pipelines"),
    publicUrl: "https://app.zelyq.com",
    runtime: {
      kind: "local",
      workspaceDir: path.join(tmp, "workspace"),
      execTimeoutMs: 30_000,
      previewPortRange: [4980, 4983],
      previewHost: "127.0.0.1",
    },
  };
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

const put = (payload: Record<string, unknown>) =>
  server.app.inject({ method: "PUT", url: "/api/settings", headers: { cookie }, payload });
const onHost = (host: string) => server.app.inject({ method: "GET", url: "/", headers: { host } });

test("the preview domain must be a plain domain, and never the app's own", async () => {
  for (const bad of ["https://zelyq.app", "zelyq.app/x", "Zelyq.App", "zelyq", "*.zelyq.app"]) {
    const refused = await put({ previewDomain: bad });
    assert.equal(refused.statusCode, 400, bad);
  }
  const app = await put({ previewDomain: "zelyq.com" });
  assert.equal(app.statusCode, 400);
  assert.match(app.json().error.message, /cannot cover the app's own address \(app\.zelyq\.com\)/);
});

test("setting the preview domain applies at once, and clearing it turns previews off", async () => {
  // Before: a preview name is not one of ours, so it is not answered as a preview.
  assert.doesNotMatch((await onHost("shop-abcdef.zelyq.app")).body, /This preview is not running/);

  assert.equal((await put({ previewDomain: "zelyq.app" })).statusCode, 200);
  const named = await onHost("shop-abcdef.zelyq.app");
  assert.equal(named.statusCode, 404);
  assert.match(named.body, /This preview is not running/);
  // The app's own address is never a preview.
  assert.doesNotMatch((await onHost("app.zelyq.com")).body, /This preview is not running/);

  assert.equal((await put({ previewDomain: null })).statusCode, 200);
  assert.doesNotMatch((await onHost("shop-abcdef.zelyq.app")).body, /This preview is not running/);
});
