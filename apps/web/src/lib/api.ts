import type {
  AddMemberInput,
  AdminKeySummary,
  AdminScope,
  Agent,
  AgentCreate,
  AgentCreated,
  AgentProposal,
  AgentRunnerInput,
  AgentUpdate,
  AppAction,
  AppAddressInput,
  AppStatus,
  AttachmentRef,
  AuditLogEntry,
  AvailableProviders,
  BackendConfiguration,
  BackendConfigurationInput,
  ChangePasswordInput,
  CreatedAdminKey,
  CreateProjectInput,
  CreatePullRequestRequest,
  DeploymentDetail,
  DeploymentSummary,
  EnvironmentInput,
  EnvironmentSummary,
  EnvironmentUpdate,
  FileContent,
  FileEntry,
  FrameExportInput,
  FreeSpaceResult,
  GitBranchInput,
  GitFetchInput,
  GitPullInput,
  GitStatus,
  ImageCapabilities,
  ImageGeneration,
  ImageGenerationInput,
  ImageHistory,
  InstanceStatus,
  LocalRunnerStatus,
  OpsAccessChange,
  OpsAccessItem,
  OpsChannelKind,
  OpsChannelsView,
  OpsEngineer,
  OpsJobDetail,
  OpsJobSummary,
  OpsLinkStart,
  OpsNotifyPrefs,
  OpsStatusView,
  OpsTrust,
  PipelineDetail,
  PipelinePluginSummary,
  PipelineRunDetail,
  PipelineRunSummary,
  PipelineStats,
  PipelineSummary,
  PipelineTriggerSummary,
  PipelineVersionSummary,
  PlaceStudioMediaInput,
  Plan,
  PlansSettings,
  Preview,
  Project,
  ProjectVariable,
  ProjectVariableCreate,
  ProjectVariableUpdate,
  PullRequestResult,
  PushToRemoteInput,
  RegistryPluginDetail,
  RegistryPluginSummary,
  Role,
  RunLogLine,
  RunnerAgentInstall,
  RunnerDisk,
  RunnerSummary,
  RunnerTestResult,
  SessionResponse,
  SetGitRemoteInput,
  SettingsResponse,
  SignedInSession,
  Snapshot,
  SshRunnerInput,
  SshRunnerUpdate,
  TeamMember,
  TeamMembership,
  TeamSshKeySummary,
  TeamUsage,
  TriggerInput,
  TwoFactorRequired,
  UpdateProfileInput,
  UpdateSettingsInput,
  UploadSkillInput,
  User,
  VaultEntry,
  VaultEntryCreate,
  VaultEntryUpdate,
  VaultImport,
  VaultImportResult,
  VaultScope,
  VaultServiceKey,
  VaultServiceKeyCreate,
  VaultServiceKeyCreated,
  VaultVersion,
  VideoCapabilities,
  VideoFrameSet,
  VideoGeneration,
  VideoGenerationInput,
  VideoHistory,
  VideoReference,
} from "@zelyq/core";
import { t, translateDisplayFields, translateServerMessage } from "./i18n";

/** Supabase integration — response shapes. */
export interface SupabaseConnection {
  id: string;
  credentialType: "oauth" | "pat";
  status: string;
  grantedScopes: string[];
  createdBy: string;
  createdAt: string;
  /** When its token is a secret in the Vault: that secret's name. */
  vaultName?: string | null;
}
export interface SupabaseResource {
  id: string;
  connectionId: string;
  projectRef: string;
  projectUrl: string;
  publishableKey: string;
  environment: "development" | "staging" | "production";
  region: string | null;
  displayName: string;
  provisionedByZelyq: boolean;
}
export interface SupabaseOrgProject {
  ref: string;
  name: string;
  organizationId: string;
  region: string | null;
}

/**
 * Every call goes through `request`, so error handling, JSON parsing, and the
 * server's `{ error: { code, message } }` envelope are handled once.
 */
export interface InboxItem {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "urgent";
  link: { url: string; label: string } | null;
  read: boolean;
}
export interface InboxMessages {
  banners: InboxItem[];
  announcements: InboxItem[];
  notifications: Array<InboxItem & { createdAt: string }>;
  unread: number;
  maintenance: {
    message: string;
    startsAt: string;
    endsAt: string;
    pauseBuilds: boolean;
    underway: boolean;
  } | null;
}

/** Fired when a plan limit stopped a call: `detail` is `{ teamId, limit, plan }`. */
export const PLAN_LIMIT_EVENT = "zelyq:plan-limit";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    /** A `bad_request` from a failed zod parse carries `{ issues: [{ path, message }] }`
     * here — the field-level reason, which `message` alone never says. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** What the idle-app clean-up freed, or would. */
export interface CleanupReportView {
  at: string;
  dryRun: boolean;
  apps: number;
  freedBytes: number;
  cleared: Array<{ projectId: string; name: string; bytes: number; folders: string[] }>;
}

/** "?teamId=…" for a request whose AI key is the team's own, or nothing. */
function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

/** A Studio list's page and team: "?cursor=…&teamId=…", or nothing. */
function listQuery(cursor?: string, teamId?: string): string {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (teamId) query.set("teamId", teamId);
  const text = query.toString();
  return text ? `?${text}` : "";
}

declare global {
  interface Window {
    /** Requests index.html starts before the app runs, by API path. */
    __zelyqEarly?: Record<string, Promise<Response> | undefined>;
  }
}

/** How long after the page loads an early answer may still be used. */
const EARLY_FOR_MS = 15_000;

/** Forgets every early answer: on any change of who is signed in. */
export function dropEarly(): void {
  if (typeof window !== "undefined") window.__zelyqEarly = {};
}

/**
 * A request index.html already started, taken once; a later ask fetches anew.
 * Only a successful answer from the first moments of the page counts: an
 * answer nobody took then may belong to someone who has since signed out.
 */
async function takeEarly(path: string): Promise<Response | null> {
  if (typeof window === "undefined") return null;
  const early = window.__zelyqEarly?.[path];
  if (!early) return null;
  delete window.__zelyqEarly?.[path];
  if (performance.now() > EARLY_FOR_MS) return null;
  const response = await early.catch(() => null);
  return response?.ok ? response : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Signing in, up or out changes whose answers these would be.
  if (/^\/auth\/(login|register|logout)/.test(path)) dropEarly();
  const response =
    (!init && (await takeEarly(path))) ||
    (await fetch(`/api${path}`, {
      ...init,
      // The session lives in an httpOnly cookie, so it has to be sent explicitly
      // for anything other than a same-origin default.
      credentials: "same-origin",
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
        ...init?.headers,
      },
    }));

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      payload as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } | null
    )?.error;
    // A plan limit stopped something: the shell offers the way up, wherever it happened.
    if (error?.details?.reason === "plan_limit" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: error.details }));
    }
    throw new ApiError(
      error?.code ?? "internal",
      error?.message
        ? translateServerMessage(error.message)
        : t("Request failed with {status}", { status: response.status }),
      response.status,
      error?.details,
    );
  }

  return translateDisplayFields(payload as T);
}

/** What is wrong with a pipeline file, and what will stop it from running. */
export interface PipelineCheck {
  ok: boolean;
  issues: { path: string; line: number | null; message: string }[];
  warnings: string[];
}

/** Whether a linked Supabase project's function secrets match — names only. */
export interface FunctionSecretsStatus {
  linked: boolean;
  names: string[];
  at: string | null;
  error: string | null;
}

function vaultPath(scope: VaultScope): string {
  return scope.kind === "instance" ? "/instance/vault" : `/teams/${scope.teamId}/vault`;
}

/** Where Supabase connections are managed: a team's own, or the server's. */
function supabaseBase(teamId?: string): string {
  return teamId ? `/teams/${teamId}/integrations/supabase` : "/integrations/supabase";
}

/** A team's own mail server, as its page shows it (never the password). */
export interface TeamMail {
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  username: string;
  from: string;
  passwordSet: boolean;
  /** When the password is a secret in the team's Vault: its name. */
  passwordVault: string | null;
}

export interface TeamMailInput {
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  username: string;
  from: string;
  /** Left out: keep the stored one. "": remove it. */
  password?: string;
  /** Take the password from this secret in the team's Vault instead. */
  passwordVault?: string;
}

export const api = {
  getBackend: (id: string, environment = "development") =>
    request<{ configuration: BackendConfiguration }>(
      `/projects/${id}/backend?environment=${environment}`,
    ),
  saveBackend: (id: string, input: BackendConfigurationInput, environment = "development") =>
    request<{ configuration: BackendConfiguration }>(
      `/projects/${id}/backend?environment=${environment}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  disconnectBackend: (id: string, environment = "development") =>
    request(`/projects/${id}/backend?environment=${environment}`, { method: "DELETE" }),

  /** Vault — a team's, or the instance's. No call returns a value except the reveals. */
  /** Outside agents (Claude Code, Codex, any MCP client) and what they ask to be approved. */
  agents: {
    list: (teamId: string) => request<{ agents: Agent[] }>(`/teams/${teamId}/agents`),
    create: (teamId: string, input: AgentCreate) =>
      request<AgentCreated>(`/teams/${teamId}/agents`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (teamId: string, agentId: string, input: AgentUpdate) =>
      request<{ agent: Agent }>(`/teams/${teamId}/agents/${agentId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    rotate: (teamId: string, agentId: string) =>
      request<AgentCreated>(`/teams/${teamId}/agents/${agentId}/rotate`, { method: "POST" }),
    revoke: (teamId: string, agentId: string) =>
      request<{ agent: Agent }>(`/teams/${teamId}/agents/${agentId}/revoke`, { method: "POST" }),
    connections: (teamId: string, agentId: string) =>
      request<{ connections: { name: string; since: string }[] }>(
        `/teams/${teamId}/agents/${agentId}/connections`,
      ),
    disconnect: (teamId: string, agentId: string) =>
      request<void>(`/teams/${teamId}/agents/${agentId}/connections`, { method: "DELETE" }),
    remove: (teamId: string, agentId: string) =>
      request<void>(`/teams/${teamId}/agents/${agentId}`, { method: "DELETE" }),
    requests: (teamId: string, status?: string) =>
      request<{ requests: AgentProposal[] }>(
        `/teams/${teamId}/agent-requests${status ? `?status=${status}` : ""}`,
      ),
    decide: (teamId: string, requestId: string, decision: "approve" | "decline") =>
      request<{ request: AgentProposal }>(`/teams/${teamId}/agent-requests/${requestId}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      }),
  },
  vault: {
    list: (scope: VaultScope) => request<{ secrets: VaultEntry[] }>(vaultPath(scope)),
    choices: (scope: VaultScope) =>
      request<{ choices: { name: string; protected: boolean; selectable: boolean }[] }>(
        `${vaultPath(scope)}/choices`,
      ),
    create: (scope: VaultScope, input: VaultEntryCreate) =>
      request<{ secret: VaultEntry }>(vaultPath(scope), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (scope: VaultScope, id: string, input: VaultEntryUpdate) =>
      request<{ secret: VaultEntry }>(`${vaultPath(scope)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (scope: VaultScope, id: string) =>
      request<{ ok: true }>(`${vaultPath(scope)}/${id}`, { method: "DELETE" }),
    reveal: (scope: VaultScope, id: string) =>
      request<{ value: string }>(`${vaultPath(scope)}/${id}/reveal`, { method: "POST" }),
    versions: (scope: VaultScope, id: string) =>
      request<{ versions: VaultVersion[] }>(`${vaultPath(scope)}/${id}/versions`),
    rollback: (scope: VaultScope, id: string, version: number) =>
      request<{ secret: VaultEntry }>(`${vaultPath(scope)}/${id}/rollback`, {
        method: "POST",
        body: JSON.stringify({ version }),
      }),
    import: (scope: VaultScope, input: VaultImport) =>
      request<{ result: VaultImportResult }>(`${vaultPath(scope)}/import`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    activity: (scope: VaultScope) =>
      request<{ entries: AuditLogEntry[] }>(`${vaultPath(scope)}/activity`),
    keys: (teamId: string) => request<{ keys: VaultServiceKey[] }>(`/teams/${teamId}/vault-keys`),
    createKey: (teamId: string, input: VaultServiceKeyCreate) =>
      request<VaultServiceKeyCreated>(`/teams/${teamId}/vault-keys`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    rotateKey: (teamId: string, id: string) =>
      request<VaultServiceKeyCreated>(`/teams/${teamId}/vault-keys/${id}/rotate`, {
        method: "POST",
      }),
    revokeKey: (teamId: string, id: string) =>
      request<{ key: VaultServiceKey }>(`/teams/${teamId}/vault-keys/${id}/revoke`, {
        method: "POST",
      }),
  },

  /** Pipelines, their runs, the team's runners and SSH key. */
  /** Ops, the team's DevOps engineer. */
  ops: {
    get: (teamId: string) => request<{ engineer: OpsEngineer | null }>(`/teams/${teamId}/ops`),
    /** The watch: every app's light, uptime and open alerts. */
    status: (teamId: string) => request<OpsStatusView>(`/teams/${teamId}/ops/status`),
    acknowledge: (teamId: string, alertId: string) =>
      request<OpsStatusView>(`/teams/${teamId}/ops/alerts/${alertId}/acknowledge`, {
        method: "POST",
        body: "{}",
      }),
    silence: (teamId: string, alertId: string, minutes: number) =>
      request<OpsStatusView>(`/teams/${teamId}/ops/alerts/${alertId}/silence`, {
        method: "POST",
        body: JSON.stringify({ minutes }),
      }),
    /** Where alerts reach people: the team's services, each person's chats and choices. */
    channels: (teamId: string) => request<OpsChannelsView>(`/teams/${teamId}/ops/channels`),
    connectChannel: (
      teamId: string,
      kind: OpsChannelKind,
      input: { token?: string; webhook?: string; teamChat?: string | null },
    ) =>
      request<OpsChannelsView>(`/teams/${teamId}/ops/channels/${kind}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    disconnectChannel: (teamId: string, kind: OpsChannelKind) =>
      request<OpsChannelsView>(`/teams/${teamId}/ops/channels/${kind}`, { method: "DELETE" }),
    testChannel: (teamId: string, kind: OpsChannelKind) =>
      request<OpsChannelsView & { went: string[] }>(`/teams/${teamId}/ops/channels/${kind}/test`, {
        method: "POST",
        body: "{}",
      }),
    setTeamAudiences: (teamId: string, kind: OpsChannelKind, audiences: string[]) =>
      request<OpsChannelsView>(`/teams/${teamId}/ops/channels/${kind}/team-audiences`, {
        method: "PUT",
        body: JSON.stringify({ audiences }),
      }),
    startLink: (teamId: string, kind: OpsChannelKind, slackEmail?: string) =>
      request<OpsLinkStart>(`/teams/${teamId}/ops/channels/${kind}/link`, {
        method: "POST",
        body: JSON.stringify(slackEmail ? { slackEmail } : {}),
      }),
    confirmSlack: (teamId: string, code: string) =>
      request<OpsChannelsView>(`/teams/${teamId}/ops/channels/slack/confirm`, {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    unlink: (teamId: string, linkId: string) =>
      request<OpsChannelsView>(`/teams/${teamId}/ops/channel-links/${linkId}`, {
        method: "DELETE",
      }),
    setNotify: (teamId: string, prefs: OpsNotifyPrefs) =>
      request<OpsChannelsView>(`/teams/${teamId}/ops/notify`, {
        method: "PUT",
        body: JSON.stringify(prefs),
      }),
    setCheck: (teamId: string, checkId: string, enabled: boolean) =>
      request<OpsStatusView>(`/teams/${teamId}/ops/checks/${checkId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    setUp: (teamId: string) =>
      request<{ engineer: OpsEngineer }>(`/teams/${teamId}/ops`, { method: "POST", body: "{}" }),
    update: (
      teamId: string,
      input: { paused?: boolean; monthlyTokenCap?: number | null; timeZone?: string },
    ) =>
      request<{ engineer: OpsEngineer }>(`/teams/${teamId}/ops`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    jobs: (teamId: string) => request<{ jobs: OpsJobSummary[] }>(`/teams/${teamId}/ops/jobs`),
    waiting: (teamId: string) =>
      request<{
        waiting: Array<{
          jobId: string;
          kind: "plan" | "step";
          request: string;
          words: string;
          createdAt: string;
          canDecide: boolean;
          why: string | null;
        }>;
      }>(`/teams/${teamId}/ops/waiting`),
    job: (teamId: string, jobId: string) =>
      request<{ job: OpsJobDetail }>(`/teams/${teamId}/ops/jobs/${jobId}`),
    talk: (teamId: string, input: { text: string; jobId?: string; spoken?: boolean }) =>
      request<{ job: OpsJobDetail }>(`/teams/${teamId}/ops/talk`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    decide: (
      teamId: string,
      jobId: string,
      input: { decision: "approve" | "reject"; planHash: string; comment?: string },
    ) =>
      request<{ job: OpsJobDetail }>(`/teams/${teamId}/ops/jobs/${jobId}/plan`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    confirmStep: (teamId: string, jobId: string, stepId: string) =>
      request<{ job: OpsJobDetail }>(`/teams/${teamId}/ops/jobs/${jobId}/steps/${stepId}/confirm`, {
        method: "POST",
        body: "{}",
      }),
    stop: (teamId: string, jobId: string) =>
      request<{ job: OpsJobDetail }>(`/teams/${teamId}/ops/jobs/${jobId}/stop`, {
        method: "POST",
        body: "{}",
      }),
    environments: (teamId: string) =>
      request<{ environments: OpsEnvironmentTrust[] }>(`/teams/${teamId}/ops/environments`),
    setTrust: (teamId: string, environmentId: string, trust: OpsTrust) =>
      request<{ environments: OpsEnvironmentTrust[] }>(
        `/teams/${teamId}/ops/environments/${environmentId}`,
        { method: "PATCH", body: JSON.stringify({ trust }) },
      ),
    access: (teamId: string) => request<{ items: OpsAccessItem[] }>(`/teams/${teamId}/ops/access`),
    setAccess: (teamId: string, input: OpsAccessChange) =>
      request<{ items: OpsAccessItem[] }>(`/teams/${teamId}/ops/access`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    memory: (teamId: string) => request<OpsMemoryView>(`/teams/${teamId}/ops/memory`),
    addWish: (teamId: string, input: { text: string; scope?: string }) =>
      request<OpsMemoryView>(`/teams/${teamId}/ops/memory/wishes`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    editWish: (teamId: string, id: string, input: { text?: string; active?: boolean }) =>
      request<OpsMemoryView>(`/teams/${teamId}/ops/memory/wishes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    removeWish: (teamId: string, id: string) =>
      request<OpsMemoryView>(`/teams/${teamId}/ops/memory/wishes/${id}`, { method: "DELETE" }),
    editLesson: (
      teamId: string,
      id: string,
      input: { rule?: string; status?: "active" | "retired"; retiredReason?: string },
    ) =>
      request<OpsMemoryView>(`/teams/${teamId}/ops/memory/lessons/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    switchCheck: (teamId: string, id: string, active: boolean) =>
      request<OpsMemoryView>(`/teams/${teamId}/ops/memory/checks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      }),
    writeSheet: (teamId: string, input: { subject: string; body: string }) =>
      request<OpsMemoryView>(`/teams/${teamId}/ops/memory/sheets`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
  },
  pipelines: {
    list: (teamId: string) =>
      request<{ pipelines: PipelineSummary[] }>(`/teams/${teamId}/pipelines`),
    get: (teamId: string, id: string) =>
      request<{ pipeline: PipelineDetail }>(`/teams/${teamId}/pipelines/${id}`),
    check: (teamId: string, source: string) =>
      request<PipelineCheck>(`/teams/${teamId}/pipelines/check`, {
        method: "POST",
        body: JSON.stringify({ source }),
      }),
    create: (teamId: string, source: string) =>
      request<{ pipeline: PipelineDetail }>(`/teams/${teamId}/pipelines`, {
        method: "POST",
        body: JSON.stringify({ source }),
      }),
    update: (teamId: string, id: string, source: string) =>
      request<{ pipeline: PipelineDetail }>(`/teams/${teamId}/pipelines/${id}`, {
        method: "PUT",
        body: JSON.stringify({ source }),
      }),
    remove: (teamId: string, id: string) =>
      request<void>(`/teams/${teamId}/pipelines/${id}`, { method: "DELETE" }),
    versions: (teamId: string, id: string) =>
      request<{ versions: PipelineVersionSummary[] }>(`/teams/${teamId}/pipelines/${id}/versions`),
    version: (teamId: string, id: string, version: number) =>
      request<{ version: { version: number; name: string; source: string; createdAt: string } }>(
        `/teams/${teamId}/pipelines/${id}/versions/${version}`,
      ),
    restore: (teamId: string, id: string, version: number) =>
      request<{ pipeline: PipelineDetail }>(
        `/teams/${teamId}/pipelines/${id}/versions/${version}/restore`,
        { method: "POST" },
      ),
    runs: (teamId: string, id: string) =>
      request<{ runs: PipelineRunSummary[] }>(`/teams/${teamId}/pipelines/${id}/runs`),
    start: (teamId: string, id: string, inputs?: Record<string, string>) =>
      request<{ run: PipelineRunSummary }>(`/teams/${teamId}/pipelines/${id}/runs`, {
        method: "POST",
        body: JSON.stringify(inputs && Object.keys(inputs).length ? { inputs } : {}),
      }),
    run: (teamId: string, runId: string) =>
      request<{ run: PipelineRunDetail }>(`/teams/${teamId}/pipeline-runs/${runId}`),
    logs: (teamId: string, runId: string, after: number) =>
      request<{ lines: RunLogLine[]; done: boolean }>(
        `/teams/${teamId}/pipeline-runs/${runId}/logs?after=${after}`,
      ),
    waitingApprovals: (teamId: string) =>
      request<{
        approvals: Array<{
          runId: string;
          approvalId: string;
          pipelineId: string;
          pipeline: string;
          run: number;
          message: string;
          deadline: string;
          createdAt: string;
          canDecide: boolean;
          why: string | null;
        }>;
      }>(`/teams/${teamId}/pipeline-approvals/waiting`),
    decide: (
      teamId: string,
      runId: string,
      approvalId: string,
      decision: "approved" | "rejected",
      comment: string | null,
    ) =>
      request<{ run: PipelineRunDetail }>(
        `/teams/${teamId}/pipeline-runs/${runId}/approvals/${approvalId}`,
        { method: "POST", body: JSON.stringify({ decision, comment }) },
      ),
    cancel: (teamId: string, runId: string) =>
      request<{ run: PipelineRunSummary }>(`/teams/${teamId}/pipeline-runs/${runId}/cancel`, {
        method: "POST",
      }),
    rerun: (teamId: string, runId: string, fromStage: number | null) =>
      request<{ run: PipelineRunSummary }>(`/teams/${teamId}/pipeline-runs/${runId}/rerun`, {
        method: "POST",
        body: JSON.stringify({ fromStage }),
      }),
    artifactUrl: (teamId: string, artifactId: string) =>
      `/api/teams/${teamId}/pipeline-artifacts/${artifactId}`,
    triggers: (teamId: string, id: string) =>
      request<{ triggers: PipelineTriggerSummary[] }>(`/teams/${teamId}/pipelines/${id}/triggers`),
    addTrigger: (teamId: string, id: string, input: TriggerInput) =>
      request<{ trigger: PipelineTriggerSummary; secret: string | null }>(
        `/teams/${teamId}/pipelines/${id}/triggers`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    editTrigger: (teamId: string, id: string, triggerId: string, input: TriggerInput) =>
      request<{ trigger: PipelineTriggerSummary }>(
        `/teams/${teamId}/pipelines/${id}/triggers/${triggerId}`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    setTrigger: (teamId: string, id: string, triggerId: string, enabled: boolean) =>
      request<{ trigger: PipelineTriggerSummary }>(
        `/teams/${teamId}/pipelines/${id}/triggers/${triggerId}`,
        { method: "PATCH", body: JSON.stringify({ enabled }) },
      ),
    removeTrigger: (teamId: string, id: string, triggerId: string) =>
      request<void>(`/teams/${teamId}/pipelines/${id}/triggers/${triggerId}`, { method: "DELETE" }),
    stats: (teamId: string, days: number) =>
      request<{ stats: PipelineStats }>(`/teams/${teamId}/pipeline-stats?days=${days}`),
    /** Keeps the file in its repository at `path`: every run reads it there. */
    linkRepo: (teamId: string, id: string, path: string) =>
      request<{ pipeline: PipelineDetail }>(`/teams/${teamId}/pipelines/${id}/repo`, {
        method: "PUT",
        body: JSON.stringify({ path }),
      }),
    pullRepo: (teamId: string, id: string) =>
      request<{ pipeline: PipelineDetail }>(`/teams/${teamId}/pipelines/${id}/repo/pull`, {
        method: "POST",
      }),
    unlinkRepo: (teamId: string, id: string) =>
      request<{ pipeline: PipelineDetail }>(`/teams/${teamId}/pipelines/${id}/repo`, {
        method: "DELETE",
      }),
    setFavorite: (teamId: string, id: string, favorite: boolean) =>
      request<void>(`/teams/${teamId}/pipelines/${id}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ favorite }),
      }),
    plugins: (teamId: string) =>
      request<{ plugins: PipelinePluginSummary[] }>(`/teams/${teamId}/pipeline-plugins`),
    /** A plugin package (.tar.gz), sent as the body itself. */
    installPlugin: (teamId: string, file: Blob) =>
      request<{ plugin: PipelinePluginSummary }>(`/teams/${teamId}/pipeline-plugins`, {
        method: "POST",
        body: file,
        headers: { "content-type": "application/gzip" },
      }),
    removePlugin: (teamId: string, id: string) =>
      request<void>(`/teams/${teamId}/pipeline-plugins/${id}`, { method: "DELETE" }),
    /** Zelyq's plugin registry: whether it is on, what it has, installing from it. */
    registryStatus: () => request<{ enabled: boolean; uploads?: boolean }>("/plugin-registry"),
    registryPlugins: (teamId: string, q?: string) =>
      request<{
        plugins: RegistryPluginSummary[];
        yanked: { id: string; version: string; reason: string }[];
      }>(`/teams/${teamId}/plugin-registry/plugins${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    registryPlugin: (teamId: string, id: string) =>
      request<{ plugin: RegistryPluginDetail }>(`/teams/${teamId}/plugin-registry/plugins/${id}`),
    registryInstall: (teamId: string, id: string, version: string) =>
      request<{ plugin: PipelinePluginSummary }>(`/teams/${teamId}/plugin-registry/install`, {
        method: "POST",
        body: JSON.stringify({ id, version }),
      }),
  },

  deploys: {
    environments: (teamId: string) =>
      request<{ environments: EnvironmentSummary[] }>(`/teams/${teamId}/environments`),
    createEnvironment: (teamId: string, input: EnvironmentInput) =>
      request<{ environment: EnvironmentSummary }>(`/teams/${teamId}/environments`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateEnvironment: (teamId: string, id: string, input: EnvironmentUpdate) =>
      request<{ environment: EnvironmentSummary }>(`/teams/${teamId}/environments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    /** With `withApps`, its live apps are removed from the machine first. */
    removeEnvironment: (teamId: string, id: string, withApps = false) =>
      request<void>(`/teams/${teamId}/environments/${id}${withApps ? "?apps=remove" : ""}`, {
        method: "DELETE",
      }),
    history: (teamId: string, environmentId: string, app: string) =>
      request<{ deployments: DeploymentSummary[] }>(
        `/teams/${teamId}/environments/${environmentId}/deployments?app=${encodeURIComponent(app)}`,
      ),
    deployment: (teamId: string, deploymentId: string) =>
      request<{ deployment: DeploymentDetail }>(`/teams/${teamId}/deployments/${deploymentId}`),
    /** Asks the proxy to try for its certificate now, and checks the address again. */
    checkAgain: (teamId: string, deploymentId: string) =>
      request<{ deployment: DeploymentSummary }>(
        `/teams/${teamId}/deployments/${deploymentId}/check`,
        { method: "POST" },
      ),
    promote: (teamId: string, deploymentId: string, environmentId: string) =>
      request<{ deployment: DeploymentSummary }>(
        `/teams/${teamId}/deployments/${deploymentId}/promote`,
        { method: "POST", body: JSON.stringify({ environmentId }) },
      ),
    /** The app's container right now: state, CPU and memory, and output after `since`. */
    app: (teamId: string, environmentId: string, app: string, since: string | null) =>
      request<{ status: AppStatus }>(
        `/teams/${teamId}/environments/${environmentId}/apps/${encodeURIComponent(app)}${
          since ? `?since=${encodeURIComponent(since)}` : ""
        }`,
      ),
    /** The exact address the app is reached at; applied right away when it is live by name. */
    setAddress: (teamId: string, environmentId: string, app: string, input: AppAddressInput) =>
      request<{ applied: boolean; deployment: DeploymentSummary | null }>(
        `/teams/${teamId}/environments/${environmentId}/apps/${encodeURIComponent(app)}/address`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    /** Takes the app off its machine (or, with `forget`, only out of Zelyq). */
    removeApp: (teamId: string, environmentId: string, app: string, forget = false) =>
      request<void>(
        `/teams/${teamId}/environments/${environmentId}/apps/${encodeURIComponent(app)}${forget ? "?forget=true" : ""}`,
        { method: "DELETE" },
      ),
    /** Sets up the machine's own nginx for the app, with its certificate. */
    setUpWebServer: (teamId: string, environmentId: string, app: string) =>
      request<{ log: string[]; deployment: DeploymentSummary }>(
        `/teams/${teamId}/environments/${environmentId}/apps/${encodeURIComponent(app)}/web-server`,
        { method: "POST" },
      ),
    appAction: (teamId: string, environmentId: string, app: string, action: AppAction) =>
      request<{ status: AppStatus }>(
        `/teams/${teamId}/environments/${environmentId}/apps/${encodeURIComponent(app)}/action`,
        { method: "POST", body: JSON.stringify({ action }) },
      ),
    rollBack: (teamId: string, deploymentId: string) =>
      request<{ deployment: DeploymentSummary }>(
        `/teams/${teamId}/deployments/${deploymentId}/roll-back`,
        {
          method: "POST",
        },
      ),
  },

  runners: {
    list: (teamId: string) =>
      request<{ runners: RunnerSummary[]; local: LocalRunnerStatus }>(`/teams/${teamId}/runners`),
    create: (teamId: string, input: SshRunnerInput) =>
      request<{ runner: RunnerSummary }>(`/teams/${teamId}/runners`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    /** A runner that connects out to Zelyq; its install code is given only here. */
    createAgent: (teamId: string, input: AgentRunnerInput) =>
      request<{ runner: RunnerSummary; install: RunnerAgentInstall }>(
        `/teams/${teamId}/runners/agent`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    installCode: (teamId: string, id: string) =>
      request<{ install: RunnerAgentInstall }>(`/teams/${teamId}/runners/${id}/install-code`, {
        method: "POST",
      }),
    update: (teamId: string, id: string, input: SshRunnerUpdate) =>
      request<{ runner: RunnerSummary }>(`/teams/${teamId}/runners/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (teamId: string, id: string) =>
      request<void>(`/teams/${teamId}/runners/${id}`, { method: "DELETE" }),
    test: (teamId: string, id: string) =>
      request<RunnerTestResult>(`/teams/${teamId}/runners/${id}/test`, { method: "POST" }),
    confirm: (teamId: string, id: string, fingerprint: string) =>
      request<{ runner: RunnerSummary }>(`/teams/${teamId}/runners/${id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ fingerprint }),
      }),
    disk: (teamId: string, id: string) =>
      request<{ disk: RunnerDisk }>(`/teams/${teamId}/runners/${id}/disk`),
    clearDisk: (teamId: string, id: string, what: "tools" | "cache") =>
      request<{ disk: RunnerDisk }>(`/teams/${teamId}/runners/${id}/disk/clear`, {
        method: "POST",
        body: JSON.stringify({ what }),
      }),
    keys: (teamId: string) => request<{ keys: TeamSshKeySummary[] }>(`/teams/${teamId}/ssh-keys`),
    rotateKey: (teamId: string, algorithm: "ed25519" | "rsa") =>
      request<{ keys: TeamSshKeySummary[] }>(`/teams/${teamId}/ssh-keys/rotate`, {
        method: "POST",
        body: JSON.stringify({ algorithm }),
      }),
    retireOldKeys: (teamId: string) =>
      request<void>(`/teams/${teamId}/ssh-keys/retire-old`, { method: "POST" }),
  },

  /** A project's variables — each typed, or taken from the team Vault. */
  variables: {
    list: (projectId: string) =>
      request<{ variables: ProjectVariable[] }>(`/projects/${projectId}/variables`),
    create: (projectId: string, input: ProjectVariableCreate) =>
      request<{ variable: ProjectVariable }>(`/projects/${projectId}/variables`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (projectId: string, id: string, input: ProjectVariableUpdate) =>
      request<{ variable: ProjectVariable }>(`/projects/${projectId}/variables/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (projectId: string, id: string) =>
      request<{ ok: true }>(`/projects/${projectId}/variables/${id}`, { method: "DELETE" }),
    reveal: (projectId: string, id: string) =>
      request<{ value: string }>(`/projects/${projectId}/variables/${id}/reveal`, {
        method: "POST",
      }),
    versions: (projectId: string, id: string) =>
      request<{ versions: VaultVersion[] }>(`/projects/${projectId}/variables/${id}/versions`),
    rollback: (projectId: string, id: string, version: number) =>
      request<{ variable: ProjectVariable }>(`/projects/${projectId}/variables/${id}/rollback`, {
        method: "POST",
        body: JSON.stringify({ version }),
      }),
    import: (projectId: string, input: VaultImport) =>
      request<{ result: VaultImportResult }>(`/projects/${projectId}/variables/import`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    functions: (projectId: string) =>
      request<{ status: FunctionSecretsStatus }>(`/projects/${projectId}/variables/functions`),
    syncFunctions: (projectId: string) =>
      request<{ status: FunctionSecretsStatus }>(
        `/projects/${projectId}/variables/functions/sync`,
        { method: "POST" },
      ),
  },
  inspectBackend: (id: string) => request(`/projects/${id}/backend/inspect`, { method: "POST" }),
  imageCapabilities: (teamId?: string) =>
    request<ImageCapabilities>(`/images/capabilities${teamQuery(teamId)}`),
  videoCapabilities: (teamId?: string) =>
    request<VideoCapabilities>(`/videos/capabilities${teamQuery(teamId)}`),
  videoHistory: (cursor?: string, teamId?: string) =>
    request<VideoHistory>(`/videos/generations${listQuery(cursor, teamId)}`),
  videoGeneration: (id: string) =>
    request<{ generation: VideoGeneration }>(`/videos/generations/${id}`),
  generateVideo: (input: VideoGenerationInput, teamId?: string) =>
    request<{ generation: VideoGeneration }>(`/videos/generations${teamQuery(teamId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  uploadVideoReference: (file: File) => {
    const body = new FormData();
    body.append("image", file);
    return request<{ reference: VideoReference }>("/videos/references", { method: "POST", body });
  },
  videoReferenceFromImage: (imageId: string) =>
    request<{ reference: VideoReference }>("/videos/references/from-image", {
      method: "POST",
      body: JSON.stringify({ imageId }),
    }),
  deleteVideoReference: (id: string) =>
    request<void>(`/videos/references/${id}`, { method: "DELETE" }),
  deleteVideo: (id: string, acknowledge = false) =>
    request<void>(`/videos/generations/${id}${acknowledge ? "?acknowledge=1" : ""}`, {
      method: "DELETE",
    }),
  videoFrames: (id: string) =>
    request<{ frames: VideoFrameSet }>(`/videos/generations/${id}/frames`),
  extractVideoFrames: (id: string, input: FrameExportInput) =>
    request<{ frames: VideoFrameSet }>(`/videos/generations/${id}/frames`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteVideoFrames: (id: string) =>
    request<void>(`/videos/generations/${id}/frames`, { method: "DELETE" }),

  cancelVideo: (id: string) =>
    request<{ generation: VideoGeneration }>(`/videos/generations/${id}/cancel`, {
      method: "POST",
    }),
  reconcileVideo: (id: string) =>
    request<{ generation: VideoGeneration }>(`/videos/generations/${id}/reconcile`, {
      method: "POST",
    }),
  imageHistory: (cursor?: string, teamId?: string) =>
    request<ImageHistory>(`/images/generations${listQuery(cursor, teamId)}`),
  imageGeneration: (id: string) =>
    request<{ generation: ImageGeneration }>(`/images/generations/${id}`),
  generateImage: (input: ImageGenerationInput, teamId?: string) =>
    request<{ generation: ImageGeneration }>(`/images/generations${teamQuery(teamId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteImage: (id: string) => request<void>(`/images/generations/${id}`, { method: "DELETE" }),

  /** What this server offers at sign-in: self-hosted, or managed by an account service. */
  authStatus: () => request<InstanceStatus>("/auth/status"),

  forgotPassword: (email: string) =>
    request<{ sent: boolean }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  /** Signs in, or — with two-factor on — answers `signInAgain`: the code is still asked. */
  resetPassword: (input: { token: string; password: string }) =>
    request<SessionResponse | { signInAgain: true }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  lookupInvite: (token: string) =>
    request<{
      email: string;
      teamName: string;
      role: string;
      invitedBy: string | null;
      accountExists: boolean;
    }>("/auth/invite/lookup", { method: "POST", body: JSON.stringify({ token }) }),

  acceptInvite: (input: { token: string; name?: string; password?: string }) =>
    request<SessionResponse & { teamId: string }>("/auth/invite/accept", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  me: () => request<SessionResponse>("/auth/me"),

  register: (input: { email: string; name: string; password: string }) =>
    request<SessionResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) }),

  /** A session, or — with two-factor on — a challenge the code completes. */
  login: (input: { email: string; password: string }) =>
    request<SessionResponse | TwoFactorRequired>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  loginTwoFactor: (input: { challenge: string; code: string }) =>
    request<SessionResponse>("/auth/login/two-factor", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  twoFactor: {
    status: () => request<{ enabled: boolean; recoveryCodesLeft: number }>("/auth/two-factor"),
    setup: (password: string) =>
      request<{ secret: string; otpauthUri: string }>("/auth/two-factor/setup", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    enable: (code: string) =>
      request<{ recoveryCodes: string[] }>("/auth/two-factor/enable", {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    disable: (input: { password: string; code: string }) =>
      request<void>("/auth/two-factor/disable", { method: "POST", body: JSON.stringify(input) }),
    recoveryCodes: (input: { password: string; code: string }) =>
      request<{ recoveryCodes: string[] }>("/auth/two-factor/recovery-codes", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },

  signedInSessions: {
    list: () => request<{ sessions: SignedInSession[] }>("/auth/sessions"),
    end: (id: string) => request<void>(`/auth/sessions/${id}`, { method: "DELETE" }),
    endOthers: () => request<{ ended: number }>("/auth/sessions", { method: "DELETE" }),
  },

  setPreferences: (input: { locale?: string | null; timeZone?: string | null }) =>
    request<SessionResponse>("/auth/preferences", { method: "PATCH", body: JSON.stringify(input) }),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  updateProfile: (input: UpdateProfileInput) =>
    request<SessionResponse>("/auth/profile", { method: "PATCH", body: JSON.stringify(input) }),

  changePassword: (input: ChangePasswordInput) =>
    request<{ changed: boolean }>("/auth/password", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getSettings: () => request<SettingsResponse>("/settings"),

  /** What the chat's model picker offers — open to anyone signed in. */
  getProviders: (teamId?: string) => request<AvailableProviders>(`/providers${teamQuery(teamId)}`),

  /** Point a credential field at a Vault secret — the instance's, or a team's
   * (`vault` is "instance" or a team id) — or (null) clear it. */
  setCredentialSource: (key: string, vaultName: string | null, vault = "instance") =>
    request<SettingsResponse>(`/settings/${encodeURIComponent(key)}/source`, {
      method: "PUT",
      body: JSON.stringify({ vaultName, vault }),
    }),
  /** Every Vault an administrator can take a Settings key from, names only. */
  settingsVaultChoices: () =>
    request<{ groups: { scope: string; label: string; names: string[] }[] }>(
      "/settings/vault-choices",
    ),
  updateSettings: (changes: UpdateSettingsInput) =>
    request<SettingsResponse>("/settings", { method: "PUT", body: JSON.stringify(changes) }),

  /** Settings → Email: signs in to the mail server and sends the admin a test message. */
  testMail: () => request<{ ok: true; to: string }>("/settings/mail/test", { method: "POST" }),
  /** Instance administrator only: proves Settings → Storage works. */
  testStorage: () =>
    request<{ ok: true; where: string }>("/settings/storage/test", { method: "POST" }),
  /** Instance administrator only: puts apps unused for at least `days` days to sleep now. */
  sleepAppsNow: (days: number) =>
    request<{ slept: number }>("/settings/storage/sleep-now", {
      method: "POST",
      body: JSON.stringify({ days }),
    }),

  /** Instance administrator only. Takes effect on the agent's next restart. */
  uploadSkill: (input: UploadSkillInput) =>
    request<{ skill: { name: string; description: string; fileCount: number } }>("/skills", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Existence only. Safe to call whenever Settings renders. */
  detectCliSession: (provider: "anthropic" | "openai") =>
    request<{ found: boolean }>(`/settings/cli-sessions/${provider}`),

  /** The actual read, triggered only by an explicit click. Named
   * "connect", not "use…" — a plain fetch wrapper, not a hook, and the
   * `use` prefix reads as one to lint tooling and to a skimming eye alike. */
  connectCliSession: (provider: "anthropic" | "openai") =>
    request<SettingsResponse>(`/settings/cli-sessions/${provider}/use`, { method: "POST" }),

  /** Every account on this instance — instance administrator only. */
  listUsers: () => request<{ users: User[] }>("/users"),

  deleteUser: (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }),

  /** Server admin: turn off someone's two-factor sign-in (lost phone and codes). */
  resetUserTwoFactor: (id: string) =>
    request<void>(`/users/${id}/two-factor`, { method: "DELETE" }),

  listTeams: () => request<{ teams: TeamMembership[] }>("/teams"),

  createTeam: (name: string) =>
    request<{ team: TeamMembership }>("/teams", { method: "POST", body: JSON.stringify({ name }) }),

  listMembers: (teamId: string) => request<{ members: TeamMember[] }>(`/teams/${teamId}/members`),

  addMember: (teamId: string, input: AddMemberInput) =>
    request<{ members: TeamMember[]; invited?: string }>(`/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateMemberRole: (teamId: string, userId: string, role: Role) =>
    request<{ members: TeamMember[] }>(`/teams/${teamId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  removeMember: (teamId: string, userId: string) =>
    request<void>(`/teams/${teamId}/members/${userId}`, { method: "DELETE" }),

  teamUsage: (teamId: string, fresh = false) =>
    request<TeamUsage>(`/teams/${teamId}/usage${fresh ? "?fresh=1" : ""}`),
  freeSpace: (
    projectId: string,
    input: { keepUndo?: number; attachments?: boolean; look?: boolean },
  ) =>
    request<FreeSpaceResult>(`/projects/${projectId}/free-space`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  plans: () => request<PlansSettings & { all: Plan[] }>("/plans"),
  savePlans: (input: PlansSettings) =>
    request<PlansSettings & { all: Plan[] }>("/plans", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  /** Banners, the bell's announcements and messages, and maintenance: this person's own. */
  inboxMessages: () => request<InboxMessages>("/inbox/messages"),
  markAnnouncement: (id: string, what: "seen" | "dismiss" | "click") =>
    request<{ ok: true }>(`/inbox/announcements/${id}/${what}`, { method: "POST" }),
  markMessageRead: (id: string) =>
    request<{ ok: true }>(`/inbox/notifications/${id}/read`, { method: "POST" }),
  markAllMessagesRead: () =>
    request<{ ok: true }>("/inbox/notifications/read-all", { method: "POST" }),
  /** Whether support may look inside the team's apps, and until when. */
  supportAccess: (teamId: string) =>
    request<{ access: { until: string; by: string } | null }>(`/teams/${teamId}/support-access`),
  allowSupport: (teamId: string, hours: number) =>
    request<{ access: { until: string; by: string } }>(`/teams/${teamId}/support-access`, {
      method: "POST",
      body: JSON.stringify({ hours }),
    }),
  withdrawSupport: (teamId: string) =>
    request<{ access: null }>(`/teams/${teamId}/support-access`, { method: "DELETE" }),
  /** The owner brings back a team paused because it was not used. */
  resumeTeam: (teamId: string) =>
    request<{ status: string }>(`/teams/${teamId}/resume`, { method: "POST" }),
  adminKeys: () => request<{ keys: AdminKeySummary[] }>("/admin-keys"),
  createAdminKey: (input: { name: string; scopes: AdminScope[] }) =>
    request<CreatedAdminKey>("/admin-keys", { method: "POST", body: JSON.stringify(input) }),
  revokeAdminKey: (id: string) =>
    request<{ key: AdminKeySummary }>(`/admin-keys/${id}`, { method: "DELETE" }),
  planTeams: () =>
    request<{
      teams: Array<{
        id: string;
        name: string;
        plan: { id: string; name: string };
        storageMb: number;
        apps: number;
        members: number;
      }>;
    }>("/plans/teams"),
  cleanupLast: () => request<{ last: CleanupReportView | null }>("/cleanup"),
  cleanup: (look: boolean) =>
    request<{ last: CleanupReportView }>(`/cleanup${look ? "?look=1" : ""}`, { method: "POST" }),
  setTeamPlan: (teamId: string, plan: string) =>
    request<TeamUsage>(`/teams/${teamId}/plan`, { method: "PUT", body: JSON.stringify({ plan }) }),
  teamSettings: (teamId: string) => request<SettingsResponse>(`/teams/${teamId}/settings`),
  updateTeamSettings: (teamId: string, changes: Record<string, string | number | boolean>) =>
    request<SettingsResponse>(`/teams/${teamId}/settings`, {
      method: "PUT",
      body: JSON.stringify(changes),
    }),
  teamKeys: (teamId: string) =>
    request<{
      keys: Array<{
        provider: string;
        label: string;
        hint: string;
        source: "team" | "server" | "none";
        vaultName: string | null;
        vaultMissing: boolean;
      }>;
      usesServerKeys: boolean;
    }>(`/teams/${teamId}/ai-keys`),
  setTeamKey: (teamId: string, provider: string, key: string) =>
    request<Awaited<ReturnType<typeof api.teamKeys>>>(`/teams/${teamId}/ai-keys/${provider}`, {
      method: "PUT",
      body: JSON.stringify({ key }),
    }),
  teamKeyFromVault: (teamId: string, provider: string, vaultName: string) =>
    request<Awaited<ReturnType<typeof api.teamKeys>>>(
      `/teams/${teamId}/ai-keys/${provider}/vault`,
      {
        method: "PUT",
        body: JSON.stringify({ vaultName }),
      },
    ),
  removeTeamKey: (teamId: string, provider: string) =>
    request<Awaited<ReturnType<typeof api.teamKeys>>>(`/teams/${teamId}/ai-keys/${provider}`, {
      method: "DELETE",
    }),
  teamInvites: (teamId: string) =>
    request<{
      canInvite: boolean;
      missing?: string;
      invites: Array<{
        id: string;
        email: string;
        role: string;
        invitedBy: string | null;
        expiresAt: string;
        createdAt: string;
      }>;
    }>(`/teams/${teamId}/invites`),

  withdrawInvite: (teamId: string, inviteId: string) =>
    request<void>(`/teams/${teamId}/invites/${inviteId}`, { method: "DELETE" }),

  auditLog: (teamId: string) => request<{ entries: AuditLogEntry[] }>(`/teams/${teamId}/audit-log`),

  // — Figma integration (proposal 068) —

  figmaConfig: () => request<{ configured: boolean }>("/integrations/figma/config"),

  figmaConnection: () =>
    request<{ connection: { id: string; grantedScopes: string[]; createdAt: string } | null }>(
      "/integrations/figma/connection",
    ),

  startFigmaOAuth: () =>
    request<{ url: string }>("/integrations/figma/oauth/start", { method: "POST" }),

  disconnectFigma: () =>
    request<{ ok: true }>("/integrations/figma/connection", { method: "DELETE" }),

  // — Supabase integration —

  supabaseConfig: () => request<{ oauthConfigured: boolean }>("/integrations/supabase/config"),

  // Each takes the team for a team's own connections (Team settings → Integrations);
  // without one, the server's own (Server settings).
  listSupabaseConnections: (teamId?: string) =>
    request<{ connections: SupabaseConnection[] }>(`${supabaseBase(teamId)}/connections`),

  connectSupabasePat: (pat: string, teamId?: string) =>
    request<{ connection: SupabaseConnection }>(`${supabaseBase(teamId)}/connections/pat`, {
      method: "POST",
      body: JSON.stringify({ pat }),
    }),

  connectSupabaseVault: (vaultName: string, teamId?: string) =>
    request<{ connection: SupabaseConnection }>(`${supabaseBase(teamId)}/connections/vault`, {
      method: "POST",
      body: JSON.stringify({ vaultName }),
    }),

  startSupabaseOAuth: (teamId?: string) =>
    request<{ url: string }>(`${supabaseBase(teamId)}/connections/oauth/start`, {
      method: "POST",
    }),

  revokeSupabaseConnection: (connectionId: string, teamId?: string) =>
    request<void>(`${supabaseBase(teamId)}/connections/${connectionId}`, { method: "DELETE" }),

  listSupabaseResources: (connectionId: string, teamId?: string) =>
    request<{ resources: SupabaseResource[] }>(
      `${supabaseBase(teamId)}/connections/${connectionId}/resources`,
    ),

  listSupabaseOrgProjects: (connectionId: string, teamId?: string) =>
    request<{ projects: SupabaseOrgProject[] }>(
      `${supabaseBase(teamId)}/connections/${connectionId}/org-projects`,
    ),

  linkSupabaseResource: (
    connectionId: string,
    input: { projectRef: string; environment?: "development" | "staging" | "production" },
    teamId?: string,
  ) =>
    request<{ resource: SupabaseResource }>(
      `${supabaseBase(teamId)}/connections/${connectionId}/resources/link`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  // — a team's own email (Team settings → Email) —

  teamMail: (teamId: string) => request<{ mail: TeamMail | null }>(`/teams/${teamId}/mail`),

  saveTeamMail: (teamId: string, mail: TeamMailInput) =>
    request<{ mail: TeamMail | null }>(`/teams/${teamId}/mail`, {
      method: "PUT",
      body: JSON.stringify(mail),
    }),

  removeTeamMail: (teamId: string) =>
    request<{ mail: null }>(`/teams/${teamId}/mail`, { method: "DELETE" }),

  testTeamMail: (teamId: string) =>
    request<{ ok: true; to: string }>(`/teams/${teamId}/mail/test`, { method: "POST" }),

  getProjectSupabaseLink: (projectId: string) =>
    request<{ resource: SupabaseResource | null }>(`/projects/${projectId}/supabase-link`),

  setProjectSupabaseLink: (projectId: string, resourceId: string) =>
    request<{ ok: true }>(`/projects/${projectId}/supabase-link`, {
      method: "PUT",
      body: JSON.stringify({ resourceId }),
    }),

  clearProjectSupabaseLink: (projectId: string) =>
    request<{ ok: true }>(`/projects/${projectId}/supabase-link`, { method: "DELETE" }),

  applyAndVerifySupabase: (projectId: string) =>
    request<{
      migrations: Array<{ name: string; status: string }>;
      verification: {
        verified: boolean;
        summary: string;
        checks: Array<{ name: string; status: "pass" | "fail" | "info"; detail: string }>;
      };
    }>(`/projects/${projectId}/supabase/apply-and-verify`, { method: "POST" }),

  /** Zelyq on GitHub: whether to show the star button, and the count. */
  community: () => request<{ showStar: boolean; stars: number | null; url: string }>("/community"),

  health: () =>
    request<{
      status: string;
      provider: string;
      runtime: { ok: boolean; detail?: string };
      agent: {
        status: string;
        provider?: string;
        model?: string;
        /** Tool names loaded from `ZELYQ_PLUGIN_DIR` at the agent's last boot. */
        plugins?: string[];
        /** Skills loaded at the agent's last boot, built-in and `ZELYQ_SKILLS_DIR` — name and
         * description, enough for the composer's `/` picker to be worth choosing from.
         * Bodies stay agent-side, never sent here. */
        skills?: Array<{ name: string; description: string }>;
      };
    }>("/health"),

  listTemplates: () =>
    request<{
      templates: Array<{
        name: string;
        title: string;
        description: string;
        /** One-line stack summary the agent is told (066). */
        stack?: string;
        /** A skill whose body is force-woven for projects on this stack. */
        agentSkill?: string;
        /** Icon filename in the web app's public assets, when the stack has one. */
        icon?: string;
      }>;
    }>("/templates"),

  deleteAccount: (password: string) =>
    request<void>("/auth/me", { method: "DELETE", body: JSON.stringify({ password }) }),

  listProjects: () => request<{ projects: Project[] }>("/projects"),

  getProject: (id: string) => request<{ project: Project }>(`/projects/${id}`),

  createProject: (input: CreateProjectInput) =>
    request<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify(input) }),

  updateProject: (
    id: string,
    input: {
      imageGenerationEnabled?: boolean;
      videoGenerationEnabled?: boolean;
      name?: string;
      description?: string | null;
      modelProvider?: string | null;
      model?: string | null;
    },
  ) =>
    request<{ project: Project }>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  listFiles: (id: string) => request<{ entries: FileEntry[] }>(`/projects/${id}/files`),

  readFile: (id: string, path: string) =>
    request<FileContent>(`/projects/${id}/files/${encodeURI(path)}`),

  /** `encoding` is how `content` is packed, not how the file is stored: an
   * uploaded image travels as base64 and the runtime writes the real bytes. */
  writeFile: (id: string, path: string, content: string, encoding: "utf8" | "base64" = "utf8") =>
    request<{ written: boolean }>(`/projects/${id}/files/${encodeURI(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content, encoding }),
    }),

  /** A file from the user's machine, sent as the body itself — not base64 in
   *  JSON — so it is not capped by the API's JSON limit. */
  uploadFile: (id: string, path: string, file: Blob) =>
    request<{ written: boolean }>(`/projects/${id}/uploads/${encodeURI(path)}`, {
      method: "PUT",
      body: file,
      headers: { "content-type": "application/octet-stream" },
    }),

  /** Copy an image or video from the user's own Studio library into the
   *  project — on the server, so nothing is uploaded from the browser. */
  placeStudioMedia: (id: string, input: PlaceStudioMediaInput) =>
    request<{ path: string; sizeBytes: number }>(`/projects/${id}/studio-media`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteFile: (id: string, path: string) =>
    request<void>(`/projects/${id}/files/${encodeURI(path)}`, { method: "DELETE" }),

  getPreview: (id: string) => request<{ preview: Preview }>(`/projects/${id}/preview`),

  startPreview: (id: string) =>
    request<{ preview: Preview }>(`/projects/${id}/preview/start`, { method: "POST" }),

  stopPreview: (id: string) =>
    request<{ preview: Preview }>(`/projects/${id}/preview/stop`, { method: "POST" }),

  previewLogs: (id: string) => request<{ logs: string }>(`/projects/${id}/preview/logs`),

  listSnapshots: (id: string) => request<{ snapshots: Snapshot[] }>(`/projects/${id}/snapshots`),

  /** One file as it stood at a snapshot. 404 means the turn created it. */
  readSnapshotFile: (id: string, snapshotId: string, path: string) =>
    request<FileContent>(`/projects/${id}/snapshots/${snapshotId}/files/${encodeURI(path)}`),

  restoreSnapshot: (id: string, snapshotId: string) =>
    request<{ restored: boolean }>(`/projects/${id}/snapshots/${snapshotId}/restore`, {
      method: "POST",
    }),

  createSnapshot: (id: string, label: string) =>
    request<{ snapshot: Snapshot }>(`/projects/${id}/snapshots`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),

  /** No network on the server side either — safe to call whenever the panel opens. */
  gitStatus: (id: string) => request<{ status: GitStatus }>(`/projects/${id}/git`),

  /**
   * Changing an existing remote is refused unless `replace` is set. The refusal
   * carries `details.currentRemote`, which is what lets the UI ask "replace X
   * with Y?" instead of guessing.
   */
  setGitRemote: (id: string, input: SetGitRemoteInput) =>
    request<{ status: GitStatus }>(`/projects/${id}/git/remote`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  gitFetch: (id: string, input: GitFetchInput = {}) =>
    request<{ status: GitStatus }>(`/projects/${id}/git/fetch`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  gitPull: (id: string, input: GitPullInput) =>
    request<{ status: GitStatus & { pulled: boolean } }>(`/projects/${id}/git/pull`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Manual, on-demand. `gitUrl` only matters the first time, before a remote exists. */
  pushToRemote: (id: string, input: PushToRemoteInput) =>
    request<{
      pushed: boolean;
      branch: string;
      remote: string;
      /** Whether uncommitted work had to be committed before it could be sent. */
      committed: boolean;
      /** How many commits the remote was missing. Zero means it was already current. */
      commits: number;
      /** Whether the remote had moved on and its work was brought in first. */
      pulled: boolean;
      status: GitStatus;
    }>(`/projects/${id}/git/push`, { method: "POST", body: JSON.stringify(input) }),

  gitBranch: (id: string, input: GitBranchInput) =>
    request<{ status: GitStatus }>(`/projects/${id}/git/branch`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  createPullRequest: (id: string, input: CreatePullRequestRequest) =>
    request<{ pullRequest: PullRequestResult; status: GitStatus }>(
      `/projects/${id}/git/pull-request`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  /** `data` is base64. 8MB cap, enforced again server-side. */
  uploadAttachment: (
    projectId: string,
    input: { filename: string; mimeType: string; data: string },
  ) =>
    request<{ attachment: AttachmentRef }>(`/projects/${projectId}/attachments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  transcribeVoice: (projectId: string, input: { mimeType: string; data: string }) =>
    request<{ text: string }>(`/projects/${projectId}/voice/transcriptions`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Not a `request()` call — this is a URL for an `<img>` or a download link,
   * not JSON to parse. The browser sends the session cookie itself. */
  attachmentUrl: (projectId: string, attachmentId: string) =>
    `/api/projects/${projectId}/attachments/${attachmentId}`,
};

export interface OpsEnvironmentTrust {
  id: string;
  name: string;
  protected: boolean;
  frozen: boolean;
  trust: OpsTrust;
}

export interface OpsMemoryView {
  sheets: {
    id: string;
    subject: string;
    body: string;
    version: number;
    updatedBy: string;
    updatedAt: string;
  }[];
  wishes: {
    id: string;
    text: string;
    scope: string;
    source: string;
    active: boolean;
    createdAt: string;
  }[];
  lessons: {
    id: string;
    what: string;
    why: string;
    rule: string;
    scope: string;
    strength: string;
    source: string;
    evidence: string | null;
    status: string;
    retiredReason: string | null;
    lastMatchedAt: string | null;
    createdAt: string;
  }[];
  guards: {
    id: string;
    kind: string;
    words: string;
    scope: string;
    lessonId: string | null;
    active: boolean;
    createdBy: string;
  }[];
}
