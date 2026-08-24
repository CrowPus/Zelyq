import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, ToolCall } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";
import { buildAnthropicHistory } from "../src/providers/anthropic.js";
import { buildGoogleHistory } from "../src/providers/google.js";
import type { ConversationOptions, ModelProvider } from "../src/providers/types.js";
import { AgentSession } from "../src/session.js";

type HistoryEntry = NonNullable<ConversationOptions["history"]>[number];

function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: "call_1", name: "read_file", input: { path: "src/App.tsx" }, ...overrides };
}

test("Anthropic: a past tool call becomes a tool_use/tool_result pair", () => {
  const history: HistoryEntry[] = [
    {
      role: "assistant",
      content: "Reading the file.",
      toolCalls: [toolCall({ result: "export default function App() {}", isError: false })],
    },
  ];
  const messages = buildAnthropicHistory(history);

  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "assistant");
  const assistantContent = messages[0]?.content;
  assert.ok(Array.isArray(assistantContent));
  assert.deepEqual(
    assistantContent.map((block) => block.type),
    ["text", "tool_use"],
  );
  const toolUse = assistantContent[1] as { type: "tool_use"; id: string; name: string };
  assert.equal(toolUse.id, "call_1");
  assert.equal(toolUse.name, "read_file");

  assert.equal(messages[1]?.role, "user");
  const userContent = messages[1]?.content;
  assert.ok(Array.isArray(userContent));
  const toolResult = userContent[0] as { type: string; tool_use_id: string; is_error: boolean };
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.tool_use_id, "call_1");
  assert.equal(toolResult.is_error, false);
});

test("Anthropic: a tool-calls-only turn (empty content) still produces a text-free tool_use block", () => {
  const history: HistoryEntry[] = [{ role: "assistant", content: "", toolCalls: [toolCall()] }];
  const messages = buildAnthropicHistory(history);

  assert.equal(messages.length, 2, "an all-tool-calls turn must not be dropped");
  const content = messages[0]?.content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    content.map((block) => block.type),
    ["tool_use"],
    "no text block when the turn had no text",
  );
});

test("Anthropic: an ordinary text turn is unaffected", () => {
  const history: HistoryEntry[] = [
    { role: "user", content: "build me a todo app" },
    { role: "assistant", content: "Done." },
  ];
  const messages = buildAnthropicHistory(history);
  assert.deepEqual(messages, [
    { role: "user", content: "build me a todo app" },
    { role: "assistant", content: "Done." },
  ]);
});

test("Anthropic: a message with neither content nor tool calls is dropped", () => {
  const history: HistoryEntry[] = [{ role: "assistant", content: "" }];
  assert.deepEqual(buildAnthropicHistory(history), []);
});

test("Google: a past tool call becomes a functionCall/functionResponse pair", () => {
  const history: HistoryEntry[] = [
    {
      role: "assistant",
      content: "Reading the file.",
      toolCalls: [toolCall({ result: "export default function App() {}", isError: false })],
    },
  ];
  const contents = buildGoogleHistory(history);

  assert.equal(contents.length, 2);
  assert.equal(contents[0]?.role, "model");
  const modelParts = contents[0]?.parts ?? [];
  assert.equal(modelParts.length, 2);
  assert.ok("text" in (modelParts[0] ?? {}));
  assert.ok("functionCall" in (modelParts[1] ?? {}));

  assert.equal(contents[1]?.role, "user");
  const responseParts = contents[1]?.parts ?? [];
  const response = responseParts[0] as { functionResponse: { name: string; response: unknown } };
  assert.equal(response.functionResponse.name, "read_file");
  assert.deepEqual(response.functionResponse.response, {
    output: "export default function App() {}",
  });
});

test("Google: an error result is reported as an error, not an output", () => {
  const history: HistoryEntry[] = [
    {
      role: "assistant",
      content: "",
      toolCalls: [toolCall({ result: "file not found", isError: true })],
    },
  ];
  const contents = buildGoogleHistory(history);
  const response = contents[1]?.parts?.[0] as { functionResponse: { response: unknown } };
  assert.deepEqual(response.functionResponse.response, { error: "file not found" });
});

test("Google: a tool-calls-only turn (empty content) still produces a text-free functionCall part", () => {
  const history: HistoryEntry[] = [{ role: "assistant", content: "", toolCalls: [toolCall()] }];
  const contents = buildGoogleHistory(history);

  assert.equal(contents.length, 2, "an all-tool-calls turn must not be dropped");
  assert.equal(contents[0]?.parts?.length, 1, "no text part when the turn had no text");
  assert.ok("functionCall" in (contents[0]?.parts?.[0] ?? {}));
});

test("AgentSession: a persisted all-tool-calls turn reaches the provider intact, not dropped", () => {
  // The seam session.ts owns, distinct from what the two tests above cover:
  // its own filter used to treat empty `content` as "nothing here", which
  // silently dropped a turn that was nothing but tool calls before it ever
  // reached a provider's own reconstruction.
  let capturedHistory: ConversationOptions["history"];
  const fakeProvider: ModelProvider = {
    id: "anthropic",
    model: "test",
    createConversation(options) {
      capturedHistory = options.history;
      return {
        addUserMessage: () => undefined,
        addToolResults: () => undefined,
        async *stream() {
          for (const event of [] as never[]) yield event;
          return {
            toolCalls: [],
            stopReason: "end_turn",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
      };
    },
  };

  const persisted: Message[] = [
    {
      id: "msg_1",
      sessionId: "ses_1",
      role: "assistant",
      content: "",
      toolCalls: [toolCall({ result: "ok" })],
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    },
  ];

  new AgentSession({
    sessionId: "ses_1",
    projectId: "prj_1",
    projectName: "test",
    template: "vite-react",
    provider: "anthropic",
    model: "test",
    effort: "high",
    apiKey: "test",
    runtime: {} as RuntimeDriver,
    maxIterations: 5,
    history: persisted,
    providerFactory: () => fakeProvider,
  });

  assert.equal(
    capturedHistory?.length,
    1,
    "the all-tool-calls turn must survive session.ts's filter",
  );
  assert.equal(capturedHistory?.[0]?.toolCalls?.length, 1);
});
