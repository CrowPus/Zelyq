import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { ChatGptResponsesProvider } from "../src/providers/chatgpt-responses.js";
import { classifyProviderError, createProvider } from "../src/providers/index.js";
import { OpenAIResponsesProvider, responsesUrl } from "../src/providers/openai-responses.js";
import type { Conversation, ConversationOptions } from "../src/providers/types.js";

let base: string;
let events: unknown[] = [];
let status = 200;
interface CapturedBody {
  model: string;
  store: boolean;
  reasoning?: { effort: string };
  reasoning_effort?: unknown;
  temperature?: unknown;
  prompt_cache_key: string;
  tools: Array<{ strict: boolean }>;
  input: Array<{
    type: string;
    content: Array<{ type: string }>;
    call_id?: string;
    output?: string;
  }>;
}
const requests: Array<{ url?: string; headers: http.IncomingHttpHeaders; body: CapturedBody }> = [];
const fixture = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  requests.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) });
  res.writeHead(status, {
    "content-type": status === 200 ? "text/event-stream" : "application/json",
  });
  if (status !== 200) {
    res.end(JSON.stringify({ error: { message: "model access denied" } }));
    return;
  }
  // Arbitrary byte boundaries, including inside multibyte text.
  const bytes = Buffer.from(
    events.map((event) => `event: test\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(""),
  );
  for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7));
  res.end();
});
before(async () => {
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});
const options: ConversationOptions = {
  systemPrompt: "Build a project",
  effort: "max",
  tools: [
    {
      name: "read_file",
      description: "Read",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  ],
};
async function collect(conversation: Conversation, signal = new AbortController().signal) {
  const deltas = [];
  const stream = conversation.stream(signal);
  while (true) {
    const next = await stream.next();
    if (next.done) return { deltas, result: next.value };
    deltas.push(next.value);
  }
}
function completed(output: unknown[] = [], usage = {}) {
  return { type: "response.completed", response: { status: "completed", output, usage } };
}

test("API keys route to Responses while subscription credentials keep their own transport", () => {
  assert.ok(
    createProvider({ provider: "openai", model: "gpt-6-astra", apiKey: "key" }) instanceof
      OpenAIResponsesProvider,
  );
  assert.ok(
    createProvider({
      provider: "openai",
      model: "gpt-5.3-codex",
      apiKey: "token:account",
      authMode: "subscription",
    }) instanceof ChatGptResponsesProvider,
  );
  for (const suffix of ["", "/v1", "/v1/", "/v1/responses", "/v1/chat/completions"])
    assert.equal(responsesUrl(`${base}${suffix}`), `${base}/v1/responses`);
  assert.throws(() => responsesUrl("http://example.com/v1"), /plaintext/);
});

test("streams text/thinking, accounts cache, and preserves native reasoning and tool calls across rounds", async () => {
  const conversation = new OpenAIResponsesProvider(
    "gpt-6-astra",
    "fixture-key",
    base,
  ).createConversation(options);
  conversation.addUserMessage("Inspect", [
    { filename: "image.png", mimeType: "image/png", data: "aGVsbG8=" },
  ]);
  const reasoning = { type: "reasoning", id: "rs_1", encrypted_content: "encrypted", summary: [] };
  const call = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "read_file",
    arguments: '{"path":"src/main.ts"}',
    status: "completed",
  };
  const message = {
    type: "message",
    id: "msg_1",
    role: "assistant",
    phase: "commentary",
    content: [{ type: "output_text", text: "Inspecting ✓" }],
  };
  events = [
    { type: "response.reasoning_summary_text.delta", delta: "Checking" },
    { type: "response.output_text.delta", delta: "Inspecting ✓" },
    completed([reasoning, message, call], {
      input_tokens: 120,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 80 },
    }),
  ];
  const first = await collect(conversation);
  assert.deepEqual(first.deltas, [
    { type: "thinking", text: "Checking" },
    { type: "text", text: "Inspecting ✓" },
  ]);
  assert.equal(first.result.stopReason, "tool_use");
  assert.deepEqual(first.result.usage, {
    inputTokens: 40,
    outputTokens: 20,
    cacheReadInputTokens: 80,
  });
  assert.deepEqual(first.result.toolCalls, [
    { id: "call_1", name: "read_file", input: { path: "src/main.ts" } },
  ]);
  const request = requests.at(-1)!;
  assert.equal(request.url, "/v1/responses");
  assert.equal(request.headers.authorization, "Bearer fixture-key");
  assert.equal(request.headers["chatgpt-account-id"], undefined);
  assert.equal(request.body.store, false);
  assert.deepEqual(request.body.reasoning, { effort: "max" });
  assert.equal(request.body.tools[0].strict, false);
  assert.equal(request.body.reasoning_effort, undefined);
  assert.equal(request.body.temperature, undefined);
  assert.equal(request.body.input[0].content[0].type, "input_image");
  conversation.addToolResults([
    {
      id: "call_1",
      name: "read_file",
      output: "file contents",
      isError: false,
      images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    },
  ]);
  events = [
    completed([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] },
    ]),
  ];
  const second = await collect(conversation);
  assert.deepEqual(second.deltas, [{ type: "text", text: "Done" }]);
  const next = requests.at(-1)!.body;
  assert.deepEqual(next.input.slice(1, 4), [reasoning, message, call]);
  assert.equal(next.input[4].call_id, "call_1");
  assert.equal(next.input[5].content[0].type, "input_image");
  assert.equal(next.prompt_cache_key, request.body.prompt_cache_key);
});

test("rebuilds tool history after restart and maps unsupported effort for older models", async () => {
  events = [completed()];
  const conversation = new OpenAIResponsesProvider("gpt-5.3-codex", "key", base).createConversation(
    {
      ...options,
      history: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "old_call", name: "read_file", input: { path: "a" }, result: "a contents" },
          ],
        },
      ],
    },
  );
  await collect(conversation);
  const body = requests.at(-1)!.body;
  assert.equal(body.reasoning.effort, "xhigh");
  assert.equal(body.input[0].call_id, "old_call");
  assert.equal(body.input[1].output, "a contents");
  await collect(
    new OpenAIResponsesProvider("custom-model", "key", base).createConversation(options),
  );
  assert.equal(requests.at(-1)!.body.reasoning, undefined);
});

test("refusals and incomplete output do not execute partial tool calls", async () => {
  events = [
    {
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [
          { type: "function_call", call_id: "partial", name: "read_file", arguments: '{"path":' },
        ],
      },
    },
  ];
  const limited = await collect(
    new OpenAIResponsesProvider("gpt-6-astra", "key", base).createConversation(options),
  );
  assert.equal(limited.result.stopReason, "max_tokens");
  assert.deepEqual(limited.result.toolCalls, []);
  events = [
    completed([
      {
        type: "message",
        role: "assistant",
        content: [{ type: "refusal", refusal: "Cannot help" }],
      },
    ]),
  ];
  const refused = await collect(
    new OpenAIResponsesProvider("gpt-6-astra", "key", base).createConversation(options),
  );
  assert.equal(refused.result.stopReason, "refusal");
  assert.equal(refused.result.refusalReason, "Cannot help");
});

test("truncated streams, failed events, and malformed tool arguments are errors", async () => {
  for (const stream of [
    [],
    [{ type: "response.failed", response: { error: { message: "upstream failed" } } }],
    [{ type: "error", message: "stream error" }],
    [completed([{ type: "function_call", call_id: "bad", name: "read_file", arguments: "oops" }])],
  ]) {
    events = stream;
    await assert.rejects(
      collect(new OpenAIResponsesProvider("gpt-6-astra", "key", base).createConversation(options)),
    );
  }
  status = 403;
  try {
    await assert.rejects(
      collect(new OpenAIResponsesProvider("gpt-6-astra", "key", base).createConversation(options)),
      (error) => classifyProviderError("openai", error) === "unauthorized",
    );
  } finally {
    status = 200;
  }
  events = [completed()];
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    collect(
      new OpenAIResponsesProvider("gpt-6-astra", "key", base).createConversation(options),
      abort.signal,
    ),
    { name: "AbortError" },
  );
});
