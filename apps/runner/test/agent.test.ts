import assert from "node:assert/strict";
import { test } from "node:test";
import { baseUrl, checkUrl, frame, socketUrl, unframe } from "../src/agent.js";

test("addresses: https only (or this machine), no double slashes", () => {
  assert.equal(
    socketUrl(checkUrl("https://app.zelyq.dev/")),
    "wss://app.zelyq.dev/ws/runner-agent",
  );
  assert.equal(
    socketUrl(checkUrl("https://example.com/zelyq/")),
    "wss://example.com/zelyq/ws/runner-agent",
  );
  assert.equal(socketUrl(checkUrl("http://127.0.0.1:8080")), "ws://127.0.0.1:8080/ws/runner-agent");
  assert.equal(baseUrl(checkUrl("https://app.zelyq.dev")), "https://app.zelyq.dev");
  assert.throws(() => checkUrl("http://app.zelyq.dev"), /https/);
  assert.throws(() => checkUrl("not a url"), /not an address/);
});

test("frames carry their type, id and bytes", () => {
  const out = unframe(frame(2, 4_000_000_000, Buffer.from("hi")));
  assert.deepEqual([out?.type, out?.id, out?.payload.toString()], [2, 4_000_000_000, "hi"]);
  assert.equal(unframe(Buffer.from([1, 2])), null);
});
