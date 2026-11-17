import fs from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { ProductFeature } from "@zelyq/core";
import { isZelyqError, toError, type User, ZelyqError } from "@zelyq/core";
import { resolveFromRepoRoot } from "@zelyq/core/node";
import { createStore, type Store } from "@zelyq/db";
import { createRuntimeDriver, type RuntimeDriver } from "@zelyq/runtime";
import Fastify, { type FastifyInstance, LogController } from "fastify";
import { ZodError } from "zod";
import type { ServerConfig } from "./config.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerAdminApi } from "./routes/admin-api.js";
import { registerAgentOAuthRoutes } from "./routes/agent-oauth.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerAttachmentRoutes } from "./routes/attachments.js";
import { registerAuthRoutes, SESSION_COOKIE } from "./routes/auth.js";
import { registerDeployRoutes } from "./routes/deploy.js";
import { registerFigmaRoutes } from "./routes/figma.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerGuideRoutes } from "./routes/guide.js";
import { registerImageBridgeRoutes } from "./routes/image-bridge.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerOpsRoutes } from "./routes/ops.js";
import { registerPipelineRoutes } from "./routes/pipelines.js";
import { registerPlanRoutes } from "./routes/plans.js";
import { registerPluginRegistryRoutes } from "./routes/plugin-registry.js";
import { registerPreviewRoutes } from "./routes/preview.js";
import { registerProjectBackendRoutes } from "./routes/project-backend.js";
import { registerProjectVariableRoutes } from "./routes/project-variables.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerSnapshotRoutes } from "./routes/snapshots.js";
import { registerSupabaseBridgeRoutes } from "./routes/supabase-bridge.js";
import { registerSupabaseConnectionRoutes } from "./routes/supabase-connections.js";
import { registerSupportRoutes } from "./routes/support.js";
import { registerTeamRoutes } from "./routes/teams.js";
import { registerVaultRoutes } from "./routes/vault.js";
import { registerVaultKeyRoutes } from "./routes/vault-keys.js";
import { registerVideoBridgeRoutes } from "./routes/video-bridge.js";
import { registerVideoRoutes } from "./routes/videos.js";
import { registerVoiceRoutes } from "./routes/voice.js";
import { AccessControl } from "./services/access.js";
import { AccountService } from "./services/accounts.js";
import { AdminDirectory } from "./services/admin-directory.js";
import { AdminKeyService } from "./services/admin-keys.js";
import { AgentClient } from "./services/agent-client.js";
import { AgentGateway, pipelineGuide } from "./services/agent-gateway.js";
import { AgentOAuthService } from "./services/agent-oauth.js";
import { AgentReferenceStore } from "./services/agent-references.js";
import { AgentService } from "./services/agents.js";
import { AttachmentService } from "./services/attachments.js";
import { AuthService } from "./services/auth.js";
import { DeployService } from "./services/deploy.js";
import { EmailLinkService } from "./services/email-links.js";
import { EventsOut } from "./services/events-out.js";
import { FigmaConnectionService } from "./services/figma-connections.js";
import { FigmaExtractService } from "./services/figma-extract.js";
import { FunctionSecretSync } from "./services/function-secrets.js";
import { ImageAssetStore } from "./services/image-assets.js";
import { ImageBridge } from "./services/image-bridge.js";
import { ImageGenerationService } from "./services/image-generation.js";
import { ensureInspectorScript } from "./services/inspector-script.js";
import { MailService } from "./services/mail.js";
import { MessagesToPeople } from "./services/messages-to-people.js";
import { deepHealth, ErrorTracker, HealthWatch, RequestStats } from "./services/observability.js";
import { missingAccess } from "./services/ops/access.js";
import { ActionList } from "./services/ops/actions.js";
import { OpsBrain } from "./services/ops/brain.js";
import { OPS_ACTIONS } from "./services/ops/catalogue.js";
import { ChannelService } from "./services/ops/channels.js";
import { OpsMailer } from "./services/ops/mailer.js";
import { OpsService } from "./services/ops/service.js";
import { OpsVoice } from "./services/ops/voice.js";
import { CheckService } from "./services/ops/watch/checks.js";
import { PipelineEngine } from "./services/pipelines/engine.js";
import { TeamSshKeyService } from "./services/pipelines/keys.js";
import { PipelinePluginService } from "./services/pipelines/plugins.js";
import { PluginRegistryClient, ZELYQ_REGISTRY_KEYS } from "./services/pipelines/registry.js";
import { RunnerService } from "./services/pipelines/runners.js";
import { PipelineService } from "./services/pipelines/service.js";
import { ToolService } from "./services/pipelines/tools.js";
import { PipelineTriggerService } from "./services/pipelines/triggers.js";
import { makePreviewEnvResolver } from "./services/preview-env.js";
import { ProductActivity } from "./services/product-activity.js";
import { ProjectBackendService } from "./services/project-backend.js";
import { ProjectVariableService } from "./services/project-variables.js";
import { ProjectService } from "./services/projects.js";
import { resolveSecretKey, SecretBox } from "./services/secrets.js";
import { SettingsService } from "./services/settings.js";
import { SkillUploadService } from "./services/skill-uploads.js";
import { SpeechService } from "./services/speech.js";
import { SupabaseBridge } from "./services/supabase-bridge.js";
import { SupabaseConnectionService } from "./services/supabase-connections.js";
import { SupportService } from "./services/support.js";
import { TeamKeys } from "./services/team-keys.js";
import { TeamStatusService } from "./services/team-status.js";
import { ThumbnailStore } from "./services/thumbnails.js";
import { UsageService } from "./services/usage.js";
import { VaultService } from "./services/vault.js";
import { VaultKeyService } from "./services/vault-keys.js";
import { VideoAssetStore } from "./services/video-assets.js";
import { VideoBridge } from "./services/video-bridge.js";
import { VideoGenerationService } from "./services/video-generation.js";
import { ChatGateway } from "./ws/gateway.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the authentication hook; absent when the caller is anonymous. */
    zelyqUser?: User;
  }
}

export interface ZelyqServer {
  app: FastifyInstance;
  /** Product activity: exposed so tests can wait for recordings to land. */
  activity: ProductActivity;
  /** Server errors, grouped: exposed so tests can wait for them to land. */
  errors: ErrorTracker;
  /** Paused, read-only, suspended: exposed so tests can see what it stops. */
  teamStatus: TeamStatusService;
  /** Events for an account service: exposed so tests can deliver and wait. */
  eventsOut: EventsOut;
  /** Says when the server goes down and comes back (events). */
  healthWatch: HealthWatch;
  store: Store;
  runtime: RuntimeDriver;
  /** What each team uses, and its plan: exposed so tests measure when they choose. */
  usage: UsageService;
  /** Ops, the team's DevOps engineer: exposed so tests can act as the engineer does. */
  ops: OpsService;
  /** Talking to Ops live: exposed so tests can drive a conversation. */
  opsVoice: OpsVoice;
  /** The watch (Phase 2): exposed so tests can run its ticks. */
  watch: CheckService;
  opsChannels: ChannelService;
  /** The agent's image capability channel. Exposed so tests can mint a grant
   *  the way the websocket gateway does. */
  imageBridge: ImageBridge;
  /** The agent's video capability channel, exposed for tests the same way. */
  videoBridge: VideoBridge;
  /** The agent's preview grant (which also reads its project's variable
   *  names), exposed for tests the same way. */
  previewGrants: Pick<ProjectBackendService, "mint">;
  /** Exposed so tests can see exactly what a project's app would be given. */
  projectVariables: ProjectVariableService;
  /** Exposed so tests can ask which credential Zelyq would actually use. */
  settings: SettingsService;
  /** Exposed so tests can run the schedule at a chosen time, or say an app changed. */
  pipelineTriggers: Pick<PipelineTriggerService, "tick" | "appChanged">;
  /** Exposed so tests can run the clean-up at a chosen time. */
  pipelineEngine: Pick<PipelineEngine, "cleanUp" | "reporter">;
  /** Exposed so tests can read pipeline files from a local repository. */
  pipelines: Pick<PipelineService, "repoFiles" | "create" | "startTriggered">;
  /** Read at startup to warn when an exposed instance also accepts signups. */
  registrationOpen(): Promise<boolean>;
  close(): Promise<void>;
}

export async function buildServer(config: ServerConfig): Promise<ZelyqServer> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isProduction
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
    },
    bodyLimit: 16 * 1024 * 1024,
    // Behind a TLS-terminating proxy this is what makes `request.protocol`
    // report the scheme the browser used, which is what decides whether the
    // session cookie is marked `Secure` (see routes/auth.ts). Without it an
    // HTTPS deployment silently hands out a cookie that a downgraded
    // connection would send in the clear. Off unless configured, so a
    // directly-exposed instance cannot be lied to by a header.
    trustProxy: config.trustProxy ?? false,
    // The UI polls preview status on a timer, and Fastify's per-request logging
    // turns that into ~20 lines every few seconds — enough to bury a real
    // error. Errors and explicit log calls still come through; set
    // LOG_LEVEL=debug for the request firehose when you actually want it.
    logController: new LogController({ disableRequestLogging: !isVerbose(config.logLevel) }),
  });

  const store = createStore(config.databaseUrl);
  const runtime = createRuntimeDriver(config.runtime);
  const agent = new AgentClient(config.agentUrl);
  const projects = new ProjectService(store, runtime, config);
  const thumbnails = new ThumbnailStore(
    path.join(path.dirname(config.attachmentsDir), "thumbnails"),
    (projectId) => agent.thumbnail(projectId),
    app.log,
  );
  const secrets = new SecretBox(
    resolveSecretKey({
      envKey: config.secretKey,
      keyFilePath: config.secretKeyFile,
      onGenerate: (file) =>
        app.log.warn(
          `Generated an encryption key at ${file}. Back it up, or set ZELYQ_SECRET_KEY instead — without it, stored API keys cannot be read.`,
        ),
    }),
  );
  const settings = new SettingsService(
    store,
    secrets,
    process.env,
    config.claudeCredentialsPath,
    config.codexCredentialsPath,
  );
  // Access-related settings are read at call time, so changing them in the UI
  // takes effect without a restart.
  const auth = new AuthService(store, {
    allowRegistration: () => settings.booleanValue("allowRegistration"),
    sessionTtlDays: () => settings.numberValue("sessionTtlDays"),
    oidc: config.oidc,
    accounts: config.accounts,
    ...(config.localSignIn !== undefined ? { localSignIn: config.localSignIn } : {}),
  });
  const access = new AccessControl(store);
  // Managed: server-wide changes only from the admin (through the admin API).
  access.managed = config.accounts?.name ?? null;
  // Product activity: what people do here, for this server's own administrators.
  const activity = new ProductActivity(store, {
    enabled: process.env.ZELYQ_PRODUCT_EVENTS !== "off",
    keepMonths: Math.max(
      1,
      Number.parseInt(process.env.ZELYQ_PRODUCT_EVENTS_MONTHS ?? "13", 10) || 13,
    ),
    log: (error, message) => app.log.warn({ error }, message),
  });
  auth.activity = activity;
  access.activity = activity;
  // What developers need: errors grouped (secrets taken out), and how long calls take.
  const errors = new ErrorTracker(store, (error, message) => app.log.warn({ error }, message));
  const requestStats = new RequestStats();
  // Paused, read-only, suspended: one check, used by every way into a team.
  const teamStatus = new TeamStatusService(store);
  activity.touch = (teamId, userId) => teamStatus.touch(teamId, userId);

  // Events for an account service: what happened, signed and sent (or read back).
  const eventsOut = new EventsOut(store, {
    target: config.events,
    log: (error, message) => app.log.warn({ error }, message),
  });
  activity.onRecorded = (event) => {
    const base = { teamId: event.teamId, accountId: event.userId };
    if (event.name === "account.created") {
      eventsOut.emit("account.created", { ...base, via: event.detail.via ?? null });
    } else if (event.name === "team.created") {
      eventsOut.emit("team.created", { ...base, via: event.detail.via ?? null });
    } else if (event.name === "limit.reached") {
      eventsOut.emit("team.limit_reached", {
        teamId: event.teamId,
        limit: event.detail.limit ?? null,
        plan: event.detail.plan ?? null,
      });
    }
  };
  access.onChange = (action, entry) => {
    if (action === "team.member_added") {
      eventsOut.emit("team.member_added", {
        teamId: entry.teamId,
        accountId: entry.detail.memberId ?? null,
        role: entry.detail.role ?? null,
        via: "added",
      });
    } else if (action === "team.member_removed") {
      eventsOut.emit("team.member_removed", {
        teamId: entry.teamId,
        accountId: entry.detail.memberId ?? null,
        byThemselves: entry.detail.self === true,
      });
    }
  };
  teamStatus.onChange = (teamId, status, by) =>
    by === "owner"
      ? eventsOut.emit("team.resumed", { teamId })
      : eventsOut.emit("team.status_changed", { teamId, status });
  errors.onNewGroup = (group, regressed) =>
    eventsOut.emit(regressed ? "error.regressed" : "error.new", {
      groupId: group.id,
      kind: group.kind,
      message: group.message,
      location: group.location,
      route: group.route,
    });
  // However a team goes (its last member leaving, the admin API, an account deleted), it is said.
  const removeTeam = store.teams.remove.bind(store.teams);
  store.teams.remove = async (teamId) => {
    await removeTeam(teamId);
    eventsOut.emit("team.deleted", { teamId });
  };
  const vault = new VaultService(store, secrets, access);
  const variables = new ProjectVariableService(store, secrets, access, vault, runtime);
  vault.listeners.teamEntryChanged = (teamId, name) => variables.vaultEntryChanged(teamId, name);
  const vaultKeys = new VaultKeyService(store, access, vault);
  const pipelinesDir =
    config.pipelinesDir ?? path.join(path.dirname(config.attachmentsDir), "pipelines");
  const sshKeys = new TeamSshKeyService(store, access, secrets);
  const runners = new RunnerService(store, access, sshKeys);
  const deploys = new DeployService(store, access, secrets, vault, runners);
  deploys.activity = activity;
  const pipelinePlugins = new PipelinePluginService(
    store,
    access,
    path.join(pipelinesDir, "plugins"),
  );
  const pipelineEngine = new PipelineEngine({
    store,
    vault,
    runners,
    settings,
    runtime,
    artifactsDir: path.join(pipelinesDir, "artifacts"),
    log: {
      info: (message) => app.log.info(message),
      error: (object, message) => app.log.error(object, message),
    },
    publicUrl: config.publicUrl,
    tools: new ToolService(path.join(pipelinesDir, "tools")),
    cacheDir: path.join(pipelinesDir, "cache"),
    deploys,
    plugins: pipelinePlugins,
  });
  const pipelines = new PipelineService(store, access, vault, pipelineEngine);
  pipelines.teamStatus = teamStatus;
  pipelines.plugins = pipelinePlugins;
  const pipelineTriggers = new PipelineTriggerService(
    store,
    access,
    secrets,
    pipelines,
    config.publicUrl,
    {
      error: (object, message) => app.log.error(object, message),
    },
  );
  // Telegram, Slack and Discord: each person's own chats, and the team's shared place.
  const opsChannels = new ChannelService(store, secrets);
  const mail = new MailService(settings);
  // Many teams on one server: a team's own mail server may not be one of ours.
  if (config.accounts) mail.teamGuard = "strict";
  // Password reset and team invitations by emailed link, once an admin turns them on.
  const emailLinks = new EmailLinkService(store, settings, mail, auth, {
    warn: (object, message) => app.log.warn(object, message),
  });
  // Joining through an invitation counts like being added: activity and an event.
  emailLinks.onJoined = (teamId, userId, role) => {
    activity.record("member.joined", { userId, teamId, detail: { role } });
    eventsOut.emit("team.member_added", { teamId, accountId: userId, role, via: "invitation" });
  };
  // Ops, the team's DevOps engineer: one list of actions, one gate in front of it.
  const ops = new OpsService(store, access, new ActionList(OPS_ACTIONS), {
    deploys,
    pipelines,
    triggers: pipelineTriggers,
    runners,
    vault,
    runtime,
    channels: opsChannels,
    mail,
  });
  // Email (Settings → Email) and the messages Ops sends a person who walked away.
  const opsMailer = new OpsMailer(store, mail, config.publicUrl);
  ops.events = (event) => opsMailer.handle(event);
  const watch = new CheckService(store, runners);
  // A pipeline Ops wrote runs by itself only while Ops still has it, and where it deploys.
  pipelines.mayStartTriggered = async (pipeline) => {
    if (!pipeline.createdBy || !(await store.users.isService(pipeline.createdBy))) return null;
    const scope = await ops.accessList.scopeFor(pipeline.teamId);
    return missingAccess(store, scope, [
      { kind: "pipeline", name: pipeline.name, need: "manage", contents: true },
    ]);
  };
  // Ops watches only what it has been given.
  watch.scopeFor = (teamId) => ops.accessList.scopeFor(teamId);
  watch.events = (event) => opsMailer.handleWatch(event);
  opsMailer.channels = opsChannels;
  // Settings credentials may point at the instance Vault or a team's, and each
  // Vault shows which Settings fields use its secrets.
  settings.vaultLookup = async ({ name, scope }) =>
    (await vault.resolve(scope, [name])).get(name) ?? null;
  vault.listeners.settingUsages = (scope) => settings.vaultUsages(scope);
  const supabaseConnections = new SupabaseConnectionService(store, secrets, access, {
    oauth: config.supabaseOAuth,
    verifyEmailDomain: config.supabaseVerifyEmailDomain,
  });
  const resolvePreviewEnv = makePreviewEnvResolver({ supabaseConnections });
  const functionSecrets = new FunctionSecretSync(store, access, supabaseConnections, variables);
  variables.onChanged = (projectId) => functionSecrets.sync(projectId);
  const projectBackend = new ProjectBackendService(store, secrets, runtime, variables);
  const supabaseBridge = new SupabaseBridge(store);
  const figmaConnections = new FigmaConnectionService(store, secrets, {
    oauth: config.figmaOAuth,
  });
  const figmaExtract = new FigmaExtractService(figmaConnections, runtime, store);
  const imageAssets = new ImageAssetStore(
    config.imageAssetsDir ?? path.join(path.dirname(config.attachmentsDir), "images"),
  );
  const images = new ImageGenerationService(store, settings, imageAssets, undefined, () =>
    app.log.error("Image job processing failed; jobs will be reconciled on the next pass."),
  );
  const imageBridge = new ImageBridge(store, images);
  const videoAssets = new VideoAssetStore(
    config.videoAssetsDir ?? path.join(path.dirname(config.attachmentsDir), "videos"),
  );
  const videos = new VideoGenerationService(
    store,
    settings,
    videoAssets,
    undefined,
    undefined,
    () => app.log.error("Video job processing failed; persisted jobs will be checked again."),
  );
  const videoBridge = new VideoBridge(store, videos);
  const accounts = new AccountService(store, projects, async (id) => {
    await Promise.all([imageAssets.removeUser(id), videoAssets.removeUser(id)]);
  });
  const attachments = new AttachmentService(config.attachmentsDir);
  // What each team uses, and what its plan allows (one plan, Unlimited, until an admin sets more).
  const usage = new UsageService(store, {
    workspaceDir:
      config.runtime.kind === "remote"
        ? null
        : ((config.runtime as { workspaceDir?: string }).workspaceDir ?? null),
    attachmentsDir: config.attachmentsDir,
  });
  usage.previewRunning = async (projectId) =>
    (await runtime.previewStatus(projectId)).status === "running";
  // An app whose agent is working is never cleared under it.
  usage.appBusy = async (projectId) =>
    (await store.projects.findById(projectId))?.status === "building";
  usage.idleDays = () => settings.numberValue("cleanIdleAfterDays");
  usage.managed = Boolean(config.accounts);
  // Announcements, messages to one person, maintenance: from the server's operators.
  const messages = new MessagesToPeople(store, usage);
  usage.activity = activity;
  activity.usage = usage;
  // Undo points: only the newest are kept; a team member frees more from its Usage panel.
  projects.keepSnapshots = () => settings.numberValue("keepUndoPoints");
  usage.pruneUndo = (projectId, keep) => projects.pruneSnapshots(projectId, keep);
  usage.removeAttachments = (projectId) => attachments.removeProject(projectId);
  for (const service of [pipelines, pipelineTriggers, deploys, runners, images, videos]) {
    service.limits = usage;
  }
  const skillUploads = new SkillUploadService(config.uploadedSkillsDir);
  const speech = new SpeechService();

  await app.register(cors, {
    origin: config.corsOrigin.includes("*") ? true : config.corsOrigin,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(websocket);

  /**
   * Resolve the session on every request, including WebSocket upgrades. This
   * only *identifies* the caller; each route decides what that identity may do.
   */
  app.addHook("onRequest", async (request) => {
    const token = request.cookies?.[SESSION_COOKIE];
    const user = await auth.resolve(token);
    if (user) request.zelyqUser = user;
  });

  // One error shape for every route: `{ error: { code, message } }`. The UI
  // branches on `code`, never on the message text.
  app.setErrorHandler((error, request, reply) => {
    const where = {
      route: `${request.method} ${request.routeOptions.url ?? "unmatched"}`,
      userId: request.zelyqUser?.id ?? null,
    };
    if (isZelyqError(error)) {
      // Our own "something broke" is a server error; the rest are answers.
      if (error.code === "internal") errors.capture(error, where);
      reply.status(error.status).send(error.toJSON());
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send(
        new ZelyqError("bad_request", "Request validation failed", {
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        }).toJSON(),
      );
      return;
    }
    request.log.error(error);
    const failure = toError(error);
    if (((error as { statusCode?: number }).statusCode ?? 500) >= 500) errors.capture(error, where);
    reply
      .status((error as { statusCode?: number }).statusCode ?? 500)
      .send({ error: { code: "internal", message: failure.message } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      reply
        .status(404)
        .send({ error: { code: "not_found", message: `No route for ${request.url}` } });
      return;
    }
    // The SPA shell answers *navigations*, not every miss. Returning it for a
    // missing asset would turn a broken `<img src>` or a stale bundle
    // reference into a silent 200 that no log or monitor ever flags.
    if (config.webDir && isNavigation(request.url, request.headers.accept)) {
      reply.type("text/html").send(fs.createReadStream(path.join(config.webDir, "index.html")));
      return;
    }
    reply.status(404).send({ error: { code: "not_found", message: `Not found: ${request.url}` } });
  });

  app.get("/api/health", async () => {
    const [runtimeHealth, agentHealth] = await Promise.all([
      runtime.health(),
      agent
        .health()
        .catch((error) => ({ status: "unreachable", detail: (error as Error).message })),
    ]);
    const ok = runtimeHealth.ok && agentHealth.status === "ok";
    return {
      status: ok ? "ok" : "degraded",
      service: "zelyq-server",
      version: process.env.npm_package_version ?? "0.1.0",
      database: { dialect: store.dialect, url: store.describe() },
      // The live setting, not the value this process booted with: registration
      // can be closed from the settings screen, and health saying otherwise is
      // exactly the kind of wrong answer somebody acts on.
      auth: {
        firstRun: await auth.isFirstRun(),
        registrationOpen: await settings.booleanValue("allowRegistration").catch(() => false),
      },
      provider: config.provider,
      runtime: runtimeHealth,
      agent: agentHealth,
      timestamp: new Date().toISOString(),
    };
  });

  registerAuthRoutes(app, {
    auth,
    links: emailLinks,
    sessionTtlDays: () => settings.numberValue("sessionTtlDays"),
  });
  registerAccountRoutes(app, { accounts, auth, access });
  registerSettingsRoutes(app, { settings, access, store, mail });
  registerSkillRoutes(app, { skillUploads, access });
  registerProviderRoutes(app, { agent, access, settings });
  registerPlanRoutes(app, { usage, access, store });
  const directory = new AdminDirectory(store, auth, accounts, usage);
  // Support (with the team's permission to look inside) and feature switches.
  const support = new SupportService(store, runtime, directory);
  support.planOf = async (teamId) => (await usage.planOf(teamId)).id;
  auth.switchedOff = (userId, teamId) => support.switchedOff(userId, teamId);
  registerSupportRoutes(app, { support, access });
  directory.activity = activity;
  directory.teamStatus = teamStatus;
  const checkHealth = () =>
    deepHealth({
      store,
      dataDir: config.attachmentsDir,
      runtime: () => runtime.health(),
      agent: () => agent.health(),
      mailConfigured: () => mail.configured(),
      lastCleanup: () => usage.lastCleanup(),
      stats: requestStats,
    });
  const healthWatch = new HealthWatch(checkHealth, {
    listening: () => eventsOut.anyoneListening(),
    changed: (down, checks) =>
      eventsOut.emit(down ? "health.down" : "health.recovered", { checks }),
  });
  registerMessageRoutes(app, { messages, access });
  const adminKeys = new AdminKeyService(store);
  adminKeys.onKeysChanged = () => eventsOut.keysChanged();
  registerAdminApi(app, {
    settings,
    adminKeys,
    eventsOut,
    messages,
    support,
    usage,
    store,
    access,
    directory,
    activity,
    errors,
    requestStats,
    health: checkHealth,
  });
  registerTeamRoutes(app, {
    limits: usage,
    store,
    access,
    links: emailLinks,
    keys: new TeamKeys(settings, vault, access),
    settings,
    mail,
  });
  registerProjectRoutes(app, {
    limits: usage,
    projects,
    access,
    templatesDir: config.templatesDir,
    runtime,
    vault,
    thumbnails,
  });
  registerFileRoutes(app, { projects, runtime, access, images, videos });
  registerPreviewRoutes(app, {
    limits: usage,
    projects,
    runtime,
    access,
    templatesDir: config.templatesDir,
    resolvePreviewEnv,
    backend: projectBackend,
    thumbnails,
    activity,
    maintenance: messages,
  });
  registerSupabaseConnectionRoutes(app, { supabase: supabaseConnections, access, runtime });
  registerFigmaRoutes(app, { figma: figmaConnections, access });
  registerSupabaseBridgeRoutes(app, {
    bridge: supabaseBridge,
    supabase: supabaseConnections,
    store,
  });
  registerSnapshotRoutes(app, { projects, runtime, store, access });
  registerVaultRoutes(app, { vault, access });

  // Outside agents (Claude Code, Codex, any MCP client) working on the team's
  // apps. The editor hears about their file changes through the chat gateway,
  // which is built further down: `agentFilesChanged` reaches it once it exists.
  const agentReferences = new AgentReferenceStore(
    path.join(path.dirname(config.attachmentsDir), "agent-references"),
  );
  const agents = new AgentService(
    store,
    access,
    projects,
    vault,
    pipelines,
    deploys,
    pipelineTriggers,
    videos,
    images,
    agentReferences,
  );
  // An outside agent's images and video are paid with its own key from the
  // team's Vault — read at the moment the provider is called, never stored.
  const agentKey = async (ref: { teamId: string; name: string }) =>
    (await vault.resolve(ref.teamId, [ref.name])).get(ref.name) ?? null;
  images.keyResolver = agentKey;
  videos.keyResolver = agentKey;
  let agentFilesChanged: (projectId: string, paths: string[]) => void = () => undefined;
  const agentGateway = new AgentGateway({
    store,
    references: agentReferences,
    images,
    videos,
    pipelines,
    deploys,
    pipelineGuide: readPipelineGuide(),
    runtime,
    agents,
    ops,
    projects,
    variables,
    startPreview: async (projectId, restart) => {
      await ensureInspectorScript(runtime, config.templatesDir, projectId);
      const env = await resolvePreviewEnv(projectId);
      if (restart) await runtime.stopPreview(projectId);
      return runtime.startPreview(
        projectId,
        projectBackend ? await projectBackend.previewOptions(projectId, env) : { env },
      );
    },
    filesChanged: (projectId, paths) => agentFilesChanged(projectId, paths),
  });
  const agentOAuth = new AgentOAuthService(store);
  agents.oauth = agentOAuth;
  agents.ops = ops;
  registerAgentRoutes(app, {
    agents,
    gateway: agentGateway,
    access,
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
  });
  registerAgentOAuthRoutes(app, {
    oauth: agentOAuth,
    store,
    ...(config.publicUrl ? { publicUrl: config.publicUrl } : {}),
  });
  registerVaultKeyRoutes(app, { keys: vaultKeys, access });
  registerDeployRoutes(app, { access, deploys });
  const opsBrain = new OpsBrain(ops, settings, agent, config.serverInternalUrl);
  const opsVoice = new OpsVoice(ops, opsBrain, settings);
  registerOpsRoutes(app, { access, ops, brain: opsBrain, watch, channels: opsChannels });
  // Zelyq's own plugins, signed: installed only if the signature verifies.
  const pluginRegistry = new PluginRegistryClient(store, settings, access, pipelinePlugins, {
    trustedKeys: process.env.ZELYQ_PLUGIN_REGISTRY_KEYS
      ? process.env.ZELYQ_PLUGIN_REGISTRY_KEYS.split(",")
          .map((key) => key.trim())
          .filter(Boolean)
      : ZELYQ_REGISTRY_KEYS,
    zelyqVersion: process.env.npm_package_version ?? "0.1.0",
  });
  registerPluginRegistryRoutes(app, { registry: pluginRegistry, access });
  registerPipelineRoutes(app, {
    access,
    pipelines,
    runners,
    keys: sshKeys,
    triggers: pipelineTriggers,
    serviceKeys: vaultKeys,
    plugins: pipelinePlugins,
  });
  registerProjectVariableRoutes(app, {
    variables,
    functionSecrets,
    access,
    store,
    previewGrants: projectBackend,
  });
  // With the others, after the error handler — registered before it, these
  // answered in Fastify's own error shape, and the Backend panel showed
  // "Request failed with 400" in place of the reason.
  registerProjectBackendRoutes(app, {
    backend: projectBackend,
    runtime,
    access,
    store,
    resolvePreviewEnv,
  });
  registerAttachmentRoutes(app, { attachments, access, limits: usage });
  registerVoiceRoutes(app, { speech, settings, access });
  registerGuideRoutes(app, { access });
  registerImageRoutes(app, { images, access });
  await registerVideoRoutes(app, { videos, images, access });
  registerImageBridgeRoutes(app, { bridge: imageBridge, images, assets: imageAssets, store });
  registerVideoBridgeRoutes(app, { bridge: videoBridge, videos, store });
  app.addHook("onReady", async () => {
    // Credentials used to come from the environment. They are copied into
    // Settings once; after that only Settings (typed or from Vault) is read.
    try {
      const copied = await settings.importCredentialsFromEnvironment();
      if (copied.length > 0) {
        app.log.warn(
          `Copied ${copied.length} credential(s) from the environment into Settings: ${copied.join(", ")}. ` +
            "Zelyq no longer reads them from the environment; remove them from .env.",
        );
      }
    } catch (error) {
      app.log.error(error, "Copying credentials from the environment into Settings failed.");
    }
    // Before the first request: a preview started now must already find its
    // secrets among the project's variables. A failure is logged, not fatal —
    // anything not moved is still read from where it was, and the next start
    // tries again.
    try {
      const moved = await variables.moveBackendSecrets(app.log);
      if (moved > 0) app.log.info(`Moved ${moved} backend secret(s) into project variables.`);
    } catch (error) {
      app.log.error(error, "Moving backend secrets failed; will retry on next start.");
    }
    images.start();
    videos.start();
    // Measures every team's files in the background; under the test runner only when asked.
    if (!process.env.NODE_TEST_CONTEXT) usage.start();
    activity.start();
    errors.start();
    eventsOut.start();
    healthWatch.start();
    await deploys.recover();
    await pipelineEngine.start();
    pipelineTriggers.start();
    // The watch: checks on a timer for every team with Ops (no model, whatever the spending cap).
    // Not under the test runner: tests run its ticks themselves, at the times they choose.
    if (!process.env.NODE_TEST_CONTEXT || process.env.ZELYQ_WATCH === "1") {
      watch.start();
      opsChannels.start();
    }
  });
  app.addHook("onClose", async () => {
    usage.stop();
    watch.stop();
    opsChannels.stop();
    opsMailer.close();
    await images.close();
    await videos.close();
    pipelineTriggers.stop();
    await pipelineEngine.close();
  });

  const gateway: ChatGateway = new ChatGateway(
    store,
    projects,
    agent,
    access,
    settings,
    attachments,
    {
      info: (message) => app.log.info(message),
      error: (object, message) => app.log.error(object, message),
    },
    {
      bridge: supabaseBridge,
      backend: projectBackend,
      resolvePreviewEnv,
      serverInternalUrl: config.serverInternalUrl,
    },
    { bridge: imageBridge, serverInternalUrl: config.serverInternalUrl },
    { bridge: videoBridge, serverInternalUrl: config.serverInternalUrl },
    { extract: figmaExtract, enabled: config.figmaEnabled && Boolean(config.figmaOAuth) },
  );
  gateway.limits = usage;
  gateway.activity = activity;
  gateway.errors = errors;
  gateway.teamStatus = teamStatus;
  gateway.maintenance = messages;
  teamStatus.stopPreview = (projectId) => runtime.stopPreview(projectId);
  agents.teamStatus = teamStatus;
  agents.features = support;

  /**
   * A person's call into a team obeys the team's status: a suspended team is
   * closed; a paused or read-only one may be looked at, downloaded and
   * cleared, not changed. The team is found from the address: a team, an app
   * in it, or Studio's `?teamId=`. The server's administrators are not held.
   */
  app.addHook("preHandler", async (request) => {
    const user = request.zelyqUser;
    if (!user || user.instanceRole === "admin") return;
    const route = request.routeOptions.url ?? "";
    const params = (request.params ?? {}) as { id?: string; teamId?: string };
    let teamId: string | null = params.teamId ?? null;
    if (!teamId && route.startsWith("/api/teams/:id") && params.id) teamId = params.id;
    if (!teamId && route.startsWith("/api/projects/:id") && params.id) {
      teamId = (await store.projects.findById(params.id))?.teamId ?? null;
    }
    // A new app names its team in the body (or goes to the person's own team).
    if (!teamId && route === "/api/projects" && request.method === "POST") {
      const wanted = (request.body as { teamId?: unknown } | undefined)?.teamId;
      teamId = typeof wanted === "string" ? wanted : await access.defaultTeamFor(user);
    }
    if (!teamId && (route.startsWith("/api/images/") || route.startsWith("/api/videos/"))) {
      teamId = (request.query as { teamId?: string } | undefined)?.teamId ?? null;
    }
    // A feature switched off (for everyone, this plan, this team or this person) is not there.
    await support.requireEnabled(route, user.id, teamId);
    if (!teamId) return;
    // Resuming is how a paused team comes back: the one change it always allows.
    await teamStatus.enforce(teamId, request.method, route);
    void teamStatus.touch(teamId, user.id).catch(() => undefined);
  });

  /** The owner brings back a team paused because it was not used. */
  app.post<{ Params: { id: string } }>("/api/teams/:id/resume", async (request) => {
    const user = access.requireUser(request);
    return await teamStatus.resume(user, request.params.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    requestStats.record(
      request.method,
      request.routeOptions.url ?? "unmatched",
      reply.statusCode,
      reply.elapsedTime,
    );
  });

  // Features counted where they are asked for: a successful call is one use.
  const featureRoutes: Record<string, ProductFeature> = {
    "/api/images/generations": "studio_image",
    "/api/videos/generations": "studio_video",
    "/api/projects/:id/voice/transcriptions": "voice",
    "/api/teams/:teamId/voice/transcriptions": "voice",
  };
  app.addHook("onResponse", async (request, reply) => {
    if (request.method !== "POST" || reply.statusCode >= 400) return;
    const feature = featureRoutes[request.routeOptions.url ?? ""];
    if (!feature) return;
    const params = (request.params ?? {}) as { id?: string; teamId?: string };
    const query = (request.query ?? {}) as { teamId?: string };
    activity.feature(feature, {
      userId: request.zelyqUser?.id ?? null,
      teamId: params.teamId ?? query.teamId ?? null,
      projectId: params.id ?? null,
    });
  });
  agentFilesChanged = (projectId, paths) => gateway.notifyFilesChanged(projectId, paths);

  // Pipelines starting other pipelines: a `pipeline` step, and "after another pipeline" triggers.
  pipelineEngine.hooks = {
    startChild: (parent, name, inputs) => pipelines.startChild(parent, name, inputs),
    runFinished: async (run) => {
      activity.record("pipeline.run_finished", {
        userId: run.triggeredBy,
        teamId: run.teamId,
        detail: {
          ok: run.status === "passed",
          status: run.status,
          trigger: run.trigger,
          seconds:
            run.startedAt && run.finishedAt
              ? (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000
              : undefined,
        },
      });
      // The watch hears every finished run: a deploying pipeline that failed is an alert.
      await watch
        .runFinished(run.teamId, run.pipelineId, run.status, `#${run.number}`)
        .catch(() => undefined);
      return pipelineTriggers.runFinished(run);
    },
    preApproved: (run, environmentId) => ops.preApproved(run, environmentId),
  };

  gateway.appChanged = async (projectId) => {
    const project = await store.projects.findById(projectId);
    // A new picture for the app list, once hot reload has caught up. Only
    // while the preview is running: an app is never started just for this.
    void runtime
      .previewStatus(projectId)
      .then(async (preview) => {
        if (preview.status === "running") await thumbnails.capture(projectId, 4000);
      })
      .catch(() => undefined);
    if (project) await pipelineTriggers.appChanged(project);
  };

  // Talking to Ops live: the microphone streams here and on to Gemini Live (services/ops/voice.ts).
  app.get<{ Params: { teamId: string }; Querystring: { job?: string } }>(
    "/ws/ops/:teamId",
    { websocket: true },
    (socket, request) => {
      const user = request.zelyqUser;
      if (!user) {
        socket.close(4401, "Not signed in");
        return;
      }
      // Only Zelyq's own page may open this with the person's session, never another site.
      const origin = request.headers.origin;
      let sameSite = false;
      try {
        sameSite = Boolean(origin) && new URL(origin as string).host === request.headers.host;
      } catch {
        sameSite = false;
      }
      if (!sameSite) {
        socket.close(4403, "Not from Zelyq");
        return;
      }
      const { teamId } = request.params;
      void (async () => {
        await access.requireTeamRole(user, teamId, "editor");
        if (await store.users.isService(user.id)) throw new Error("Ops does not talk to itself.");
        await opsVoice.relay(socket as never, user, teamId, request.query.job ?? null);
      })().catch((error) => {
        try {
          socket.send(JSON.stringify({ type: "error", message: (error as Error).message }));
        } catch {
          // closed already
        }
        socket.close(1011, "error");
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/ws/projects/:id",
    { websocket: true },
    (socket, request) => {
      const user = request.zelyqUser;
      if (!user) {
        // 4401 is the convention for "authenticate and reconnect".
        socket.close(4401, "Not signed in");
        return;
      }
      void gateway.handleConnection(socket, request.params.id, user).catch((error) => {
        app.log.error(error, "websocket setup failed");
        socket.close(1011, (error as Error).message);
      });
    },
  );

  if (config.webDir && fs.existsSync(config.webDir)) {
    // Wildcard matching resolves each request against the directory as it is
    // now. With `wildcard: false` the routes are enumerated once at startup, so
    // any file written afterwards — every UI rebuild produces new hashed
    // filenames — misses the static handler, falls through to the SPA fallback,
    // and is served as HTML. The browser then refuses to execute it and renders
    // a blank page.
    await app.register(fastifyStatic, { root: config.webDir });
    app.log.info(`serving web build from ${config.webDir}`);
  }

  return {
    app,
    activity,
    errors,
    eventsOut,
    healthWatch,
    teamStatus,
    imageBridge,
    videoBridge,
    previewGrants: projectBackend,
    projectVariables: variables,
    settings,
    pipelineTriggers,
    pipelineEngine,
    pipelines,
    ops,
    opsVoice,
    watch,
    opsChannels,
    store,
    runtime,
    usage,
    /** Read at startup to warn when an exposed instance also accepts signups. */
    async registrationOpen(): Promise<boolean> {
      return await settings.booleanValue("allowRegistration").catch(() => false);
    },
    async close() {
      await app.close();
      activity.stop();
      errors.stop();
      eventsOut.stop();
      healthWatch.stop();
      await activity.settled();
      await errors.settled();
      await eventsOut.settled();
      await runtime.dispose();
      await store.close();
    },
  };
}

/**
 * A navigation is a request for a page: the browser asks for HTML and the path
 * carries no file extension. `/projects/abc` qualifies; `/logo.png` does not.
 */
function isNavigation(url: string, accept: string | undefined): boolean {
  const pathname = url.split("?")[0] ?? "";
  const lastSegment = pathname.split("/").pop() ?? "";
  if (lastSegment.includes(".")) return false;
  return (accept ?? "").includes("text/html");
}

/** Request-by-request logging is only useful when you asked for the detail. */
function isVerbose(logLevel: string): boolean {
  return logLevel === "debug" || logLevel === "trace";
}

/**
 * What an outside agent reads before writing a pipeline: the relevant parts of
 * the docs this server ships with. Empty when they are not installed — the
 * tool then points at the repository instead.
 */
function readPipelineGuide(): string {
  try {
    const docs = resolveFromRepoRoot("docs");
    return pipelineGuide(
      fs.readFileSync(path.join(docs, "pipelines.md"), "utf8"),
      fs.readFileSync(path.join(docs, "deploy.md"), "utf8"),
    );
  } catch {
    return "";
  }
}
