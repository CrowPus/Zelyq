import type {
  AddMemberInput,
  AttachmentRef,
  AuditLogEntry,
  AvailableProviders,
  ChangePasswordInput,
  CreateProjectInput,
  FileContent,
  FileEntry,
  Preview,
  Project,
  PushToRemoteInput,
  Role,
  SessionResponse,
  SettingsResponse,
  Snapshot,
  TeamMember,
  TeamMembership,
  UpdateProfileInput,
  UpdateSettingsInput,
  UploadSkillInput,
  User,
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
      ...(init?.body ? { "content-type": "application/json" } : {}),
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

export const api = {
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
      }>;
    }>("/templates"),

  deleteAccount: (password: string) =>
    request<void>("/auth/me", { method: "DELETE", body: JSON.stringify({ password }) }),

  listProjects: () => request<{ projects: Project[] }>("/projects"),

  getProject: (id: string) => request<{ project: Project }>(`/projects/${id}`),

  createProject: (input: CreateProjectInput) =>
    request<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify(input) }),

  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  listFiles: (id: string) => request<{ entries: FileEntry[] }>(`/projects/${id}/files`),

  readFile: (id: string, path: string) =>
    request<FileContent>(`/projects/${id}/files/${encodeURI(path)}`),

  writeFile: (id: string, path: string, content: string) =>
    request<{ written: boolean }>(`/projects/${id}/files/${encodeURI(path)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
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

  /** Manual, on-demand. `gitUrl` only matters the first time, before a remote exists. */
  pushToRemote: (id: string, input: PushToRemoteInput) =>
    request<{ pushed: boolean }>(`/projects/${id}/git/push`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

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
