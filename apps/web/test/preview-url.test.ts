import assert from "node:assert/strict";
import { test } from "node:test";
import type { Preview } from "@zelyq/core";
import { resolvePreviewUrl } from "../src/lib/preview-url.js";

function running(overrides: Partial<Preview> = {}): Preview {
  return {
    projectId: "prj_1",
    status: "running",
    url: "http://127.0.0.1:4300",
    port: 4300,
    pid: 123,
    startedAt: "2026-08-24T00:00:00.000Z",
    lastError: null,
    ...overrides,
  };
}

test("follows the browser's own address, not the server's guess", () => {
  // The bug this guards: ZELYQ_PREVIEW_HOST defaults to loopback, and the
  // server bakes it into `url` regardless of where the browser actually is.
  const preview = running({ url: "http://127.0.0.1:4300" });
  assert.equal(resolvePreviewUrl(preview, "136.112.104.233"), "http://136.112.104.233:4300");
});

test("matches when the browser and the server agree", () => {
  const preview = running({ url: "http://127.0.0.1:4300" });
  assert.equal(resolvePreviewUrl(preview, "127.0.0.1"), "http://127.0.0.1:4300");
});

test("falls back to the server's url when no port is available", () => {
  const preview = running({ port: null, url: "http://example.internal:4300" });
  assert.equal(resolvePreviewUrl(preview, "136.112.104.233"), "http://example.internal:4300");
});

test("is null while not running, regardless of a stale url or port", () => {
  const preview = running({ status: "starting", url: null });
  assert.equal(resolvePreviewUrl(preview, "136.112.104.233"), null);
});

test("is null for no preview at all", () => {
  assert.equal(resolvePreviewUrl(null, "136.112.104.233"), null);
});
