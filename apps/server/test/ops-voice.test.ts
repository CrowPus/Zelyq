import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { User } from "@zelyq/core";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import type { OpsTurnRequest, OpsTurnResult } from "../src/services/agent-client.js";
import { OpsBrain } from "../src/services/ops/brain.js";
import { type LiveConnect, OpsVoice } from "../src/services/ops/voice.js";

/**
 * Talking to Ops live, with a stand-in for Gemini Live: the voice goes in, a
 * tool call goes through the same gate as typed work, Ops's voice comes back,
 * and both sides are kept in the job. The real service is checked by hand with
 * test/helpers/voice-live.mts.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-voice-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops-voice.db")}`,
  agentUrl: "http://127.0.0.1:59994",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  pipelinesDir: path.join(tmp, "pipelines"),
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4952, 4955],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let store: Store;
let owner: User;
let teamId: string;
let cookie: string;
let brain: OpsBrain;

/** What the stand-in Gemini Live was given, and a way to make it "say" things. */
interface FakeLive {
  config: Record<string, unknown> | null;
  audioIn: number;
  toolResponses: { id?: string; name?: string; response?: { output?: string } }[];
  emit: (message: Record<string, unknown>) => void;
}

function fakeLive(): { live: FakeLive; connect: LiveConnect } {
  const live: FakeLive = { config: null, audioIn: 0, toolResponses: [], emit: () => undefined };
  const connect: LiveConnect = async ({ config, callbacks }) => {
    live.config = config;
    live.emit = (message) => callbacks.onmessage(message as never);
    return {
      sendRealtimeInput: () => {
        live.audioIn += 1;
      },
      sendClientContent: () => undefined,
      sendToolResponse: (input: { functionResponses: unknown }) => {
        live.toolResponses.push(...(input.functionResponses as FakeLive["toolResponses"]));
      },
      close: () => undefined,
    } as never;
  };
  return { live, connect };
}

/** The browser's end of the socket. */
function fakeSocket() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const socket = {
    readyState: 1,
    events: [] as Record<string, unknown>[],
    audioOut: 0,
    send(data: string | Buffer) {
      if (typeof data === "string") socket.events.push(JSON.parse(data));
      else socket.audioOut += data.length;
    },
    close() {
      if (socket.readyState === 3) return;
      socket.readyState = 3;
      for (const listener of listeners.close ?? []) listener();
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners[event] = [...(listeners[event] ?? []), listener];
    },
    frame(bytes: number) {
      for (const listener of listeners.message ?? []) listener(Buffer.alloc(bytes), true);
    },
  };
  return socket;
}

const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "correct-horse-battery" },
  });
  cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  teamId = (
    await server.app.inject({ method: "GET", url: "/api/teams", headers: { cookie } })
  ).json().teams[0].id;
  owner = (await store.users.findByEmail("owner@example.com")) as unknown as User;
  await server.app.inject({ method: "POST", url: `/api/teams/${teamId}/ops`, headers: { cookie } });
  const agent = {
    async opsTurn(_request: OpsTurnRequest): Promise<OpsTurnResult> {
      return {
        text: "",
        usage: { inputTokens: 0, outputTokens: 0 },
        rounds: 1,
        stopped: null,
        model: "x",
      };
    },
  };
  brain = new OpsBrain(server.ops, server.settings, agent as never, "http://127.0.0.1:1");
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("without a Google AI key, talking live says what to add, and starts nothing", async () => {
  const { connect } = fakeLive();
  const voice = new OpsVoice(server.ops, brain, server.settings, connect);
  const socket = fakeSocket();
  await voice.relay(socket as never, owner, teamId, null);
  const error = socket.events.find((event) => event.type === "error");
  assert.match(String(error?.message), /Google AI key/);
  assert.equal(socket.readyState, 3);
});

test("a live conversation: voice in, a tool through the gate, voice out, both sides kept", async () => {
  const saved = await server.app.inject({
    method: "PUT",
    url: "/api/settings",
    headers: { cookie },
    payload: { geminiApiKey: "a-test-key", opsVoice: "Puck" },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const { live, connect } = fakeLive();
  const voice = new OpsVoice(server.ops, brain, server.settings, connect);
  const socket = fakeSocket();
  await voice.relay(socket as never, owner, teamId, null);
  assert.ok(socket.events.some((event) => event.type === "ready"));
  const jobId = socket.events.find((event) => event.type === "job")?.jobId as string;
  assert.ok(jobId);

  // What it was given: audio out, the Ops brief with how to speak, the same tools, the chosen voice.
  const given = live.config as {
    responseModalities: string[];
    systemInstruction: string;
    tools: { functionDeclarations: { name: string }[] }[];
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
  };
  assert.deepEqual(given.responseModalities, ["AUDIO"]);
  assert.match(given.systemInstruction, /You are talking aloud now, live/);
  assert.match(given.systemInstruction, /voice does not approve/);
  const names = given.tools[0]?.functionDeclarations.map((tool) => tool.name) ?? [];
  for (const name of ["list_machines", "propose_plan", "run_step", "finish_job"]) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(given.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");

  // The microphone: well-formed frames go on, anything else is dropped.
  socket.frame(1600);
  socket.frame(1601);
  socket.frame(100_000);
  assert.equal(live.audioIn, 1);

  // The person speaks, Ops looks (through the gate), answers aloud, the turn ends.
  live.emit({ serverContent: { inputTranscription: { text: "Which machines do we have?" } } });
  live.emit({ toolCall: { functionCalls: [{ id: "c1", name: "list_machines", args: {} }] } });
  live.emit({
    toolCall: { functionCalls: [{ id: "c2", name: "raise_trust_to_oncall", args: {} }] },
  });
  live.emit({ serverContent: { outputTranscription: { text: "You have no machines yet." } } });
  live.emit({
    serverContent: {
      modelTurn: {
        parts: [
          {
            inlineData: {
              mimeType: "audio/pcm;rate=24000",
              data: Buffer.alloc(4800).toString("base64"),
            },
          },
        ],
      },
    },
  });
  live.emit({
    serverContent: { turnComplete: true },
    usageMetadata: { promptTokenCount: 900, responseTokenCount: 60 },
  });
  await settle();

  assert.equal(socket.audioOut, 4800, "Ops's voice reached the browser");
  assert.ok(
    socket.events.some((event) => event.type === "working" && event.tool === "list_machines"),
  );
  assert.match(String(live.toolResponses[0]?.response?.output), /machines/);
  assert.equal(live.toolResponses[0]?.id, "c1");
  assert.match(String(live.toolResponses[1]?.response?.output), /no action|not|Refused/i);
  assert.ok(socket.events.some((event) => event.type === "turn_complete"));

  const view = await server.ops.engineerView(jobId);
  assert.equal(view.request, "Which machines do we have?");
  assert.deepEqual(
    view.messages.map((message) => `${message.role}: ${message.text}`),
    ["person: 🎙 Which machines do we have?", "ops: You have no machines yet."],
  );
  assert.equal(view.tokens, 960);

  socket.close();
  await settle();
  assert.equal(brain.validToken(undefined), false);
});

test("while Ops is paused, talking live does not start", async () => {
  await server.app.inject({
    method: "PATCH",
    url: `/api/teams/${teamId}/ops`,
    headers: { cookie },
    payload: { paused: true },
  });
  const { connect } = fakeLive();
  const voice = new OpsVoice(server.ops, brain, server.settings, connect);
  const socket = fakeSocket();
  await voice.relay(socket as never, owner, teamId, null);
  assert.match(String(socket.events.find((event) => event.type === "error")?.message), /paused/);
  await server.app.inject({
    method: "PATCH",
    url: `/api/teams/${teamId}/ops`,
    headers: { cookie },
    payload: { paused: false },
  });
});

test("the live route refuses another site and a stranger", async () => {
  const address = await server.app.listen({ port: 0, host: "127.0.0.1" });
  const { WebSocket } = await import("ws");
  const url = `${address.replace("http", "ws")}/ws/ops/${teamId}`;
  const closeCode = (headers: Record<string, string>) =>
    new Promise<number>((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => undefined);
    });
  assert.equal(await closeCode({ cookie, origin: "https://evil.example" }), 4403);
  assert.equal(await closeCode({ origin: address }), 4401);
});

test("'on screen' is true: show_on_screen puts the details in the conversation; after a finished job, talk goes to a new one", async () => {
  const { live, connect } = fakeLive();
  const voice = new OpsVoice(server.ops, brain, server.settings, connect);
  const socket = fakeSocket();
  await voice.relay(socket as never, owner, teamId, null);
  const given = live.config as { tools: { functionDeclarations: { name: string }[] }[] };
  assert.ok(given.tools[0]?.functionDeclarations.some((tool) => tool.name === "show_on_screen"));
  const first = socket.events.find((event) => event.type === "job")?.jobId as string;

  live.emit({ serverContent: { inputTranscription: { text: "What is going on with crowpus?" } } });
  live.emit({
    toolCall: {
      functionCalls: [
        {
          id: "s1",
          name: "show_on_screen",
          args: {
            title: "crowpus: status",
            details: "- version 3, live\n- no errors in the last hour",
          },
        },
      ],
    },
  });
  live.emit({
    serverContent: { outputTranscription: { text: "It's running; the details are on screen." } },
  });
  live.emit({ serverContent: { turnComplete: true } });
  await settle();
  assert.match(String(live.toolResponses.at(-1)?.response?.output), /on the person's screen/);
  const shown = await server.ops.engineerView(first);
  assert.ok(
    shown.messages.some(
      (message) =>
        message.role === "ops" && /\*\*crowpus: status\*\*[\s\S]*version 3/.test(message.text),
    ),
    JSON.stringify(shown.messages),
  );

  // Questions alone do not end it, whatever the model tries.
  live.emit({
    toolCall: { functionCalls: [{ id: "f1", name: "finish_job", args: { outcome: "Answered." } }] },
  });
  await settle();
  assert.match(String(live.toolResponses.at(-1)?.response?.output), /only questions/);
  assert.equal((await server.ops.engineerView(first)).stage !== "done", true);

  // The job ends; what is said next is not lost: it starts a new job, named by those words.
  await server.ops.finish(first, { outcome: "Answered." });
  live.emit({ serverContent: { inputTranscription: { text: "Now restart it please." } } });
  live.emit({ serverContent: { outputTranscription: { text: "I'll plan that." } } });
  live.emit({ serverContent: { turnComplete: true } });
  await settle();
  const next = socket.events.filter((event) => event.type === "job").at(-1)?.jobId as string;
  assert.notEqual(next, first);
  const view = await server.ops.engineerView(next);
  assert.equal(view.request, "Now restart it please.");
  assert.equal(view.messages[0]?.text, "🎙 Now restart it please.");
  socket.close();
});
