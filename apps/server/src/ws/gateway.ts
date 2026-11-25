import {
  type AgentEvent,
  type AttachmentRef,
  type BridgeTokens,
  clientMessageSchema,
  type Message,
  newId,
  type PromptAttachment,
  type Role,
  roleAtLeast,
  stripHeavyToolInputs,
  type ToolCall,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { WebSocket } from "ws";
import type { AccessControl } from "../services/access.js";
import type { AgentClient } from "../services/agent-client.js";
import type { AttachmentService } from "../services/attachments.js";
import type { FigmaExtractService } from "../services/figma-extract.js";
import { parseFigmaLink } from "../services/figma-link.js";
import type { ImageBridge } from "../services/image-bridge.js";
import type { PreviewEnvResolver } from "../services/preview-env.js";
import type { ProductActivity } from "../services/product-activity.js";
import type { ProjectBackendService } from "../services/project-backend.js";
import type { ProjectService } from "../services/projects.js";
import type { SettingsService } from "../services/settings.js";
import type { SupabaseBridge } from "../services/supabase-bridge.js";
import type { UsageService } from "../services/usage.js";
import type { VideoBridge } from "../services/video-bridge.js";

/** What a provider actually knows how to embed as an image. */
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

interface Room {
  projectId: string;
  sessionId: string;
  sockets: Set<WebSocket>;
  /** Cancels the in-flight turn when the user aborts. */
  turn: AbortController | null;
  /** Held from the moment a prompt is accepted until its turn is over. `turn`
   * is only set after several awaits (attachments, tokens, the agent session),
   * and two prompts sent together both got through that gap — found in
   * review, the second person's tokens then cut off the first one's turn. */
  busy: boolean;
  /** Every event broadcast during the running turn, so a tab that opens or
   * reconnects mid-turn is replayed what it missed instead of seeing a
   * conversation with no sign of the build still going. Cleared when the turn
   * ends; see `LIVE_REPLAY_MAX_BYTES`. */
  live: { events: string[]; bytes: number; full: boolean; messageIds: Set<string> };
}

/** Above this, a running turn's replay keeps everything except more text. */
const LIVE_REPLAY_MAX_BYTES = 4_000_000;
/** How often a running turn's reply is saved, so a restart loses little of it. */
const CHECKPOINT_MS = 3_000;
/** Added to a reply whose turn a restart cut off. */
export const INTERRUPTED_NOTE =
  "_Interrupted: Zelyq restarted before this turn finished. What it did up to here is kept. " +
  "Ask again to carry on._";

/** What the chat's own controls picked for one prompt. */
type TurnOverride = {
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
};

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
/** Provider names as people know them, for a message about a missing key. */
const PROVIDER_WORDS: Record<string, string> = {
  anthropic: "Claude",
  google: "Gemini",
  openai: "OpenAI",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  groq: "Groq",
  openrouter: "OpenRouter",
};

export class ChatGateway {
  /** What the team's plan allows (set by the app); none: no limits. */
  limits?: Pick<UsageService, "check" | "touch">;
  /** Product activity: messages to the agent, and how its work ended. */
  activity?: ProductActivity;
  /** Maintenance that pauses building. */
  maintenance?: { requireBuildsAllowed(): Promise<void> };
  /** A team that is not active builds nothing. */
  teamStatus?: { requireRunnable(teamId: string): Promise<void> };
  /** Server errors, grouped: a turn that broke on our side. */
  errors?: { capture(error: unknown, context?: { route?: string; userId?: string }): void };
  private readonly rooms = new Map<string, Room>();

  /** Someone has the app open in an editor, or an AI turn runs on it. */
  inUse(projectId: string): boolean {
    const room = this.rooms.get(projectId);
    return Boolean(room && (room.sockets.size > 0 || room.turn || room.busy));
  }

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
      backend?: ProjectBackendService;
      resolvePreviewEnv: PreviewEnvResolver;
      serverInternalUrl: string;
    },
    /** Image bridge (agent generates images via the server, when the project
     * allows it). `mint` returns null when it does not. */
    private readonly imageGeneration: { bridge: ImageBridge; serverInternalUrl: string },
    /** Video bridge (the agent generates clips and frame sequences via the
     * server, when the project allows it). Separate permission from images. */
    private readonly videoGeneration: { bridge: VideoBridge; serverInternalUrl: string },
    /** `/figma` extraction (proposal 068). `enabled` is false when no Figma
     * OAuth app is configured — a `/figma` message then gets a plain reply. */
    private readonly figma: { extract: FigmaExtractService; enabled: boolean },
  ) {}

  /** Set by the server: an agent turn changed an app's files. */
  appChanged?: (projectId: string) => Promise<unknown>;

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

    // The running turn's replies are saved as it goes, and the replay below
    // rebuilds them, so they are left out of the history here.
    const history = (await this.store.messages.listForSession(session.id)).filter(
      (message) => !(room.busy && room.live.messageIds.has(message.id)),
    );
    send(socket, { type: "connected", sessionId: session.id, projectId: project.id, history });
    // A turn already running (this person reloaded, or another tab started
    // it): catch this tab up, then it streams like the others.
    if (room.busy) {
      for (const event of room.live.events) {
        if (socket.readyState === socket.OPEN) socket.send(event);
      }
    }

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
      // Kept while a turn runs: the turn belongs to the project, not to the
      // tab. Deleting it here lost a running build's progress on a reload,
      // and let a second prompt start beside the first.
      this.releaseIfIdle(room);
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
    override: TurnOverride = {},
  ): Promise<void> {
    if (room.turn || room.busy) {
      this.broadcast(room, {
        type: "error",
        sessionId: room.sessionId,
        code: "conflict",
        message: "A turn is already running. Stop it before sending another prompt.",
        fatal: false,
      });
      return;
    }
    room.busy = true;
    room.live = { events: [], bytes: 0, full: false, messageIds: new Set() };
    try {
      await this.startTurn(room, userId, prompt, override);
    } finally {
      room.busy = false;
      room.live = { events: [], bytes: 0, full: false, messageIds: new Set() };
      this.releaseIfIdle(room);
    }
  }

  private async startTurn(
    room: Room,
    userId: string,
    prompt: string,
    override: TurnOverride = {},
  ): Promise<void> {
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

    // `/figma <link>` (proposal 068): pull the design from Figma server-side —
    // the token never touches the agent — then run the turn against a directive
    // that points at the written `design/<key>/` bundle, with the replica skill
    // force-woven. Extraction failure reports and starts no turn.
    let figmaSkill: string | undefined;
    const figmaLink = parseFigmaLink(prompt);
    if (figmaLink) {
      if ("error" in figmaLink) {
        this.broadcast(room, {
          type: "error",
          sessionId: room.sessionId,
          code: "bad_request",
          message: figmaLink.error,
          fatal: false,
        });
        return;
      }
      if (!this.figma.enabled) {
        this.broadcast(room, {
          type: "error",
          sessionId: room.sessionId,
          code: "bad_request",
          message:
            "Figma isn't set up on this instance — an operator needs to register a Figma OAuth app (ZELYQ_FIGMA_CLIENT_ID / _SECRET).",
          fatal: false,
        });
        return;
      }
      const result = await this.figma.extract.run({
        fileKey: figmaLink.fileKey,
        nodeId: figmaLink.nodeId,
        userId,
        projectId: room.projectId,
      });
      if (!result.ok || !result.directive) {
        this.broadcast(room, {
          type: "error",
          sessionId: room.sessionId,
          code: "bad_request",
          message: result.error ?? "Figma extraction failed.",
          fatal: false,
        });
        return;
      }
      promptForAgent = figmaLink.rest
        ? `${result.directive}\n\n${figmaLink.rest}`
        : result.directive;
      figmaSkill = "complete-replica-engineering";
      this.activity?.feature("figma", { userId, projectId: room.projectId });
      this.log.info(result.summary ?? "figma extract ok");
    }

    const effectiveSkills = figmaSkill
      ? [...new Set([...(override.skills ?? []), figmaSkill])]
      : override.skills;

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
        effectiveSkills?.length || override.agents?.length || override.plugins?.length
          ? {
              skills: effectiveSkills ?? [],
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
    // Minted for whoever sent this prompt, and sent with it — see `bridgeTokens`
    // in the prompt schema.
    let bridgeTokens: BridgeTokens = {};
    try {
      // Provider, model, and key come from settings, so a key entered in the
      // app reaches the agent. Without this the agent can only work when its
      // own environment happens to hold a key, which makes the settings screen
      // look like it does nothing. The live value, always — never a session's
      // own stored one, which is only ever what it happened to be created
      // with and never updates itself. Preferring the stored value over what
      // settings say now would pin every session to its original provider
      // forever.
      // The app's team: its own settings and keys, from here to the end of this turn.
      const teamId = (await this.store.projects.findById(room.projectId))?.teamId ?? null;
      this.settings.enterTeam(teamId);
      // Over the team's storage: the agent writes no more until it has room again.
      if (teamId) await this.limits?.check(teamId, "storageMb", 0);
      this.limits?.touch(room.projectId);
      // A paused, read-only or suspended team builds nothing.
      if (teamId) await this.teamStatus?.requireRunnable(teamId);
      // A maintenance window that pauses building: said in its own words.
      await this.maintenance?.requireBuildsAllowed();
      const settingsProvider = await this.settings.value("provider");
      // A pick from the chat's own model control wins over the instance
      // default for this turn onward. Omitted means what it always meant:
      // the live setting.
      const provider = override.provider ?? settingsProvider;
      const pickedDifferentProvider = provider !== settingsProvider;
      // The team's own key first; the server's only when this team may use it.
      const apiKey = await this.settings.apiKeyFor(provider, teamId);
      const authMode = await this.settings.authModeFor(provider);
      if (!apiKey && teamId && !(await this.settings.serverKeysFor(teamId))) {
        throw new ZelyqError(
          "model_error",
          `Your team has no ${PROVIDER_WORDS[provider] ?? provider} key yet. A team admin adds one on the Team page, under AI keys.`,
          { reason: "no_key" },
        );
      }
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
      const requestedModel =
        override.model ?? (pickedDifferentProvider ? "" : await this.settings.modelFor(provider));
      const model =
        provider === "openai"
          ? await this.settings.resolveOpenAIModel(requestedModel)
          : provider === "anthropic"
            ? await this.settings.resolveAnthropicModel(requestedModel)
            : provider === "google"
              ? await this.settings.resolveGoogleModel(requestedModel)
              : requestedModel;
      const baseUrl =
        provider === "openai"
          ? await this.settings.openAIBaseUrl()
          : provider === "anthropic"
            ? await this.settings.anthropicBaseUrl()
            : provider === "google"
              ? await this.settings.googleBaseUrl()
              : pickedDifferentProvider
                ? ""
                : await this.settings.value("modelBaseUrl");
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
      const [bridgeToken, supabasePreviewEnv, imageGenerate, videoGenerate] = await Promise.all([
        this.supabase.bridge.mint(room.sessionId, room.projectId, userId),
        this.supabase.resolvePreviewEnv(room.projectId),
        // Null unless this project has image generation switched on AND the
        // instance has a provider configured.
        this.imageGeneration.bridge.mint(room.sessionId, room.projectId, userId),
        // Null unless this project has video generation switched on AND a
        // provider is configured. A separate permission from images.
        this.videoGeneration.bridge.mint(room.sessionId, room.projectId, userId),
      ]);
      // Without a generation grant the agent still gets a library token: it can
      // list and place what the person already made in Studio, which costs
      // nothing, but every route that calls a provider refuses it.
      const imageToken =
        imageGenerate ??
        (await this.imageGeneration.bridge.mintLibrary(room.sessionId, room.projectId, userId));
      const videoToken =
        videoGenerate ??
        (await this.videoGeneration.bridge.mintLibrary(room.sessionId, room.projectId, userId));
      const previewToken = this.supabase.backend?.mint(room.sessionId, room.projectId, userId);
      bridgeTokens = {
        ...(bridgeToken ? { supabase: bridgeToken } : {}),
        ...(previewToken ? { preview: previewToken } : {}),
        ...(imageToken ? { image: imageToken } : {}),
        ...(videoToken ? { video: videoToken } : {}),
      };

      // Which stack this project is on, so the agent's prompt describes
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
        // Always sent, even empty: the key comes from Settings (typed or
        // from Vault) and nowhere else. Omitting it would let the agent fall
        // back to whatever key its own environment happens to hold.
        apiKey: apiKey ?? "",
        ...(authMode !== "api_key" ? { authMode } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        ...(anthropicWorkspaceId ? { anthropicWorkspaceId } : {}),
        ...(bridgeToken
          ? { supabaseBridge: { url: this.supabase.serverInternalUrl, token: bridgeToken } }
          : {}),
        ...(imageToken
          ? {
              imageBridge: {
                url: this.imageGeneration.serverInternalUrl,
                token: imageToken,
                generate: Boolean(imageGenerate),
              },
            }
          : {}),
        ...(videoToken
          ? {
              videoBridge: {
                url: this.videoGeneration.serverInternalUrl,
                token: videoToken,
                generate: Boolean(videoGenerate),
              },
            }
          : {}),
        ...(Object.keys(supabasePreviewEnv).length > 0 ? { supabasePreviewEnv } : {}),
        ...(previewToken
          ? { previewBridge: { url: this.supabase.serverInternalUrl, token: previewToken } }
          : {}),
        template: stackInfo.template,
        ...(stackInfo.stack ? { stack: stackInfo.stack } : {}),
        ...(stackInfo.agentSkill ? { agentSkill: stackInfo.agentSkill } : {}),
        ...(stackInfo.projectName ? { projectName: stackInfo.projectName } : {}),
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
      this.activity?.record("agent.build_finished", {
        userId,
        projectId: room.projectId,
        detail: {
          ok: false,
          reason:
            (error as { details?: { reason?: string } }).details?.reason ??
            (error as { code?: string }).code ??
            "setup_failed",
        },
      });
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

    // Product activity: a message to the agent, and later how the work ended.
    const turnStarted = Date.now();
    const turnMode = override.autoMode
      ? "auto"
      : override.architectMode
        ? "architect"
        : override.engineerMode
          ? "engineer"
          : "chat";
    let turnOk = true;
    let turnEnded = false;
    let turnReason: string | undefined;
    this.activity?.record("agent.message", {
      userId,
      projectId: room.projectId,
      detail: { mode: turnMode },
    });

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

    // The one git condition that *does* stop a turn. An unfinished merge or a
    // tree with conflict markers in it is not a state to let an agent write
    // into: it would edit half-merged files, and the commit at the end of the
    // turn would put the markers into the history and then into a
    // collaborator's checkout. Best-effort everywhere else, deliberately
    // blocking here.
    try {
      await this.projects.git.assertCommittable(room.projectId);
    } catch (error) {
      this.broadcast(room, {
        type: "error",
        sessionId: room.sessionId,
        code: "git_conflict",
        message: (error as Error).message,
        fatal: false,
      });
      await this.store.sessions.setStatus(room.sessionId, "idle");
      await this.store.projects.setStatus(room.projectId, "ready");
      room.turn = null;
      return;
    }

    // One message per agent turn. A prompt is usually exactly one turn, but an
    // Auto Mode run streams several — one per pass — down the same request.
    // Building a single message across all of them repeated every earlier
    // pass's text inside each later one, saved the whole run as one message,
    // and counted only the last pass's tokens (each overwrote the one before).
    const newAssistant = (snapshot: string | null): Message => ({
      id: newId("message"),
      sessionId: room.sessionId,
      role: "assistant",
      content: "",
      thinking: null,
      toolCalls: [],
      attachments: [],
      snapshotId: snapshot,
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      usageSchema: 1,
      createdAt: new Date().toISOString(),
    });
    let assistant = newAssistant(snapshotId);
    let toolCalls = new Map<string, ToolCall>();
    let turnsSeen = 0;
    // Whether `assistant` is already saved — set at each turn's end, cleared
    // when the next turn begins, so the `finally` below saves only a turn that
    // ended without one (an abort, an error mid-stream).
    let saved = false;
    // Whether `assistant` has a row yet. The message is written while the turn
    // runs, not only when it ends: a restart mid-turn used to lose everything
    // the agent had said and done, and startup can only mark a turn
    // interrupted if something of it is there.
    let written = false;
    let lastCheckpoint = 0;
    let checkpointTimer: NodeJS.Timeout | null = null;
    // One write at a time, in order: a checkpoint still running must not land
    // after the final save and put back an older copy.
    let writing: Promise<void> = Promise.resolve();
    const writeNow = async (): Promise<void> => {
      // Persist without the whole-file bodies in write_file / edit_file inputs:
      // the transcript never shows them, and a session rebuilt from this
      // history would otherwise recarry ~68% of the tool-call bytes for content
      // that is already on disk. The live broadcast kept the full copy.
      assistant.toolCalls = stripHeavyToolInputs([...toolCalls.values()]);
      if (!written) {
        written = true;
        room.live.messageIds.add(assistant.id);
        await this.store.messages.append(assistant);
        return;
      }
      await this.store.messages.update(assistant.id, {
        content: assistant.content,
        thinking: assistant.thinking,
        toolCalls: assistant.toolCalls,
        tokensIn: assistant.tokensIn,
        tokensOut: assistant.tokensOut,
        cacheReadTokens: assistant.cacheReadTokens,
        cacheCreationTokens: assistant.cacheCreationTokens,
        usageSchema: assistant.usageSchema,
      });
    };
    const write = (): Promise<void> => {
      const next = writing.then(writeNow);
      writing = next.catch(() => undefined);
      return next;
    };
    /**
     * Saves the reply so far at most every few seconds — on a timer, so a turn
     * that goes quiet (a long install, a slow model) still has its last words
     * saved. Never a reason to fail the turn.
     */
    const checkpoint = (): void => {
      if (saved || checkpointTimer) return;
      const wait = Math.max(0, CHECKPOINT_MS - (Date.now() - lastCheckpoint));
      checkpointTimer = setTimeout(() => {
        checkpointTimer = null;
        if (saved) return;
        lastCheckpoint = Date.now();
        write().catch((error) => this.log.error(error, "could not save the turn so far"));
      }, wait);
    };
    const save = async (): Promise<void> => {
      if (checkpointTimer) clearTimeout(checkpointTimer);
      checkpointTimer = null;
      if (saved) return;
      saved = true;
      await write();
      await this.store.sessions.addUsage(room.sessionId, assistant.tokensIn, assistant.tokensOut);
    };

    try {
      for await (const event of this.agent.prompt(
        room.sessionId,
        promptForAgent,
        room.turn.signal,
        imageAttachments,
        effectiveSkills,
        override.plugins,
        override.agents,
        bridgeTokens,
        snapshotId ?? undefined,
      )) {
        if (event.type === "turn.end") turnEnded = true;
        if (event.type === "error") {
          turnOk = false;
          turnReason ??= (event as { code?: string }).code;
        }
        // The agent builds its own copy of the finished message, and it does not
        // know about the snapshot this server took before the turn. Broadcasting
        // the agent's copy meant the undo control only appeared after a reload.
        // A later turn in the same request is an Auto Mode pass. It gets a
        // message of its own, and an undo point of its own taken now — between
        // passes — so "Undo this turn" on it rolls back that pass alone.
        if (event.type === "turn.start") {
          turnsSeen += 1;
          if (turnsSeen > 1) {
            // A pass that ended in an error sends no `turn.end`, and Auto Mode
            // can still carry on after it. Keep what it did before starting
            // the next one — found in review: its text, tool calls and tokens
            // were dropped.
            await save();
            let passSnapshot: string | null = null;
            try {
              passSnapshot = (
                await this.projects.snapshot(room.projectId, `Before: Auto Mode pass ${turnsSeen}`)
              ).id;
            } catch (error) {
              this.log.error(error, "could not snapshot before an Auto Mode pass");
            }
            assistant = newAssistant(passSnapshot);
            toolCalls = new Map<string, ToolCall>();
            saved = false;
            written = false;
            lastCheckpoint = 0;
          }
        }

        if (event.type === "turn.end") {
          assistant.toolCalls = [...toolCalls.values()];
          this.broadcast(room, { ...event, message: { ...assistant } });
          await save();
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
            // This turn's figures, NOT the session-cumulative `tokensIn` /
            // `tokensOut` the live gauge uses. Storing the cumulative here and
            // then ADDING it to the session total below made
            // `sessions.tokens_in` grow with the square of the turn count —
            // historical rows are ~2.1x inflated and cannot be rebaselined.
            // The `??` keeps an older agent talking to a newer server working,
            // at the old (wrong) behaviour rather than at zero.
            assistant.tokensIn = event.turnTokensIn ?? event.tokensIn;
            assistant.tokensOut = event.turnTokensOut ?? event.tokensOut;
            assistant.cacheReadTokens = event.turnCacheReadTokens ?? 0;
            assistant.cacheCreationTokens = event.turnCacheCreationTokens ?? 0;
            assistant.usageSchema = event.turnTokensIn === undefined ? 0 : 1;
            break;
          default:
            break;
        }
        checkpoint();
      }
    } catch (error) {
      turnOk = false;
      turnReason ??= "internal";
      this.errors?.capture(error, { route: "agent turn", userId });
      this.broadcast(room, {
        type: "error",
        sessionId: room.sessionId,
        code: "internal",
        message: (error as Error).message,
        fatal: false,
      });
    } finally {
      // A turn that never reached its end (aborted, or the stream failed) is
      // still saved, so what it did stays in the transcript.
      await save();
      await this.store.sessions.setStatus(room.sessionId, "idle");
      await this.store.projects.setStatus(room.projectId, "ready");
      if (this.activity) {
        const session = await this.store.sessions.findById(room.sessionId).catch(() => null);
        this.activity.record("agent.build_finished", {
          userId,
          projectId: room.projectId,
          detail: {
            ok: turnOk && turnEnded && !room.turn?.signal.aborted,
            seconds: (Date.now() - turnStarted) / 1000,
            provider: session?.provider,
            mode: turnMode,
            reason: room.turn?.signal.aborted
              ? "stopped"
              : turnOk && turnEnded
                ? undefined
                : (turnReason ?? "no_end"),
          },
        });
      }
      // Best-effort, same as ensureGitRepo above — a commit is a courtesy
      // on top of the turn, never a reason to have failed it.
      try {
        const commit = await this.projects.commitTurn(room.projectId, prompt);
        // Pipelines that run "when the app changes" start now (never failing the turn).
        if (commit.committed) {
          void this.appChanged?.(room.projectId).catch((error) =>
            this.log.error(error, "could not start the app's pipelines"),
          );
        }
        // Said now rather than discovered at push time. The count costs no
        // network — it reads refs already fetched — so a turn never waits on a
        // git host to produce it, and somebody collaborating finds out that the
        // remote moved on while they still have the context of what they just
        // asked for.
        if (commit.committed && commit.behind > 0) {
          this.broadcast(room, {
            type: "notice",
            sessionId: room.sessionId,
            code: "git_behind",
            message:
              `The remote has ${commit.behind} commit(s) this project does not have yet. Pull ` +
              "them in before pushing, or the push will be refused.",
          });
        }
      } catch (error) {
        this.log.error(error, "could not commit the turn's changes");
      }
      room.turn = null;
    }
  }

  /**
   * At startup, every session still marked running was cut off by the
   * restart: nothing in this process is running it. Its reply so far is kept
   * and marked interrupted (or one saying so is added, if the restart came
   * before the first word), and the session and project are released — a
   * project left "building" refused outside agents for good.
   */
  async recoverInterruptedTurns(): Promise<number> {
    const stranded = await this.store.sessions.listByStatus("running");
    for (const session of stranded) {
      try {
        const last = await this.store.messages.lastForSession(session.id);
        if (last?.role === "assistant") {
          if (!last.content.includes(INTERRUPTED_NOTE)) {
            const content = last.content.trim()
              ? `${last.content.trimEnd()}\n\n${INTERRUPTED_NOTE}`
              : INTERRUPTED_NOTE;
            await this.store.messages.update(last.id, { content });
          }
        } else if (last) {
          await this.store.messages.append({
            id: newId("message"),
            sessionId: session.id,
            role: "assistant",
            content: INTERRUPTED_NOTE,
            thinking: null,
            toolCalls: [],
            attachments: [],
            snapshotId: null,
            tokensIn: 0,
            tokensOut: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            usageSchema: 1,
            createdAt: new Date().toISOString(),
          });
        }
        await this.store.sessions.setStatus(session.id, "idle");
        const project = await this.store.projects.findById(session.projectId);
        if (project?.status === "building") {
          await this.store.projects.setStatus(session.projectId, "ready");
        }
      } catch (error) {
        this.log.error(error, "could not recover an interrupted turn");
      }
    }
    if (stranded.length) {
      this.log.info(`marked ${stranded.length} turn(s) cut off by the restart as interrupted`);
    }
    return stranded.length;
  }

  private roomFor(projectId: string, sessionId: string): Room {
    const existing = this.rooms.get(projectId);
    if (existing) return existing;
    const room: Room = {
      projectId,
      sessionId,
      sockets: new Set(),
      turn: null,
      busy: false,
      live: { events: [], bytes: 0, full: false, messageIds: new Set() },
    };
    this.rooms.set(projectId, room);
    return room;
  }

  /**
   * Files changed by something other than this room's own turn — an outside
   * agent through the agent gateway. Anyone with the app open refreshes the
   * tree and open editors, the same way they do after a turn.
   */
  notifyFilesChanged(projectId: string, paths: string[]): void {
    const room = this.rooms.get(projectId);
    if (room) this.broadcast(room, { type: "files.changed", sessionId: room.sessionId, paths });
  }

  private broadcast(room: Room, event: AgentEvent): void {
    const payload = JSON.stringify(event);
    if (room.busy) {
      const isText = event.type === "text.delta" || event.type === "thinking.delta";
      if (room.live.bytes + payload.length > LIVE_REPLAY_MAX_BYTES) room.live.full = true;
      if (!room.live.full || !isText) {
        room.live.events.push(payload);
        room.live.bytes += payload.length;
      }
    }
    for (const socket of room.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  /** A room with nobody watching and no turn running is forgotten. */
  private releaseIfIdle(room: Room): void {
    if (
      room.sockets.size === 0 &&
      !room.busy &&
      !room.turn &&
      this.rooms.get(room.projectId) === room
    ) {
      this.rooms.delete(room.projectId);
    }
  }
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}
