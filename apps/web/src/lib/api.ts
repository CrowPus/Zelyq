import type {
  AddMemberInput,
  AttachmentRef,
  AuditLogEntry,
  AvailableProviders,
  BackendConfiguration,
  BackendConfigurationInput,
  ChangePasswordInput,
  CreateProjectInput,
  CreatePullRequestInput,
  DeploymentDetail,
  DeploymentSummary,
  EnvironmentInput,
  EnvironmentSummary,
  EnvironmentUpdate,
  FileContent,
  FileEntry,
  FrameExportInput,
  GitBranchInput,
  GitFetchInput,
  GitPullInput,
  GitStatus,
  ImageCapabilities,
  ImageGeneration,
  ImageGenerationInput,
  ImageHistory,
  PipelineDetail,
  PipelineRunDetail,
  PipelineRunSummary,
  PipelineSummary,
  PipelineTriggerSummary,
  Preview,
  Project,
  ProjectVariable,
  ProjectVariableCreate,
  ProjectVariableUpdate,
  PullRequestResult,
  PushToRemoteInput,
  Role,
  RunLogLine,
  RunnerDisk,
  RunnerSummary,
  RunnerTestResult,
  SessionResponse,
  SetGitRemoteInput,
  SettingsResponse,
  Snapshot,
  SshRunnerInput,
  SshRunnerUpdate,
  TeamMember,
  TeamMembership,
  TeamSshKeySummary,
  TriggerInput,
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

/** Supabase integration — response shapes. */
export interface SupabaseConnection {
  id: string;
  credentialType: "oauth" | "pat";
  status: string;
  grantedScopes: string[];
  createdBy: string;
  createdAt: string;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
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
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      payload as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      } | null
    )?.error;
    throw new ApiError(
      error?.code ?? "internal",
      error?.message ?? `Request failed with ${response.status}`,
      response.status,
      error?.details,
    );
  }

  return payload as T;
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
    runs: (teamId: string, id: string) =>
      request<{ runs: PipelineRunSummary[] }>(`/teams/${teamId}/pipelines/${id}/runs`),
    start: (teamId: string, id: string, ref?: string | null) =>
      request<{ run: PipelineRunSummary }>(`/teams/${teamId}/pipelines/${id}/runs`, {
        method: "POST",
        body: JSON.stringify(ref ? { ref } : {}),
      }),
    run: (teamId: string, runId: string) =>
      request<{ run: PipelineRunDetail }>(`/teams/${teamId}/pipeline-runs/${runId}`),
    logs: (teamId: string, runId: string, after: number) =>
      request<{ lines: RunLogLine[]; done: boolean }>(
        `/teams/${teamId}/pipeline-runs/${runId}/logs?after=${after}`,
      ),
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
    setTrigger: (teamId: string, id: string, triggerId: string, enabled: boolean) =>
      request<{ trigger: PipelineTriggerSummary }>(
        `/teams/${teamId}/pipelines/${id}/triggers/${triggerId}`,
        { method: "PATCH", body: JSON.stringify({ enabled }) },
      ),
    removeTrigger: (teamId: string, id: string, triggerId: string) =>
      request<void>(`/teams/${teamId}/pipelines/${id}/triggers/${triggerId}`, { method: "DELETE" }),
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
    removeEnvironment: (teamId: string, id: string) =>
      request<void>(`/teams/${teamId}/environments/${id}`, { method: "DELETE" }),
    history: (teamId: string, environmentId: string, app: string) =>
      request<{ deployments: DeploymentSummary[] }>(
        `/teams/${teamId}/environments/${environmentId}/deployments?app=${encodeURIComponent(app)}`,
      ),
    deployment: (teamId: string, deploymentId: string) =>
      request<{ deployment: DeploymentDetail }>(`/teams/${teamId}/deployments/${deploymentId}`),
    rollBack: (teamId: string, deploymentId: string) =>
      request<{ deployment: DeploymentSummary }>(
        `/teams/${teamId}/deployments/${deploymentId}/roll-back`,
        {
          method: "POST",
        },
      ),
  },

  runners: {
    list: (teamId: string) => request<{ runners: RunnerSummary[] }>(`/teams/${teamId}/runners`),
    create: (teamId: string, input: SshRunnerInput) =>
      request<{ runner: RunnerSummary }>(`/teams/${teamId}/runners`, {
        method: "POST",
        body: JSON.stringify(input),
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
  imageCapabilities: () => request<ImageCapabilities>("/images/capabilities"),
  videoCapabilities: () => request<VideoCapabilities>("/videos/capabilities"),
  videoHistory: (cursor?: string) =>
    request<VideoHistory>(
      `/videos/generations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  videoGeneration: (id: string) =>
    request<{ generation: VideoGeneration }>(`/videos/generations/${id}`),
  generateVideo: (input: VideoGenerationInput) =>
    request<{ generation: VideoGeneration }>("/videos/generations", {
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
  imageHistory: (cursor?: string) =>
    request<ImageHistory>(
      `/images/generations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  imageGeneration: (id: string) =>
    request<{ generation: ImageGeneration }>(`/images/generations/${id}`),
  generateImage: (input: ImageGenerationInput) =>
    request<{ generation: ImageGeneration }>("/images/generations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteImage: (id: string) => request<void>(`/images/generations/${id}`, { method: "DELETE" }),

  authStatus: () => request<{ firstRun: boolean; oidcEnabled: boolean }>("/auth/status"),

  me: () => request<SessionResponse>("/auth/me"),

  register: (input: { email: string; name: string; password: string }) =>
    request<SessionResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) }),

  login: (input: { email: string; password: string }) =>
    request<SessionResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) }),

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
  getProviders: () => request<AvailableProviders>("/providers"),

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

  listTeams: () => request<{ teams: TeamMembership[] }>("/teams"),

  createTeam: (name: string) =>
    request<{ team: TeamMembership }>("/teams", { method: "POST", body: JSON.stringify({ name }) }),

  listMembers: (teamId: string) => request<{ members: TeamMember[] }>(`/teams/${teamId}/members`),

  addMember: (teamId: string, input: AddMemberInput) =>
    request<{ members: TeamMember[] }>(`/teams/${teamId}/members`, {
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

  listSupabaseConnections: () =>
    request<{ connections: SupabaseConnection[] }>("/integrations/supabase/connections"),

  connectSupabasePat: (pat: string) =>
    request<{ connection: SupabaseConnection }>("/integrations/supabase/connections/pat", {
      method: "POST",
      body: JSON.stringify({ pat }),
    }),

  startSupabaseOAuth: () =>
    request<{ url: string }>("/integrations/supabase/connections/oauth/start", { method: "POST" }),

  revokeSupabaseConnection: (connectionId: string) =>
    request<void>(`/integrations/supabase/connections/${connectionId}`, { method: "DELETE" }),

  listSupabaseResources: (connectionId: string) =>
    request<{ resources: SupabaseResource[] }>(
      `/integrations/supabase/connections/${connectionId}/resources`,
    ),

  listSupabaseOrgProjects: (connectionId: string) =>
    request<{ projects: SupabaseOrgProject[] }>(
      `/integrations/supabase/connections/${connectionId}/org-projects`,
    ),

  linkSupabaseResource: (
    connectionId: string,
    input: { projectRef: string; environment?: "development" | "staging" | "production" },
  ) =>
    request<{ resource: SupabaseResource }>(
      `/integrations/supabase/connections/${connectionId}/resources/link`,
      { method: "POST", body: JSON.stringify(input) },
    ),

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
    input: { imageGenerationEnabled?: boolean; videoGenerationEnabled?: boolean; name?: string },
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

  createPullRequest: (id: string, input: CreatePullRequestInput) =>
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
