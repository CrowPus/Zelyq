import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Route } from "playwright";
import {
  answer,
  browserDockerfile,
  browserSandboxed,
  configureBrowserSandbox,
} from "../src/browser-sandbox.js";

/**
 * The sandboxed browser's one rule: a page's request is answered here only
 * when allowed — its own preview, or a public address — and refused
 * otherwise. No container is needed to check that.
 */

let preview: http.Server;
let origin: string;

before(async () => {
  preview = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      response.setHeader("content-type", "text/plain");
      response.setHeader("x-seen", `${request.method} ${request.url} ${body}`);
      response.end("from the preview");
    });
  });
  await new Promise<void>((resolve) => preview.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(preview.address() as AddressInfo).port}`;
});

after(() => {
  preview.close();
  configureBrowserSandbox({ strict: false, dns: [] });
});

function fakeRoute(url: string, method = "GET", postData: string | null = null) {
  const calls: { kind: string; value?: unknown }[] = [];
  const route = {
    request: () => ({
      url: () => url,
      method: () => method,
      headers: () => ({ accept: "*/*", cookie: "must-not-leave", host: "x" }),
      postDataBuffer: () => (postData === null ? null : Buffer.from(postData)),
    }),
    fulfill: async (value: unknown) => {
      calls.push({ kind: "fulfill", value });
    },
    abort: async (value?: unknown) => {
      calls.push({ kind: "abort", value });
    },
    fallback: async () => {
      calls.push({ kind: "fallback" });
    },
  } as unknown as Route;
  return { route, calls };
}

test("the team's own preview is fetched for the page, with its method and body", async () => {
  const { route, calls } = fakeRoute(`${origin}/api/save`, "POST", "name=Ada");
  await answer(route, origin);
  assert.equal(calls[0]?.kind, "fulfill");
  const fulfilled = calls[0]?.value as {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  };
  assert.equal(fulfilled.status, 200);
  assert.equal(fulfilled.body.toString(), "from the preview");
  assert.equal(fulfilled.headers["x-seen"], "POST /api/save name=Ada");
  assert.equal(fulfilled.headers["content-length"], undefined);
});

test("this server, another port, a private network and metadata are refused", async () => {
  for (const url of [
    "http://127.0.0.1:8081/api/health",
    `http://127.0.0.1:${Number(new URL(origin).port) + 1}/`,
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/computeMetadata/v1/",
    "http://[::1]:8081/",
    "http://localhost:8081/",
  ]) {
    const { route, calls } = fakeRoute(url);
    await answer(route, origin);
    assert.deepEqual(calls, [{ kind: "abort", value: "blockedbyclient" }], url);
  }
});

test("data: and blob: stay in the browser", async () => {
  const { route, calls } = fakeRoute("data:text/plain,hi");
  await answer(route, origin);
  assert.deepEqual(calls, [{ kind: "fallback" }]);
});

test("off by default, on only for a strict sandbox", () => {
  configureBrowserSandbox({ strict: false, dns: [] });
  assert.equal(browserSandboxed(), false);
  configureBrowserSandbox({ strict: true, runtime: "runsc", dns: ["1.1.1.1"] });
  assert.equal(browserSandboxed(), true);
  configureBrowserSandbox({ strict: false, dns: [] });
  assert.equal(browserSandboxed(), false);
});

test("the browser image speaks this client's exact Playwright version", () => {
  const file = browserDockerfile("1.62.1");
  assert.match(file, /playwright-core@1\.62\.1 playwright@1\.62\.1/);
  assert.match(file, /install --with-deps chromium/);
  assert.match(file, /^USER node$/m);
});

test("a screenshot path can never leave the team's own preview", async () => {
  const { previewTarget } = await import("../src/preview.js");
  const preview = "http://127.0.0.1:4301/";
  assert.equal(previewTarget(preview, undefined), preview);
  assert.equal(previewTarget(preview, "/about?x=1"), "http://127.0.0.1:4301/about?x=1");
  assert.equal(previewTarget(preview, "http://127.0.0.1:4301/a"), "http://127.0.0.1:4301/a");
  for (const path of [
    "http://127.0.0.1:8081/api/health",
    "//127.0.0.1:4976/",
    "\\\\127.0.0.1:4976/",
    "https://127.0.0.1:4301/",
    "http://localhost:4301/",
    "http://169.254.169.254/",
    "javascript:alert(1)",
    "file:///etc/passwd",
  ]) {
    assert.equal(previewTarget(preview, path), null, path);
  }
});

test("a page cannot hold more than its share of requests", async () => {
  const budget = { inFlight: 24, bytes: 0 };
  const { route, calls } = fakeRoute(`${origin}/x`);
  await answer(route, origin, budget);
  assert.deepEqual(calls, [{ kind: "abort", value: "blockedbyclient" }]);
  const full = { inFlight: 0, bytes: 256 * 1024 * 1024 };
  const second = fakeRoute(`${origin}/y`);
  await answer(second.route, origin, full);
  assert.deepEqual(second.calls, [{ kind: "abort", value: "blockedbyclient" }]);
});
