import {
  type AgentEvent,
  clientMessageSchema,
  type Message,
  newId,
  type Role,
  roleAtLeast,
  type ToolCall,
  type User,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { WebSocket } from "ws";
import type { AccessControl } from "../services/access.js";
import type { AgentClient } from "../services/agent-client.js";
import type { ProjectService } from "../services/projects.js";
import type { SettingsService } from "../services/settings.js";

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
    private readonly log: { info(msg: string): void; error(obj: unknown, msg?: string): void },
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

    await this.runTurn(room, message.message);
  }

  private async runTurn(room: Room, prompt: string): Promise<void> {
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

    // Persist the user's message before anything can fail, so a crashed turn
    // still leaves a readable transcript.
    const userMessage: Message = {
      id: newId("message"),
      sessionId: room.sessionId,
      role: "user",
      content: prompt,
      thinking: null,
      toolCalls: [],
      snapshotId: null,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    };
    await this.store.messages.append(userMessage);

    const history = await this.store.messages.listForSession(room.sessionId);
    try {
      const session = await this.store.sessions.findById(room.sessionId);

      // Provider, model, and key come from settings, so a key entered in the
      // app reaches the agent. Without this the agent can only work when its
      // own environment happens to hold a key, which makes the settings screen
      // look like it does nothing.
      const provider = await this.settings.value("provider");
      const model = await this.settings.value("model");
      const apiKey = await this.settings.apiKeyFor(provider);

      await this.agent.ensureSession({
        sessionId: room.sessionId,
        projectId: room.projectId,
        provider: session?.provider ?? provider,
        ...(model ? { model } : {}),
        ...(apiKey ? { apiKey } : {}),
        // Everything except the message we just stored — that is the prompt.
        history: history.slice(0, -1),
      });
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

    const assistant: Message = {
      id: newId("message"),
      sessionId: room.sessionId,
      role: "assistant",
      content: "",
      thinking: null,
      toolCalls: [],
      snapshotId,
      tokensIn: 0,
      tokensOut: 0,
      createdAt: new Date().toISOString(),
    };
    const toolCalls = new Map<string, ToolCall>();

    try {
      for await (const event of this.agent.prompt(room.sessionId, prompt, room.turn.signal)) {
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
