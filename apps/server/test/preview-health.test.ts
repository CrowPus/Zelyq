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

/** Runs the watcher by hand: each call to `step` is one scheduled check. */
function manualWatcher(results: number[], memory: { said: string | null }) {
  let call = 0;
  const health = new PreviewHealth(
    () => "zelyq.app",
    probes({
      certificate: async () => days(results[Math.min(call, results.length - 1)] as number),
    }),
  );
  const said: string[] = [];
  const pending: Array<() => void> = [];
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  globalThis.setTimeout = ((fn: () => void) => {
    pending.push(fn);
    return { unref() {} } as never;
  }) as never;
  globalThis.setInterval = ((fn: () => void) => {
    pending.push(fn);
    return { unref() {} } as never;
  }) as never;
  const stop = watchPreviewHealth(
    health,
    {
      get: async () => memory.said,
      set: async (status) => {
        memory.said = status;
      },
    },
    ({ status }) => {
      said.push(status);
    },
  );
  const hourly = pending.pop() as () => void;
  const first = pending.pop() as () => void;
  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 10));
  return {
    said,
    async run(fn: () => void) {
      // Timers set while it runs (the five-minute confirmation) are collected.
      globalThis.setTimeout = ((f: () => void) => {
        pending.push(f);
        return { unref() {} } as never;
      }) as never;
      fn();
      await settle();
      call += 1;
      globalThis.setTimeout = realSetTimeout;
    },
    first,
    hourly,
    confirm: () => pending.shift() as () => void,
    stop() {
      stop();
      globalThis.setTimeout = realSetTimeout;
      globalThis.setInterval = realSetInterval;
    },
  };
}

test("the watcher confirms a bad result before saying it, and says recovery once", async () => {
  const memory = { said: null as string | null };
  const watch = manualWatcher([60, 15, 15, 15, 60], memory);
  await watch.run(watch.first); // 60 days: fine, nothing said
  await watch.run(watch.hourly); // 15 days: not yet, a check again in five minutes
  assert.deepEqual(watch.said, []);
  await watch.run(watch.confirm()); // still 15: now it is said
  assert.deepEqual(watch.said, ["slow"]);
  await watch.run(watch.hourly); // still 15: already said, nothing new
  await watch.run(watch.hourly); // 60 again: recovery, said once
  watch.stop();
  assert.deepEqual(watch.said, ["slow", "ok"]);
});

test("a hiccup that is gone five minutes later is never an email", async () => {
  const watch = manualWatcher([60, 3, 60], { said: "ok" });
  await watch.run(watch.first);
  await watch.run(watch.hourly); // 3 days: down, to be confirmed
  await watch.run(watch.confirm()); // fine again
  watch.stop();
  assert.deepEqual(watch.said, []);
});

test("after a restart, what was already said is not said again", async () => {
  // The database remembers "slow" from before the restart.
  const watch = manualWatcher([15, 15], { said: "slow" });
  await watch.run(watch.first);
  watch.stop();
  assert.deepEqual(watch.said, []);
});

test("a preview problem is shown in the server's health, never as the server being down", async () => {
  const { deepHealth } = await import("../src/services/observability.js");
  const health = new PreviewHealth(() => "zelyq.app", probes({ lookup: async () => [] }));
  await health.report(true);
  const report = await deepHealth({
    store: { dialect: "sqlite", users: { count: async () => 1 } } as never,
    dataDir: os.tmpdir(),
    runtime: async () => ({ ok: true }),
    agent: async () => ({ status: "ok" }),
    mailConfigured: async () => true,
    lastCleanup: async () => ({ at: new Date().toISOString() }),
    stats: { loopDelayMs: () => ({ p50: 1, p99: 2 }), startedAt: Date.now() } as never,
    previews: () => health.asHealthCheck(),
  });
  const previews = report.checks.find((check) => check.name === "previews");
  assert.equal(previews?.status, "down");
  assert.notEqual(report.status, "down");
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

test("the preview domain must be a plain domain, never the app's own, and never on its site", async () => {
  for (const bad of ["https://zelyq.app", "zelyq.app/x", "Zelyq.App", "zelyq", "*.zelyq.app"]) {
    const refused = await put({ previewDomain: bad });
    assert.equal(refused.statusCode, 400, bad);
  }
  const app = await put({ previewDomain: "zelyq.com" });
  assert.equal(app.statusCode, 400);
  assert.match(app.json().error.message, /cannot cover the app's own address \(app\.zelyq\.com\)/);
  // Beside the app under the same registered domain: previews could set its cookies.
  const sameSite = await put({ previewDomain: "previews.zelyq.com" });
  assert.equal(sameSite.statusCode, 400);
  assert.match(sameSite.json().error.message, /same site as the app/);
  // A public suffix is nobody's own domain.
  assert.equal((await put({ previewDomain: "co.uk" })).statusCode, 400);
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

  // Anything else under the preview domain is never the app.
  for (const host of ["login.zelyq.app", "zelyq.app", "www.zelyq.app"]) {
    const other = await onHost(host);
    assert.equal(other.statusCode, 404, host);
    assert.match(other.body, /This preview is not running/, host);
  }

  // Moving the app's address under the preview domain later is refused too.
  const moved = await put({ publicUrl: "https://app.zelyq.app" });
  assert.equal(moved.statusCode, 400);
  // And a refused change saves nothing of the batch.
  const batch = await put({ sessionTtlDays: 9, previewDomain: "previews.zelyq.com" });
  assert.equal(batch.statusCode, 400);
  const saved = await server.app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { cookie },
  });
  const ttl = saved
    .json()
    .groups.flatMap((group: { fields: Array<{ key: string; value: unknown }> }) => group.fields)
    .find((field: { key: string }) => field.key === "sessionTtlDays");
  assert.notEqual(String(ttl?.value), "9");

  assert.equal((await put({ previewDomain: null })).statusCode, 200);
  assert.doesNotMatch((await onHost("shop-abcdef.zelyq.app")).body, /This preview is not running/);
});
