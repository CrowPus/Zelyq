import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { guardedRequest, refusedAddress } from "../src/services/net-guard.js";
import { sendNotification } from "../src/services/pipelines/notify.js";

/**
 * The guard on every call Zelyq makes to an address someone else chose: Ops's
 * checks (strict) and notifications (normal).
 */

let local: http.Server;
let port = 0;

before(async () => {
  local = http.createServer((_request, response) => response.end("secret internal page"));
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  port = (local.address() as AddressInfo).port;
});

after(() => local.close());

test("this server, link-local and metadata addresses are refused at every level", () => {
  for (const address of [
    "127.0.0.1",
    "127.10.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "::1",
    "[::1]",
    "::ffff:127.0.0.1",
    "fe80::1",
  ]) {
    assert.ok(refusedAddress(address, "normal"), `${address} (normal)`);
    assert.ok(refusedAddress(address, "strict"), `${address} (strict)`);
  }
});

test("private networks are refused when strict, allowed for a person's own setup", () => {
  for (const address of [
    "10.0.0.5",
    "172.16.3.4",
    "192.168.1.10",
    "100.64.0.1",
    "fd12::1",
    "::ffff:10.0.0.5",
  ]) {
    assert.ok(refusedAddress(address, "strict"), `${address} (strict)`);
    assert.equal(refusedAddress(address, "normal"), null, `${address} (normal)`);
  }
  assert.equal(refusedAddress("93.184.216.34", "strict"), null);
});

test("a request to this server is refused, by address and by a name that resolves to it", async () => {
  await assert.rejects(
    guardedRequest(`http://127.0.0.1:${port}/`, { level: "normal" }),
    /this server/,
  );
  // "localhost" passes no check on its name; it is refused when it resolves.
  await assert.rejects(
    guardedRequest(`http://localhost:${port}/`, { level: "normal" }),
    /this server/,
  );
  await assert.rejects(
    guardedRequest(`http://[::ffff:127.0.0.1]:${port}/`, { level: "strict" }),
    /this server/,
  );
});

test("only http and https", async () => {
  await assert.rejects(guardedRequest("file:///etc/passwd", { level: "normal" }), /http/);
});

test("a notification to this server is refused with the same words as before", async () => {
  await assert.rejects(
    sendNotification(`http://localhost:${port}/hook`, {
      pipeline: "Shop",
      run: 1,
      status: "passed",
      trigger: "manual",
      link: null,
    }),
    /not allowed/,
  );
});
