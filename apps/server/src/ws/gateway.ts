import {
  type AgentEvent,
  type AttachmentRef,
  clientMessageSchema,
  type Message,
  newId,
  type PromptAttachment,
  type Role,
  roleAtLeast,
  type ToolCall,
  type User,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { WebSocket } from "ws";
import type { AccessControl } from "../services/access.js";
import type { AgentClient } from "../services/agent-client.js";
import type { AttachmentService } from "../services/attachments.js";
import type { PreviewEnvResolver } from "../services/preview-env.js";
import type { ProjectService } from "../services/projects.js";
import type { SettingsService } from "../services/settings.js";
import type { SupabaseBridge } from "../services/supabase-bridge.js";

/** What a provider actually knows how to embed as an image. */
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

interface Room {
  projectId: string;
  sessionId: string;
  sockets: Set<WebSocket>;
  /** Cancels the in-flight turn when the user aborts. */
  turn: AbortController | null;
}

/** What one connection is allowed to do, decided once at handshake time. */
interface Connection {
  user: User;
  role: Role;
}

/**
 * Fan-out for one project's editor.
 *
 * Everyone looking at a project shares a room, so a turn started in one tab
 * streams to all of them. The gateway is deliberately a relay: it forwards the
 * agent's events verbatim and only steps in to persist messages, which keeps
 * the browser and the agent speaking exactly the same vocabulary.
 */
export class ChatGateway {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly store: Store,
    private readonly projects: ProjectService,
    private readonly agent: AgentClient,
    private readonly access: AccessControl,
    private readonly settings: SettingsService,
    private readonly attachments: AttachmentService,
    private readonly log: { info(msg: string): void; error(obj: unknown, msg?: string): void },
    /** Supabase bridge (agent applies migrations via the server). */
    private readonly supabase: {
      bridge: SupabaseBridge;
      resolvePreviewEnv: PreviewEnvResolver;
      serverInternalUrl: string;
    },
  ) {}

  /**
   * The browser sends its session cookie with the upgrade request, so the
   * socket is authenticated exactly like an HTTP call. A viewer may watch a
   * conversation; only an editor may start one.
   */
  async handleConnection(socket: WebSocket, projectId: string, user: User): Promise<void> {
    const { project, role } = await this.access.requireProject(user, projectId, "viewer");
    const connection: Connection = { user, role };
    const session = await this.projects.ensureSession(project.id);
    const room = this.roomFor(project.id, session.id);
    room.sockets.add(socket);

    const history = await this.store.messages.listForSession(session.id);
    send(socket, { type: "connected", sessionId: session.id, projectId: project.id, history });

    socket.on("message", (raw: Buffer) => {
      void this.handleMessage(socket, room, raw, connection).catch((error) => {
        this.log.error(error, "websocket message failed");
        send(socket, {
          type: "error",
          sessionId: room.sessionId,
          code: "internal",
          message: (error as Error).message,
          fatal: false,
        });
      });
    });

    socket.on("close", () => {
      room.sockets.delete(socket);
      if (room.sockets.size === 0) this.rooms.delete(room.projectId);
    });
  }

  private async handleMessage(
    socket: WebSocket,
    room: Room,
    raw: Buffer,
    connection: Connection,
  ): Promise<void> {
    const parsed = clientMessageSchema.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) {
      send(socket, {
        type: "error",
        sessionId: room.sessionId,
        code: "bad_request",
        message: parsed.error.issues[0]?.message ?? "Unrecognised message",
        fatal: false,
      });
      return;
    }

    const message = parsed.data;

    if (message.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }

    // Prompting and aborting both change what the agent is doing, so both are
    // writes. A viewer's socket receives events but cannot drive anything.
    if (!roleAtLeast(connection.role, "editor")) {
      send(socket, {
        type: "error",
        sessionId: room.sessionId,
        code: "forbidden",
        message: "Your role on this team is read-only.",
        fatal: false,
      });
      return;
    }

    if (message.type === "abort") {
      room.turn?.abort();
      await this.agent.abort(room.sessionId);
      return;
    }

    await this.runTurn(room, connection.user.id, message.message, {
      provider: message.provider,
      model: message.model,
      attachmentIds: message.attachments,
      skills: message.skills,
      plugins: message.plugins,
      agents: message.agents,
      engineerMode: message.engineerMode,
      architectMode: message.architectMode,
      autoMode: message.autoMode,
    });
  }

  private async runTurn(
    room: Room,
    userId: string,
    prompt: string,
    /** Picked from the chat's own model control, if at all. */
    override: {
      provider?: string;
      model?: string;
      attachmentIds?: string[];
      /** Picked from the composer's `/` skill picker. */
      skills?: string[];
      /** Picked from the same `/` menu's Plugins section. */
      plugins?: string[];
      /** Picked from the same `/` menu's Agents section — specialist names. */
      agents?: string[];
      /** Engineer Mode toggle. */
      engineerMode?: boolean;
      /** Architect Mode toggle — see 048. */
      architectMode?: boolean;
      /** Auto Mode toggle. Only with architectMode. */
      autoMode?: boolean;
    } = {},
  ): Promise<void> {
    if (room.turn) {
      this.broadcast(room, {
        type: "error",
        sessionId: room.sessionId,
        code: "conflict",
        message: "A turn is already running. Stop it before sending another prompt.",
        fatal: false,
      });
      return;
    }

    // Resolved before anything is persisted, so a bad attachment id refuses
    // the turn cleanly rather than leaving a user message with a reference
    // to something that never actually made it to the model. An image goes
    // to the model as itself; anything else is inlined as text, refused
    // rather than silently mangled if it is not valid UTF-8.
    const attachmentRefs: AttachmentRef[] = [];
    const imageAttachments: PromptAttachment[] = [];
    let promptForAgent = prompt;
    if (override.attachmentIds?.length) {
      let inlinedText = "";
      for (const id of override.attachmentIds) {
        const found = await this.attachments.get(room.projectId, id);
        if (!found) {
          this.broadcast(room, {
            type: "error",
            sessionId: room.sessionId,
            code: "bad_request",
            message: "One of the attached files could not be found. Attach it again.",
            fatal: false,
          });
          return;
        }
        attachmentRefs.push(found.ref);
        if (IMAGE_MIME_TYPES.has(found.ref.mimeType)) {
          imageAttachments.push({
            filename: found.ref.filename,
            mimeType: found.ref.mimeType,
            data: found.data.toString("base64"),
          });
          continue;
        }
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(found.data);
        } catch {
          this.broadcast(room, {
            type: "error",
            sessionId: room.sessionId,
            code: "bad_request",
            message:
              `"${found.ref.filename}" isn't an image or a text file Zelyq can read — attach ` +
              "an image, or a plain text file, instead.",
            fatal: false,
          });
          return;
        }
        inlinedText += `\n\n--- Attached file: ${found.ref.filename} ---\n${text}\n--- End of ${found.ref.filename} ---`;
      }
      promptForAgent = prompt + inlinedText;
    }

    // Persist the user's message before anything can fail, so a crashed turn
    // still leaves a readable transcript. `content` stays exactly what was
    // typed — inlined attachment text is only ever added to what the model
    // sees, never to what the transcript shows was typed.
    const userMessage: Message = {
      id: newId("message"),
      sessionId: room.sessionId,
      role: "user",
      content: prompt,
      thinking: null,
      toolCalls: [],
      attachments: attachmentRefs,
      // Display only — what the composer's `/` menu pointed at. `content`
      // above still holds exactly what was typed. Null when nothing was named.
      mentions:
        override.skills?.length || override.agents?.length || override.plugins?.length
          ? {
              skills: override.skills ?? [],
              agents: override.agents ?? [],
              plugins: override.plugins ?? [],
            }
          : null,
      snapshotId: null,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    };
    await this.store.messages.append(userMessage);

    const history = await this.store.messages.listForSession(room.sessionId);
    try {
      // Provider, model, and key come from settings, so a key entered in the
      // app reaches the agent. Without this the agent can only work when its
      // own environment happens to hold a key, which makes the settings screen
      // look like it does nothing. The live value, always — never a session's
      // own stored one, which is only ever what it happened to be created
      // with and never updates itself. Preferring the stored value over what
      // settings say now would pin every session to its original provider
      // forever.
      const settingsProvider = await this.settings.value("provider");
      // A pick from the chat's own model control wins over the instance
      // default for this turn onward. Omitted means what it always meant:
      // the live setting.
      const provider = override.provider ?? settingsProvider;
      const pickedDifferentProvider = provider !== settingsProvider;
      const apiKey = await this.settings.apiKeyFor(provider);
      // A provider picked from the chat that isn't the settings-configured
      // one has no subscription session detected for it — only ever
      // meaningful for the provider Settings actually names.
      const authMode = pickedDifferentProvider
        ? "api_key"
        : await this.settings.authModeFor(provider);
      // Settings' own `model` and `modelBaseUrl` were configured for
      // whichever provider settings actually names — forwarding either to a
      // different provider picked from the chat would redirect it to a
      // model or endpoint that was never meant for it. Left empty here, the
      // agent falls back to that provider's own registry default.
      //
      // `modelFor` — not `value("model")` — is what handles a connected
      // subscription correctly. A model pinned for whatever provider was
      // configured before (an operator's `ZELYQ_MODEL`, or one typed in by
      // hand) must not ride straight into a newly connected provider's
      // request, but forcing empty unconditionally whenever a subscription
      // is active would also block a model deliberately typed *for* that
      // session. `modelFor` only forces empty when nothing is genuinely
      // stored; a real, deliberate choice always wins regardless of mode.
      const model =
        override.model ?? (pickedDifferentProvider ? "" : await this.settings.modelFor(provider));
      const baseUrl = pickedDifferentProvider ? "" : await this.settings.value("modelBaseUrl");
      // An identity-linked Claude key is rejected without its workspace id.
      // Only meaningful when the turn actually runs on Anthropic.
      const anthropicWorkspaceId =
        provider === "anthropic" ? await this.settings.value("anthropicWorkspaceId") : "";
      // The Settings page's "Reasoning effort" field used to have no effect
      // on any session — every session silently ran on whatever ZELYQ_EFFORT
      // the agent process happened to boot with. Read and forwarded now the
      // same way model/provider already are.
      const effort = await this.settings.value("effort");

      // If this project has a linked Supabase resource, hand
      // the agent a session-scoped capability to apply migrations through the
      // server, plus the project's PUBLIC config for its preview. No secret.
      const [bridgeToken, supabasePreviewEnv] = await Promise.all([
        this.supabase.bridge.mint(room.sessionId, room.projectId, userId),
        this.supabase.resolvePreviewEnv(room.projectId),
      ]);

      // 066 — which stack this project is on, so the agent's prompt describes
      // the right one and (for Expo) force-weaves the RN skill. A vite-react
      // project resolves to `{ template: "vite-react" }` with no `stack` and
      // the agent's default line, byte-identical to before.
      const stackInfo = await this.projects.stackFor(room.projectId);

      const state = await this.agent.ensureSession({
        sessionId: room.sessionId,
        projectId: room.projectId,
        provider,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        engineerMode: override.engineerMode ?? false,
        architectMode: override.architectMode ?? false,
        autoMode: override.autoMode ?? false,
        ...(apiKey ? { apiKey } : {}),
        ...(authMode !== "api_key" ? { authMode } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(anthropicWorkspaceId ? { anthropicWorkspaceId } : {}),
        ...(bridgeToken
          ? { supabaseBridge: { url: this.supabase.serverInternalUrl, token: bridgeToken } }
          : {}),
        ...(Object.keys(supabasePreviewEnv).length > 0 ? { supabasePreviewEnv } : {}),
        template: stackInfo.template,
        ...(stackInfo.stack ? { stack: stackInfo.stack } : {}),
        ...(stackInfo.agentSkill ? { agentSkill: stackInfo.agentSkill } : {}),
        // Everything except the message we just stored — that is the prompt.
        history: history.slice(0, -1),
      });
      // Keeps the stored row an honest record of what actually ran, rather
      // than what it happened to be created with — the same gap that let
      // this go unnoticed in the first place.
      await this.store.sessions.setModel(room.sessionId, state.provider, state.model);
    } catch (error) {
      // Setup failures are the ones users actually hit (no API key, agent
      // down). Reporting the agent's own message beats letting the turn fail
      // later with a misleading 404 from a session that was never created.
      this.broadcast(room, {
        type: "error",
        sessionId: room.sessionId,
        code: (error as { code?: string }).code ?? "runtime_unavailable",
        message: (error as Error).message,
        fatal: false,
      });
      return;
    }

    room.turn = new AbortController();
    await this.store.sessions.setStatus(room.sessionId, "running");
    await this.store.projects.setStatus(room.projectId, "building");

    // Copy the project before the agent touches it, so this turn can be undone.
    // A failure here must not stop the turn — the user asked for work, not for a
    // backup — so the turn simply becomes one that cannot be undone, and says so.
    let snapshotId: string | null = null;
    try {
      const snapshot = await this.projects.snapshot(
        room.projectId,
        `Before: ${prompt.slice(0, 120)}`,
      );
      snapshotId = snapshot.id;
    } catch (error) {
      this.log.error(error, "could not snapshot before the turn");
    }

    // Real, ordinary git, alongside the snapshot above. Same best-effort
    // posture: a project's own git history existing is a
    // courtesy, not something a turn should ever fail over.
    try {
      await this.projects.ensureGitRepo(room.projectId);
    } catch (error) {
      this.log.error(error, "could not initialise git for the project");
    }

    const assistant: Message = {
      id: newId("message"),
      sessionId: room.sessionId,
      role: "assistant",
      content: "",
      thinking: null,
      toolCalls: [],
      attachments: [],
      snapshotId,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    };
    const toolCalls = new Map<string, ToolCall>();

    try {
      for await (const event of this.agent.prompt(
        room.sessionId,
        promptForAgent,
        room.turn.signal,
        imageAttachments,
        override.skills,
        override.plugins,
        override.agents,
      )) {
        // The agent builds its own copy of the finished message, and it does not
        // know about the snapshot this server took before the turn. Broadcasting
        // the agent's copy meant the undo control only appeared after a reload.
        if (event.type === "turn.end") {
          assistant.toolCalls = [...toolCalls.values()];
          this.broadcast(room, { ...event, message: { ...assistant } });
          continue;
        }

        this.broadcast(room, event);

        switch (event.type) {
          case "text.delta":
            assistant.content += event.text;
            break;
          case "thinking.delta":
            assistant.thinking = (assistant.thinking ?? "") + event.text;
            break;
          case "tool.start":
          case "tool.end":
            toolCalls.set(event.call.id, event.call);
            break;
          case "usage":
            assistant.tokensIn = event.tokensIn;
            assistant.tokensOut = event.tokensOut;
            break;
          default:
            break;
        }
      }
    } catch (error) {
      this.broadcast(room, {
        type: "error",
        sessionId: room.sessionId,
        code: "internal",
        message: (error as Error).message,
        fatal: false,
      });
    } finally {
      assistant.toolCalls = [...toolCalls.values()];
      await this.store.messages.append(assistant);
      await this.store.sessions.addUsage(room.sessionId, assistant.tokensIn, assistant.tokensOut);
      await this.store.sessions.setStatus(room.sessionId, "idle");
      await this.store.projects.setStatus(room.projectId, "ready");
      // Best-effort, same as ensureGitRepo above — a commit is a courtesy
      // on top of the turn, never a reason to have failed it.
      try {
        await this.projects.commitTurn(room.projectId, prompt);
      } catch (error) {
        this.log.error(error, "could not commit the turn's changes");
      }
      room.turn = null;
    }
  }

  private roomFor(projectId: string, sessionId: string): Room {
    const existing = this.rooms.get(projectId);
    if (existing) return existing;
    const room: Room = { projectId, sessionId, sockets: new Set(), turn: null };
    this.rooms.set(projectId, room);
    return room;
  }

  private broadcast(room: Room, event: AgentEvent): void {
    for (const socket of room.sockets) send(socket, event);
  }
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}
