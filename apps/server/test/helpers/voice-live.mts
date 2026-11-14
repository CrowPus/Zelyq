/**
 * Run by hand (not part of the suite; needs GEMINI_API_KEY and the network):
 * talks to Ops live through the real Gemini Live, the way the Ops page does,
 * with a stand-in for the browser's socket. A typed line goes in (the same
 * path as speech), and we check: Ops uses a tool through the gate, answers
 * with real audio and words, and the turn is kept in the job.
 * Usage: node --import tsx test/helpers/voice-live.mts
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "@zelyq/db";
import { buildServer } from "../../src/app.js";
import type { ServerConfig } from "../../src/config.js";

const tmp = path.join(os.tmpdir(), `zelyq-voice-live-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "voice.db")}`,
  agentUrl: "http://127.0.0.1:59993",
  provider: "google",
  model: "",
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
    previewPortRange: [4956, 4959],
    previewHost: "127.0.0.1",
  },
} as ServerConfig;

await runMigrations(config.databaseUrl);
const server = await buildServer(config);
const registered = await server.app.inject({
  method: "POST",
  url: "/api/auth/register",
  payload: { email: "founder@example.com", name: "Founder", password: "correct-horse-battery" },
});
const cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload ? { payload: payload as never } : {}),
  });
const teamId = (await call("GET", "/api/teams")).json().teams[0].id as string;
const saved = await call("PUT", "/api/settings", {
  geminiApiKey: process.env.GEMINI_API_KEY,
  ...(process.env.OPS_VOICE_MODEL ? { opsVoiceModel: process.env.OPS_VOICE_MODEL } : {}),
});
if (saved.statusCode !== 200) throw new Error(saved.body);
await call("POST", `/api/teams/${teamId}/ops`);
const user = (await server.store.users.findByEmail("founder@example.com"))!;

// The browser's side of the socket.
const events: Record<string, unknown>[] = [];
let audioBytes = 0;
const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
let closed = false;
const socket = {
  readyState: 1,
  send(data: string | Buffer) {
    if (typeof data === "string") {
      const event = JSON.parse(data) as Record<string, unknown>;
      events.push(event);
      if (event.type !== "transcript") console.log("←", JSON.stringify(event).slice(0, 300));
    } else audioBytes += data.length;
  },
  close(code?: number, reason?: string) {
    if (closed) return;
    closed = true;
    this.readyState = 3;
    console.log("socket closed", code, reason);
    for (const listener of listeners.close ?? []) listener();
  },
  on(event: string, listener: (...args: unknown[]) => void) {
    listeners[event] = [...(listeners[event] ?? []), listener];
  },
};
const say = (text: string) => {
  for (const listener of listeners.message ?? [])
    listener(Buffer.from(JSON.stringify({ type: "text", text })), false);
};

const voice = server.opsVoice;
const started = Date.now();
void voice.relay(socket as never, user as never, teamId, null);
const until = async (check: () => boolean, ms: number) => {
  while (!check() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 200));
  return check();
};
const ready = await until(
  () => events.some((e) => e.type === "ready" || e.type === "error"),
  30_000,
);
console.log("ready:", ready, events.find((e) => e.type === "error") ?? "");
if (events.some((e) => e.type === "ready")) {
  const turn = async (text: string) => {
    const before = events.length;
    const doneBefore = events.filter((e) => e.type === "turn_complete").length;
    say(text);
    await until(() => events.filter((e) => e.type === "turn_complete").length > doneBefore, 90_000);
    // Let a turn that used tools finish its spoken answer.
    await new Promise((r) => setTimeout(r, 6000));
    const mine = events.slice(before);
    console.log(`\n>>> ${text}`);
    console.log(
      "    tools:",
      mine
        .filter((e) => e.type === "working")
        .map((e) => e.tool)
        .join(", ") || "none",
    );
    console.log(
      "    Ops said:",
      mine
        .filter((e) => e.type === "transcript" && e.role === "ops")
        .map((e) => e.text)
        .join(""),
    );
  };
  await turn("Hey, dear.");
  await turn("What environments and apps do we have? Show me the details.");
  const jobId = events.filter((e) => e.type === "job").at(-1)?.jobId as string;
  const view = await server.ops.engineerView(jobId);
  console.log("\nRESULT");
  console.log("audio received:", (audioBytes / 48000).toFixed(1), "s");
  console.log("job messages:");
  for (const m of view.messages)
    console.log(`  ${m.role}: ${m.text.slice(0, 160).replace(/\n/g, " / ")}`);
  console.log("stage:", view.stage, "tokens:", view.tokens);
  for (const listener of listeners.message ?? [])
    listener(Buffer.from(JSON.stringify({ type: "end" })), false);
}
await new Promise((r) => setTimeout(r, 1000));
await server.close();
await fs.rm(tmp, { recursive: true, force: true });
process.exit(0);
