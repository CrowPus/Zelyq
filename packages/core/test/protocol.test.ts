import assert from "node:assert/strict";
import { test } from "node:test";
import { agentEventSchema, clientMessageSchema, encodeSse } from "../src/protocol.js";

test("agent events round-trip through the schema", () => {
  const event = agentEventSchema.parse({
    type: "text.delta",
    sessionId: "ses_1",
    messageId: "msg_1",
    text: "hello",
  });
  const frame = encodeSse(event);
  assert.ok(frame.startsWith("event: text.delta\ndata: "));
  const [, payload] = frame.split("data: ");
  assert.deepEqual(agentEventSchema.parse(JSON.parse(payload!.trim())), event);
});

test("unknown event types are rejected rather than passed through", () => {
  assert.throws(() => agentEventSchema.parse({ type: "nope", sessionId: "s" }));
});

test("client messages reject an empty prompt", () => {
  assert.throws(() => clientMessageSchema.parse({ type: "prompt", message: "" }));
  assert.ok(clientMessageSchema.parse({ type: "abort" }));
});
