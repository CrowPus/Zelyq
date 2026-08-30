import assert from "node:assert/strict";
import { test } from "node:test";
import { messageSchema } from "../src/models.js";
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

test("062: a prompt carries optional skills, agents and plugins name arrays", () => {
  const parsed = clientMessageSchema.parse({
    type: "prompt",
    message: "polish it",
    skills: ["shadcn-ui-setup"],
    agents: ["designer"],
    plugins: ["some_tool"],
  });
  assert.equal(parsed.type, "prompt");
  assert.deepEqual(parsed.type === "prompt" ? parsed.agents : null, ["designer"]);
});

test("062: message mentions round-trip, and default to empty arrays / null", () => {
  const base = {
    id: "msg_1",
    sessionId: "ses_1",
    role: "user" as const,
    content: "hi",
    createdAt: new Date().toISOString(),
  };
  // Nothing named — the field is simply absent, and stays optional.
  assert.equal(messageSchema.parse(base).mentions, undefined);
  // A partial object fills the missing arms with empty arrays.
  const withMentions = messageSchema.parse({ ...base, mentions: { agents: ["designer"] } });
  assert.deepEqual(withMentions.mentions, { skills: [], agents: ["designer"], plugins: [] });
  // Explicit null is allowed — that is what a message with no picks stores.
  assert.equal(messageSchema.parse({ ...base, mentions: null }).mentions, null);
});
