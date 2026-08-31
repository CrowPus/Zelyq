import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __clearResolveCache,
  assertAllowedUrl,
  CaptureBlockedError,
  guardedFetch,
  isBlockedAddress,
  resolveAndAssertHost,
} from "../src/capture-fetch-guard.ts";

// ---------------------------------------------------------------------------
// isBlockedAddress — the SSRF address table
// ---------------------------------------------------------------------------

test("blocks loopback, private, link-local, CGNAT, multicast and reserved v4", () => {
  for (const ip of [
    "127.0.0.1",
    "127.9.9.9",
    "10.0.0.5",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "100.64.0.1", // carrier-grade NAT
    "0.0.0.0",
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
    "255.255.255.255",
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test("allows ordinary public v4", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "140.82.112.3"]) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test("blocks loopback / ULA / link-local v6 and IPv4-mapped private forms", () => {
  for (const ip of [
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1", // NAT64 wrapping 10.0.0.1
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test("allows a public v6", () => {
  assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
});

test("a non-IP string is refused, not waved through", () => {
  assert.equal(isBlockedAddress("not-an-ip"), true);
  assert.equal(isBlockedAddress(""), true);
});

// ---------------------------------------------------------------------------
// assertAllowedUrl — shape, offline
// ---------------------------------------------------------------------------

test("rejects non-http(s) schemes", () => {
  for (const u of ["file:///etc/passwd", "ftp://example.com/x", "gopher://a", "data:text/html,x"]) {
    assert.throws(() => assertAllowedUrl(u), CaptureBlockedError, u);
  }
});

test("rejects ports other than 80 and 443", () => {
  assert.throws(() => assertAllowedUrl("http://example.com:22/"), CaptureBlockedError);
  assert.throws(() => assertAllowedUrl("http://example.com:8080/"), CaptureBlockedError);
  assert.doesNotThrow(() => assertAllowedUrl("http://example.com:80/"));
  assert.doesNotThrow(() => assertAllowedUrl("https://example.com:443/"));
});

test("rejects embedded credentials", () => {
  assert.throws(() => assertAllowedUrl("http://user:pass@example.com/"), CaptureBlockedError);
});

test("rejects localhost by name and a literal private IP up front", () => {
  assert.throws(() => assertAllowedUrl("http://localhost:3000/"), CaptureBlockedError);
  assert.throws(() => assertAllowedUrl("http://app.localhost/"), CaptureBlockedError);
  assert.throws(() => assertAllowedUrl("http://127.0.0.1/"), CaptureBlockedError);
  assert.throws(() => assertAllowedUrl("http://[::1]/"), CaptureBlockedError);
  assert.throws(
    () => assertAllowedUrl("http://169.254.169.254/latest/meta-data/"),
    CaptureBlockedError,
  );
});

test("accepts an ordinary public URL's shape", () => {
  assert.doesNotThrow(() => assertAllowedUrl("https://example.com/pricing?a=1#top"));
});

// ---------------------------------------------------------------------------
// resolveAndAssertHost — literal IPs, no network
// ---------------------------------------------------------------------------

test("resolveAndAssertHost passes a literal public IP and pins it", async () => {
  __clearResolveCache();
  const pinned = await resolveAndAssertHost("1.1.1.1");
  assert.equal(pinned.address, "1.1.1.1");
});

test("resolveAndAssertHost rejects a literal private IP", async () => {
  __clearResolveCache();
  await assert.rejects(() => resolveAndAssertHost("10.0.0.1"), CaptureBlockedError);
  await assert.rejects(() => resolveAndAssertHost("169.254.169.254"), CaptureBlockedError);
});

// ---------------------------------------------------------------------------
// guardedFetch — the guard fires before any socket for a bad target
// ---------------------------------------------------------------------------

test("guardedFetch refuses a private target without connecting", async () => {
  __clearResolveCache();
  await assert.rejects(() => guardedFetch("http://169.254.169.254/latest/"), CaptureBlockedError);
  await assert.rejects(() => guardedFetch("http://10.1.2.3/"), CaptureBlockedError);
  await assert.rejects(() => guardedFetch("http://[::1]:80/"), CaptureBlockedError);
  await assert.rejects(() => guardedFetch("ssh://example.com:22/"), CaptureBlockedError);
});
