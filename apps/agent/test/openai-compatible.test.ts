import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import {
  chatCompletionsUrl,
  classifyOpenAICompatibleError,
  OpenAICompatibleProvider,
  requireEncryptedOrLocal,
} from "../src/providers/openai-compatible.js";
import type { Conversation, ProviderEvent, TurnResult } from "../src/providers/types.js";

/**
 * The provider that lets a team keep its code on its own network.
 *
 * A feature touching somebody's real environment needs a test against
 * something shaped like their environment, not like ours. The equivalent
 * here is a **real HTTP server speaking the dialect** — not a stubbed
 * client object. A mock would agree with whatever this implementation happens to
 * send, which is exactly the failure being guarded against: the dialect is the
 * part we do not control.
 */

interface Recorded {
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

let server: http.Server;
let baseUrl: string;
const received: Recorded[] = [];
/** What the next request should reply with, in order. */
const replies: Array<{ status?: number; events?: unknown[]; raw?: string }> = [];

before(async () => {
  server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        body: raw ? JSON.parse(raw) : {},
      });

      const next = replies.shift() ?? { events: [] };
      if (next.status && next.status >= 400) {
        response
          .writeHead(next.status, { "content-type": "application/json" })
          .end(next.raw ?? JSON.stringify({ error: { message: "computer says no" } }));
        return;
      }

      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of next.events ?? []) {
        // Real servers split events across packets and pad with keep-alives.
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
  // Port 0: the OS picks a free one, so this suite can never collide with
  // another package's tests running in parallel.
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function conversationFor(apiKey = "test-key"): Conversation {
  const provider = new OpenAICompatibleProvider({
    id: "custom",
    model: "a-local-model",
    apiKey,
    baseUrl,
  });
  return provider.createConversation({
    systemPrompt: "You are a build agent.",
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
    effort: "high",
  });
}

/** Drains a turn into the events it yielded and the result it returned. */
async function runTurn(
  conversation: Conversation,
): Promise<{ events: ProviderEvent[]; result: TurnResult }> {
  const events: ProviderEvent[] = [];
  const stream = conversation.stream(new AbortController().signal);
  for (;;) {
    const next = await stream.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

const textDelta = (content: string) => ({ choices: [{ delta: { content } }] });

// ---------------------------------------------------------------------------
// The plaintext guard — the condition the DevOps Architect made non-negotiable
// ---------------------------------------------------------------------------

test("https is accepted anywhere", () => {
  assert.equal(requireEncryptedOrLocal("https://models.internal/v1").protocol, "https:");
});

test("plaintext is allowed only to this machine", () => {
  for (const url of ["http://localhost:11434/v1", "http://127.0.0.1:8000/v1", "http://[::1]/v1"]) {
    assert.ok(requireEncryptedOrLocal(url), `${url} should be allowed`);
  }
});

test("plaintext to anywhere else is refused, and says why", () => {
  // The whole point of this provider is a network boundary. Sending source over
  // http across a datacentre would defeat it while looking like it worked.
  for (const url of [
    "http://models.internal/v1",
    "http://10.0.0.5:8000/v1",
    "http://gpu-box.local/v1",
  ]) {
    assert.throws(
      () => requireEncryptedOrLocal(url),
      (error: Error) => {
        assert.match(error.message, /plaintext|unencrypted/i, error.message);
        return true;
      },
      `${url} should have been refused`,
    );
  }
});

test("an address with no scheme is corrected with an example, not a stack trace", () => {
  // "localhost:11434" parses as a URL whose protocol is "localhost:", so the
  // naive message quotes back something the user never typed.
  assert.throws(
    () => requireEncryptedOrLocal("localhost:11434"),
    (error: Error) => {
      assert.match(error.message, /http:\/\/ or https:\/\//);
      assert.match(error.message, /localhost:11434/, "the message should quote what was entered");
      assert.doesNotMatch(
        error.message,
        /localhost:\/\//,
        "do not invent a scheme they never used",
      );
      return true;
    },
  );
});

test("a genuinely unparseable endpoint is refused with an example", () => {
  assert.throws(
    () => requireEncryptedOrLocal("not a url at all"),
    (error: Error) => {
      assert.match(error.message, /not a valid URL/i);
      return true;
    },
  );
});

test("the endpoint is built from whatever form of the address was pasted", () => {
  // People paste what their server's own documentation shows them.
  const expected = "https://host.example/v1/chat/completions";
  assert.equal(chatCompletionsUrl("https://host.example"), expected);
  assert.equal(chatCompletionsUrl("https://host.example/"), expected);
  assert.equal(chatCompletionsUrl("https://host.example/v1"), expected);
  assert.equal(chatCompletionsUrl("https://host.example/v1/"), expected);
  assert.equal(chatCompletionsUrl("https://host.example/v1/chat/completions"), expected);
});

// ---------------------------------------------------------------------------
// The dialect, against a server that actually speaks it
// ---------------------------------------------------------------------------

test("text and usage come back from a streamed turn", async () => {
  replies.push({
    events: [
      textDelta("Hello"),
      textDelta(", world"),
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } },
    ],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("say hello");
  const { events, result } = await runTurn(conversation);

  assert.deepEqual(
    events.filter((event) => event.type === "text").map((event) => event.text),
    ["Hello", ", world"],
  );
  assert.equal(result.stopReason, "end_turn");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3 });
});

test("cached prompt tokens are split out of the input figure (A4)", async () => {
  replies.push({
    events: [
      textDelta("ok"),
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 5,
          prompt_tokens_details: { cached_tokens: 900 },
        },
      },
    ],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("go");
  const { result } = await runTurn(conversation);

  // `inputTokens` is the uncached remainder; the cached 900 is reported apart.
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(result.usage.cacheReadInputTokens, 900);
  assert.equal(result.usage.outputTokens, 5);
});

test("tool call arguments are assembled from the fragments they arrive in", async () => {
  // This is the part every server does and the easiest thing to get wrong: the
  // id arrives once, on the first fragment, and the arguments are a JSON string
  // dribbled out across many deltas.
  replies.push({
    events: [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_abc", function: { name: "read_file", arguments: '{"pa' } },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"src/' } }] } }],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'App.tsx"}' } }] } }],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("read the app");
  const { result } = await runTurn(conversation);

  assert.equal(result.stopReason, "tool_use");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]?.id, "call_abc");
  assert.equal(result.toolCalls[0]?.name, "read_file");
  assert.deepEqual(result.toolCalls[0]?.input, { path: "src/App.tsx" });
});

test("a tool call reported as a plain stop is still a tool call", async () => {
  // Several servers send finish_reason "stop" alongside tool calls. What the
  // model did outranks what it said it did, or the loop ends mid-task.
  replies.push({
    events: [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "c1", function: { name: "read_file", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("go");
  const { result } = await runTurn(conversation);

  assert.equal(result.stopReason, "tool_use");
  assert.equal(result.toolCalls.length, 1);
});

test("tool results are sent back as their own messages, naming the call", async () => {
  replies.push({
    events: [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "read_file", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  });
  replies.push({
    events: [textDelta("done"), { choices: [{ delta: {}, finish_reason: "stop" }] }],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("read it");
  await runTurn(conversation);

  conversation.addToolResults([
    { id: "call_1", name: "read_file", output: "file contents", isError: false },
  ]);
  const before = received.length;
  await runTurn(conversation);

  const sent = received[before]?.body as { messages: Array<Record<string, unknown>> };
  const assistant = sent.messages.find((message) => message.role === "assistant");
  const toolReply = sent.messages.find((message) => message.role === "tool");

  // The assistant turn must be echoed back with its tool call, or the result
  // answers a call that no message in the history contains.
  assert.ok(assistant, "the assistant turn was not echoed back");
  assert.ok(Array.isArray(assistant?.tool_calls), "the echoed turn lost its tool calls");
  assert.ok(toolReply, "the tool result was not sent");
  assert.equal(toolReply?.tool_call_id, "call_1");
  assert.equal(toolReply?.content, "file contents");
});

test("a tool result carrying an image rides as a synthetic user message right after it — see 040", async () => {
  // This dialect's `role: "tool"` message has no image-carrying variant —
  // the content field is a plain string. The image has to travel as an
  // ordinary user turn instead, immediately after the tool result it belongs
  // to, or it never reaches the model at all.
  replies.push({
    events: [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "view_preview", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  });
  replies.push({
    events: [textDelta("looks fine"), { choices: [{ delta: {}, finish_reason: "stop" }] }],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("check the preview");
  await runTurn(conversation);

  conversation.addToolResults([
    {
      id: "call_1",
      name: "view_preview",
      output: "Screenshot of the running preview.",
      isError: false,
      images: [{ mimeType: "image/jpeg", data: "ZmFrZS1qcGVn" }],
    },
  ]);
  const before = received.length;
  await runTurn(conversation);

  const sent = received[before]?.body as { messages: Array<Record<string, unknown>> };
  const toolIndex = sent.messages.findIndex((message) => message.role === "tool");
  const following = sent.messages[toolIndex + 1];

  assert.ok(toolIndex !== -1, "the tool result itself was not sent");
  assert.equal(
    typeof sent.messages[toolIndex]?.content,
    "string",
    "a tool message's content must stay a plain string in this dialect",
  );
  assert.equal(following?.role, "user", "the image must ride as the very next message");
  const parts = following?.content as Array<{ type: string; image_url?: { url: string } }>;
  assert.ok(Array.isArray(parts), "the synthetic user message must use the multi-part shape");
  const imagePart = parts.find((part) => part.type === "image_url");
  assert.ok(imagePart, "no image_url part found");
  assert.equal(imagePart?.image_url?.url, "data:image/jpeg;base64,ZmFrZS1qcGVn");
});

test("reasoning text is surfaced as thinking, under either field name", async () => {
  replies.push({
    events: [
      { choices: [{ delta: { reasoning_content: "weighing it up" } }] },
      { choices: [{ delta: { reasoning: "still weighing" } }] },
      textDelta("answer"),
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("think");
  const { events } = await runTurn(conversation);

  assert.deepEqual(
    events.filter((event) => event.type === "thinking").map((event) => event.text),
    ["weighing it up", "still weighing"],
  );
});

test("the system prompt leads the conversation, as this dialect requires", async () => {
  replies.push({ events: [{ choices: [{ delta: {}, finish_reason: "stop" }] }] });

  const conversation = conversationFor();
  conversation.addUserMessage("hello");
  const before = received.length;
  await runTurn(conversation);

  const sent = received[before]?.body as { messages: Array<Record<string, unknown>> };
  assert.equal(sent.messages[0]?.role, "system");
  assert.equal(sent.messages[0]?.content, "You are a build agent.");
});

test("no key means no authorization header, because local endpoints have none", async () => {
  replies.push({ events: [{ choices: [{ delta: {}, finish_reason: "stop" }] }] });

  const conversation = conversationFor("");
  conversation.addUserMessage("hello");
  const before = received.length;
  await runTurn(conversation);

  // Sending an empty bearer token makes some servers reject the request
  // outright, which reads as "Zelyq is broken" rather than "no key needed".
  assert.equal(received[before]?.authorization, undefined);
});

test("a key is sent as a bearer token when there is one", async () => {
  replies.push({ events: [{ choices: [{ delta: {}, finish_reason: "stop" }] }] });

  const conversation = conversationFor("sk-secret");
  conversation.addUserMessage("hello");
  const before = received.length;
  await runTurn(conversation);

  assert.equal(received[before]?.authorization, "Bearer sk-secret");
});

test("the endpoint's own error text reaches the user", async () => {
  replies.push({
    status: 400,
    raw: JSON.stringify({ error: { message: "model 'llama-99' not found" } }),
  });

  const conversation = conversationFor();
  conversation.addUserMessage("hello");

  await assert.rejects(runTurn(conversation), (error: Error) => {
    // Repeating "400 Bad Request" would tell somebody nothing. The server knows
    // what is wrong and said so.
    assert.match(error.message, /model 'llama-99' not found/);
    assert.equal(classifyOpenAICompatibleError(error), "bad_request");
    return true;
  });
});

test("an unauthorized endpoint is classified as such, not as a generic failure", async () => {
  replies.push({ status: 401, raw: JSON.stringify({ error: { message: "bad key" } }) });

  const conversation = conversationFor();
  conversation.addUserMessage("hello");

  await assert.rejects(runTurn(conversation), (error: Error) => {
    assert.equal(classifyOpenAICompatibleError(error), "unauthorized");
    return true;
  });
});

test("an endpoint that is not listening reports a connection problem", async () => {
  const provider = new OpenAICompatibleProvider({
    id: "custom",
    model: "m",
    apiKey: "",
    // Nothing is listening here, which is what a mistyped port looks like.
    baseUrl: "http://127.0.0.1:1/v1",
  });
  const conversation = provider.createConversation({
    systemPrompt: "s",
    tools: [],
    effort: "high",
  });
  conversation.addUserMessage("hello");

  await assert.rejects(runTurn(conversation), (error: Error) => {
    assert.equal(classifyOpenAICompatibleError(error), "connection");
    assert.match(error.message, /Could not reach the model endpoint/);
    return true;
  });
});

test("malformed tool arguments end the turn, rather than crashing it", async () => {
  // A small model producing broken JSON is a bad turn the model can recover
  // from. It must not take the process with it.
  replies.push({
    events: [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "c1", function: { name: "read_file", arguments: "{not json" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("go");
  const { result } = await runTurn(conversation);

  assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.toolCalls[0]?.input, {});
});

// ---------------------------------------------------------------------------
// 065 — the tool messages answering an assistant's tool_calls must be
// CONTIGUOUS. The image carrier above used to be pushed inline, right after
// the result it belonged to, which ended that run at the first image: a live
// gpt-5.2 turn that called view_preview in parallel with four audit tools came
// back "the following tool_call_ids did not have response messages" for the
// other four — after all five had already run. One result never trips it, and
// neither does an image in the LAST slot, so the batch below puts it first.
// ---------------------------------------------------------------------------

test("065: a parallel batch keeps its tool messages contiguous when a non-last result has an image", async () => {
  const names = [
    "view_preview",
    "check_console_errors",
    "check_network_failures",
    "accessibility_audit",
    "test_responsive_layout",
  ];
  replies.push({
    events: [
      {
        choices: [
          {
            delta: {
              tool_calls: names.map((name, index) => ({
                index,
                id: `call_${index + 1}`,
                function: { name, arguments: "{}" },
              })),
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  });
  replies.push({
    events: [textDelta("all good"), { choices: [{ delta: {}, finish_reason: "stop" }] }],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("check the preview");
  await runTurn(conversation);

  conversation.addToolResults(
    names.map((name, index) => ({
      id: `call_${index + 1}`,
      name,
      output: `${name} ran.`,
      isError: false,
      // Only the FIRST result carries an image — the shape that broke.
      ...(index === 0 ? { images: [{ mimeType: "image/jpeg", data: "ZmFrZS1qcGVn" }] } : {}),
    })),
  );
  const before = received.length;
  await runTurn(conversation);

  const sent = received[before]?.body as { messages: Array<Record<string, unknown>> };
  const assistantIndex = sent.messages.findIndex((m) => m.role === "assistant");
  assert.ok(assistantIndex !== -1, "the assistant tool_calls turn was not sent");

  // The five tool messages must directly follow the assistant turn, in call
  // order, with nothing wedged between them.
  const batch = sent.messages.slice(assistantIndex + 1, assistantIndex + 1 + names.length);
  assert.deepEqual(
    batch.map((m) => m.role),
    new Array(names.length).fill("tool"),
    "a non-tool message was interleaved into the batch",
  );
  assert.deepEqual(
    batch.map((m) => m.tool_call_id),
    names.map((_, index) => `call_${index + 1}`),
    "tool results must stay in call order, each naming its own call",
  );

  // The image still arrives, immediately after the whole batch.
  const afterBatch = sent.messages[assistantIndex + 1 + names.length];
  assert.equal(afterBatch?.role, "user", "the image must ride just after the batch");
  const parts = afterBatch?.content as Array<{ type: string; image_url?: { url: string } }>;
  const imagePart = parts.find((part) => part.type === "image_url");
  assert.ok(imagePart, "the screenshot never reached the model");
  assert.equal(imagePart?.image_url?.url, "data:image/jpeg;base64,ZmFrZS1qcGVn");
});

test("065: a batch with no images is unchanged — tool messages and nothing else", async () => {
  replies.push({
    events: [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_a", function: { name: "read_file", arguments: "{}" } },
                { index: 1, id: "call_b", function: { name: "list_files", arguments: "{}" } },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ],
  });
  replies.push({
    events: [textDelta("ok"), { choices: [{ delta: {}, finish_reason: "stop" }] }],
  });

  const conversation = conversationFor();
  conversation.addUserMessage("look around");
  await runTurn(conversation);
  conversation.addToolResults([
    { id: "call_a", name: "read_file", output: "contents", isError: false },
    { id: "call_b", name: "list_files", output: "a\nb", isError: false },
  ]);
  const before = received.length;
  await runTurn(conversation);

  const sent = received[before]?.body as { messages: Array<Record<string, unknown>> };
  const assistantIndex = sent.messages.findIndex((m) => m.role === "assistant");
  assert.equal(sent.messages[assistantIndex + 1]?.role, "tool");
  assert.equal(sent.messages[assistantIndex + 2]?.role, "tool");
  assert.equal(
    sent.messages[assistantIndex + 3],
    undefined,
    "no synthetic user turn when nothing returned an image",
  );
});
