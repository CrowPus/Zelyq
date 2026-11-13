import { GoogleGenAI, type LiveServerMessage, Modality, type Session } from "@google/genai";
import type { User } from "@zelyq/core";
import type { SettingsService } from "../settings.js";
import type { OpsBrain } from "./brain.js";
import type { OpsService } from "./service.js";

/**
 * Talking to Ops live (like Nia in Control Tower): the browser streams the
 * microphone over a WebSocket to this server, which relays it to Gemini Live
 * and plays Ops's own voice back. Gemini hears speech directly, so there is no
 * transcription step and no OpenAI. Ops works through the same tools and the
 * same gate as when it is typed to; a plan still waits for a person's Approve
 * on screen. What both said is kept in the job, as text, like typed messages.
 */

/** The voices Gemini Live speaks with. */
export const OPS_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr"];
/** 200 ms of 16 kHz 16-bit mono audio, the most one frame from the browser may carry. */
const FRAME_LIMIT = 6400;
const PLACEHOLDER = "Talking with Ops";

/** The part of a WebSocket this relay uses (ws, as @fastify/websocket gives it). */
export interface VoiceSocket {
  readyState: number;
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): void;
  on(event: "close", listener: () => void): void;
}

export type LiveConnect = (options: {
  apiKey: string;
  model: string;
  config: Record<string, unknown>;
  callbacks: {
    onmessage: (message: LiveServerMessage) => void;
    onerror: (error: unknown) => void;
    onclose: () => void;
  };
}) => Promise<
  Pick<Session, "sendRealtimeInput" | "sendClientContent" | "sendToolResponse" | "close">
>;

const geminiLive: LiveConnect = async ({ apiKey, model, config, callbacks }) =>
  new GoogleGenAI({ apiKey }).live.connect({
    model,
    config,
    callbacks: {
      onmessage: callbacks.onmessage,
      onerror: (event) => callbacks.onerror(event),
      onclose: () => callbacks.onclose(),
    },
  });

export class OpsVoice {
  constructor(
    private readonly ops: OpsService,
    private readonly brain: OpsBrain,
    private readonly settings: SettingsService,
    private readonly connect: LiveConnect = geminiLive,
  ) {}

  /** One live conversation, from the first frame to the socket closing. */
  async relay(
    socket: VoiceSocket,
    user: User,
    teamId: string,
    jobId: string | null,
  ): Promise<void> {
    const emit = (value: Record<string, unknown>) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(value));
    };
    const fail = (message: string) => {
      emit({ type: "error", message });
      socket.close(1000, "done");
    };

    const engineer = await this.ops.engineers.find(teamId);
    if (!engineer) return fail("Set Ops up for this team first.");
    if (engineer.paused) return fail("Ops is paused. Resume it on the Settings tab.");
    if (engineer.monthlyTokenCap !== null) {
      const used = await this.ops.engineers.tokensThisMonth(teamId);
      if (used >= engineer.monthlyTokenCap) {
        return fail("Ops has used this month's limit. An admin can raise it on the Settings tab.");
      }
    }
    const apiKey = (await this.settings.apiKeyFor("google")).trim();
    if (!apiKey) {
      return fail(
        "Talking live uses Gemini. Add a Google AI key in Settings → Model (it does not change the model Zelyq builds with).",
      );
    }

    // The conversation's job: the one open on the page, or a new one named by the first words.
    let job = jobId ? await this.ops.getJob(user, teamId, jobId).catch(() => null) : null;
    if (!job || ["done", "failed", "stopped"].includes(job.stage)) {
      job = await this.ops.startJob(user, teamId, { request: PLACEHOLDER }, "page", false);
    }
    let current = job.id;
    let named = job.request !== PLACEHOLDER;
    let token = this.brain.openVoice(teamId, current);
    emit({ type: "job", jobId: current });

    let said = "";
    let answered = "";
    let session: Awaited<ReturnType<LiveConnect>> | null = null;
    let ended = false;

    /** A finished job does not take more work: the next request starts a new one. */
    const liveJob = async () => {
      const view = await this.ops.engineerView(current);
      if (!["done", "failed", "stopped"].includes(view.stage)) return;
      this.brain.closeVoice(token);
      const next = await this.ops.startJob(
        user,
        teamId,
        { request: said.trim() || PLACEHOLDER },
        "page",
        false,
      );
      current = next.id;
      named = said.trim() !== "";
      token = this.brain.openVoice(teamId, current);
      emit({ type: "job", jobId: current });
    };

    /** The end of a turn: both sides are kept in the job, as text. */
    const keepTurn = async () => {
      const person = said.trim();
      const reply = answered.trim();
      said = "";
      answered = "";
      if (person) {
        if (!named) {
          await this.ops.renameRequest(current, person);
          named = true;
        }
        await this.ops
          .addPersonMessage(user, teamId, current, `🎙 ${person}`)
          .catch(() => undefined);
      }
      if (reply) await this.ops.say(current, reply).catch(() => undefined);
    };

    const onMessage = async (message: LiveServerMessage) => {
      const content = message.serverContent;
      if (content?.inputTranscription?.text) {
        said += content.inputTranscription.text;
        emit({ type: "transcript", role: "person", text: content.inputTranscription.text });
      }
      if (content?.outputTranscription?.text) {
        answered += content.outputTranscription.text;
        emit({ type: "transcript", role: "ops", text: content.outputTranscription.text });
      }
      for (const part of content?.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (data && part.inlineData?.mimeType?.startsWith("audio/") && socket.readyState === 1) {
          socket.send(Buffer.from(data, "base64"));
        }
      }
      if (content?.interrupted) emit({ type: "interrupted" });
      if (content?.turnComplete) {
        await keepTurn();
        emit({ type: "turn_complete" });
      }
      if (message.usageMetadata) {
        const input = message.usageMetadata.promptTokenCount ?? 0;
        const output = message.usageMetadata.responseTokenCount ?? 0;
        if (input || output) await this.ops.addTokens(current, input, output);
      }
      const calls = message.toolCall?.functionCalls ?? [];
      if (calls.length) {
        await liveJob();
        const responses = [];
        for (const call of calls.slice(0, 6)) {
          emit({ type: "working", tool: call.name });
          let output: string;
          try {
            output = (await this.brain.bridge(token, call.name ?? "", call.args ?? {})).output;
          } catch (error) {
            output = `Refused: ${(error as Error).message}`;
          }
          responses.push({ id: call.id, name: call.name, response: { output } });
        }
        session?.sendToolResponse({ functionResponses: responses });
        emit({ type: "changed" });
      }
    };

    // Messages are handled one at a time, in order: a turn is kept before the next begins.
    let queue = Promise.resolve();
    const handle = (message: LiveServerMessage) => {
      queue = queue.then(() => onMessage(message)).catch(() => undefined);
    };

    const voice = (await this.settings.value("opsVoice")).trim();
    try {
      session = await this.connect({
        apiKey,
        model: (await this.settings.value("opsVoiceModel")).trim() || "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: await this.brain.voicePrompt(teamId, current),
          tools: [
            {
              functionDeclarations: this.brain.voiceTools().map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.input_schema,
              })),
            },
          ],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          ...(OPS_VOICES.includes(voice)
            ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
            : {}),
        },
        callbacks: {
          onmessage: handle,
          onerror: (error) => {
            if (!ended)
              fail(`The voice service stopped: ${String((error as Error)?.message ?? error)}`);
          },
          onclose: () => {
            if (!ended) {
              ended = true;
              emit({ type: "ended" });
              socket.close(1000, "done");
            }
          },
        },
      });
    } catch (error) {
      this.brain.closeVoice(token);
      return fail(`Could not start talking: ${(error as Error).message}`);
    }
    emit({ type: "ready" });

    socket.on("message", (data, isBinary) => {
      if (!session || ended) return;
      if (isBinary) {
        if (data.length === 0 || data.length > FRAME_LIMIT || data.length % 2) return;
        session.sendRealtimeInput({
          audio: { data: data.toString("base64"), mimeType: "audio/pcm;rate=16000" },
        });
        return;
      }
      let parsed: { type?: string; text?: string } = {};
      try {
        parsed = JSON.parse(data.toString("utf8")) as typeof parsed;
      } catch {
        return;
      }
      if (parsed.type === "text" && parsed.text?.trim()) {
        said += parsed.text.trim();
        session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: parsed.text.trim().slice(0, 4000) }] }],
          turnComplete: true,
        });
      } else if (parsed.type === "end") {
        socket.close(1000, "done");
      }
    });
    socket.on("close", () => {
      ended = true;
      void queue.then(() => keepTurn()).catch(() => undefined);
      try {
        session?.close();
      } catch {
        // already closed
      }
      this.brain.closeVoice(token);
    });
  }
}
