import type {
  AddMemberInput,
  CreateProjectInput,
  FileContent,
  FileEntry,
  Preview,
  Project,
  Role,
  SessionResponse,
  Snapshot,
  TeamMember,
  TeamMembership,
} from "@zelyq/core";

/**
 * Every call goes through `request`, so error handling, JSON parsing, and the
 * server's `{ error: { code, message } }` envelope are handled once.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
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
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      error?.code ?? "internal",
      error?.message ?? `Request failed with ${response.status}`,
      response.status,
    );
  }

  return payload as T;
}

export const api = {
  authStatus: () => request<{ firstRun: boolean }>("/auth/status"),

  me: () => request<SessionResponse>("/auth/me"),

  register: (input: { email: string; name: string; password: string }) =>
    request<SessionResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) }),

  login: (input: { email: string; password: string }) =>
    request<SessionResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) }),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

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

  health: () =>
    request<{
      status: string;
      provider: string;
      agent: { status: string; provider?: string; model?: string };
    }>("/health"),

  listTemplates: () =>
    request<{ templates: Array<{ name: string; title: string; description: string }> }>(
      "/templates",
    ),

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

  getPreview: (id: string) => request<{ preview: Preview }>(`/projects/${id}/preview`),

  startPreview: (id: string) =>
    request<{ preview: Preview }>(`/projects/${id}/preview/start`, { method: "POST" }),

  stopPreview: (id: string) =>
    request<{ preview: Preview }>(`/projects/${id}/preview/stop`, { method: "POST" }),

  previewLogs: (id: string) => request<{ logs: string }>(`/projects/${id}/preview/logs`),

  listSnapshots: (id: string) => request<{ snapshots: Snapshot[] }>(`/projects/${id}/snapshots`),

  createSnapshot: (id: string, label: string) =>
    request<{ snapshot: Snapshot }>(`/projects/${id}/snapshots`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
};
