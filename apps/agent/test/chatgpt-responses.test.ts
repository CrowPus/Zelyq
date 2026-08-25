import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import {
  buildChatGptHistory,
  buildChatGptUserContent,
  ChatGptResponsesError,
  ChatGptResponsesProvider,
  classifyChatGptResponsesError,
  describeChatGptResponsesError,
  packCodexCredential,
  unpackCodexCredential,
} from "../src/providers/chatgpt-responses.js";
import { createProvider } from "../src/providers/index.js";

/**
 * `045`'s OpenAI follow-up — a Codex "sign in with ChatGPT" session. Unlike
 * Claude's, this is genuinely unverified against a live account: it speaks
 * a private endpoint OpenAI never published, researched from real
 * third-party implementations (opencodex, codex-proxy) rather than
 * confirmed first-hand. What's tested here is that this codebase's own
 * request-building, history-reconstruction, and SSE-parsing logic does
 * exactly what it's supposed to against a real HTTP stand-in — not that
 * OpenAI's real backend actually accepts it, which needs a real account.
 */

// ---------------------------------------------------------------------------
// Credential packing — apiKey only ever carries one string; this is how a
// Codex session's two required values (token, account id) share that seam.
// ---------------------------------------------------------------------------

test("a packed credential round-trips exactly", () => {
  const packed = packCodexCredential("access-token-value", "acc_123");
  assert.equal(packed, "access-token-value:acc_123");
  assert.deepEqual(unpackCodexCredential(packed), {
    accessToken: "access-token-value",
    accountId: "acc_123",
  });
});

test("a malformed or empty credential unpacks to null, not a guess", () => {
  assert.equal(unpackCodexCredential("no-separator-here"), null);
  assert.equal(unpackCodexCredential(":acc_123"), null, "an empty token half is not valid");
  assert.equal(unpackCodexCredential("token:"), null, "an empty account id half is not valid");
});

// ---------------------------------------------------------------------------
// Message and history shape
// ---------------------------------------------------------------------------

test("a plain text message becomes one input_text content part", () => {
  const content = buildChatGptUserContent("hello");
  assert.deepEqual(content, [{ type: "input_text", text: "hello" }]);
});

test("an image attachment becomes input_image, ahead of the text", () => {
  const content = buildChatGptUserContent("look at this", [
    { filename: "shot.png", mimeType: "image/png", data: "ZmFrZQ==" },
  ]);
  assert.deepEqual(content, [
    { type: "input_image", image_url: "data:image/png;base64,ZmFrZQ==" },
    { type: "input_text", text: "look at this" },
  ]);
});

test("history reconstructs a plain turn as a message item", () => {
  const items = buildChatGptHistory([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello there" },
  ]);
  assert.deepEqual(items, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "hello there" }],
    },
  ]);
});

test("history reconstructs a tool-calling turn as call + output pairs", () => {
  const items = buildChatGptHistory([
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "read_file", input: { path: "a.ts" }, result: "contents" }],
    },
  ]);
  assert.deepEqual(items, [
    { type: "function_call", call_id: "call_1", name: "read_file", arguments: '{"path":"a.ts"}' },
    { type: "function_call_output", call_id: "call_1", output: "contents" },
  ]);
});

// ---------------------------------------------------------------------------
// createProvider wiring
// ---------------------------------------------------------------------------

test("createProvider routes openai + subscription to ChatGptResponsesProvider", () => {
  const provider = createProvider({
    provider: "openai",
    model: "gpt-5.3-codex",
    apiKey: packCodexCredential("tok", "acc_1"),
    authMode: "subscription",
  });
  assert.ok(provider instanceof ChatGptResponsesProvider);
  assert.equal(provider.id, "openai");
});

test("createProvider without subscription mode still uses the ordinary OpenAI-dialect provider", () => {
  const provider = createProvider({ provider: "openai", model: "gpt-5.1", apiKey: "sk-real" });
  assert.ok(!(provider instanceof ChatGptResponsesProvider));
});

test("a malformed packed credential fails clearly instead of sending a broken request", () => {
  assert.throws(
    () =>
      createProvider({
        provider: "openai",
        model: "gpt-5.3-codex",
        apiKey: "not-a-packed-credential",
        authMode: "subscription",
      }),
    /Reconnect it from Settings/,
  );
});

// ---------------------------------------------------------------------------
// A real turn against a stand-in server — proves the request this codebase
// builds, and the SSE parsing of what comes back, both actually work.
// ---------------------------------------------------------------------------

let received: { headers: http.IncomingHttpHeaders; body: string } | null = null;
let nextSseBody = "";
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    received = { headers: req.headers, body };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(nextSseBody);
  });
});
let endpoint = "";

before(async () => {
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  const port = typeof address === "object" && address ? address.port : 0;
  endpoint = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

beforeEach(() => {
  received = null;
  nextSseBody = "";
});

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

test("the request carries the account id header and bearer token a real account needs", async () => {
  nextSseBody = sse([
    {
      type: "response.completed",
      response: { output: [], status: "completed", usage: { input_tokens: 1, output_tokens: 1 } },
    },
  ]);

  const provider = new ChatGptResponsesProvider(
    "gpt-5.3-codex",
    "the-access-token",
    "acc_42",
    endpoint,
  );
  const conversation = provider.createConversation({
    systemPrompt: "be helpful",
    tools: [],
    effort: "high",
  });
  conversation.addUserMessage("hi");
  const iterator = conversation.stream(new AbortController().signal);
  while (!(await iterator.next()).done) {
    // drain
  }

  assert.equal(received?.headers.authorization, "Bearer the-access-token");
  assert.equal(received?.headers["chatgpt-account-id"], "acc_42");
  assert.equal(received?.headers["openai-beta"], "responses=experimental");
  const body = JSON.parse(received?.body ?? "{}");
  assert.equal(body.model, "gpt-5.3-codex");
  assert.equal(body.instructions, "be helpful");
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
});

test("streamed text deltas arrive as text events, and the final text matches", async () => {
  nextSseBody = sse([
    { type: "response.output_text.delta", delta: "Hel" },
    { type: "response.output_text.delta", delta: "lo!" },
    {
      type: "response.completed",
      response: {
        output: [{ type: "message", content: [{ type: "output_text", text: "Hello!" }] }],
        status: "completed",
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    },
  ]);

  const provider = new ChatGptResponsesProvider("gpt-5.3-codex", "tok", "acc_1", endpoint);
  const conversation = provider.createConversation({
    systemPrompt: "x",
    tools: [],
    effort: "high",
  });
  conversation.addUserMessage("hi");

  const deltas: string[] = [];
  const iterator = conversation.stream(new AbortController().signal);
  let result = await iterator.next();
  while (!result.done) {
    if (result.value.type === "text") deltas.push(result.value.text);
    result = await iterator.next();
  }

  assert.deepEqual(deltas, ["Hel", "lo!"]);
  assert.equal(result.value.stopReason, "end_turn");
  assert.equal(result.value.usage.inputTokens, 3);
  assert.equal(result.value.usage.outputTokens, 2);
});

test("a tool call in the completed event is returned, not left for the caller to guess at", async () => {
  nextSseBody = sse([
    {
      type: "response.completed",
      response: {
        output: [
          {
            type: "function_call",
            call_id: "call_9",
            name: "read_file",
            arguments: '{"path":"x"}',
          },
        ],
        status: "completed",
        usage: {},
      },
    },
  ]);

  const provider = new ChatGptResponsesProvider("gpt-5.3-codex", "tok", "acc_1", endpoint);
  const conversation = provider.createConversation({
    systemPrompt: "x",
    tools: [],
    effort: "high",
  });
  conversation.addUserMessage("read a file");
  const iterator = conversation.stream(new AbortController().signal);
  let result = await iterator.next();
  while (!result.done) result = await iterator.next();

  assert.deepEqual(result.value.toolCalls, [
    { id: "call_9", name: "read_file", input: { path: "x" } },
  ]);
  assert.equal(result.value.stopReason, "tool_use");
});

test("an error response becomes a classifiable, describable failure, not a raw throw", async () => {
  received = null;
  stub.removeAllListeners("request");
  stub.on("request", (_req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "rate limited" } }));
  });

  const provider = new ChatGptResponsesProvider("gpt-5.3-codex", "tok", "acc_1", endpoint);
  const conversation = provider.createConversation({
    systemPrompt: "x",
    tools: [],
    effort: "high",
  });
  conversation.addUserMessage("hi");

  await assert.rejects(async () => {
    const iterator = conversation.stream(new AbortController().signal);
    let result = await iterator.next();
    while (!result.done) result = await iterator.next();
  }, ChatGptResponsesError);
});

test("classify and describe agree on what a rate limit means", () => {
  const error = new ChatGptResponsesError("429 ...", 429);
  assert.equal(classifyChatGptResponsesError(error), "rate_limited");
  assert.match(describeChatGptResponsesError(error), /rate-limiting/i);
});

test("classify and describe agree on what an auth failure means", () => {
  const error = new ChatGptResponsesError("401 ...", 401);
  assert.equal(classifyChatGptResponsesError(error), "unauthorized");
  assert.match(describeChatGptResponsesError(error), /Reconnect it from Settings/);
});
