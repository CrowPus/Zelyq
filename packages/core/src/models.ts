import { z } from "zod";

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const projectStatusSchema = z.enum([
  "creating", // template is being scaffolded
  "ready", // idle, files on disk
  "building", // an agent turn is in flight
  "error", // last operation failed; see statusMessage
  "archived",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const projectSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string().min(1).max(120),
  slug: z.string(),
  description: z.string().max(2000).nullable(),
  template: z.string(),
  status: projectStatusSchema,
  statusMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
  /** Omitted means the caller's default team. */
  teamId: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  template: z.string().default("vite-react"),
  /**
   * Clone this repository instead of scaffolding a template.
   *
   * `http://` and `https://` only. `ssh://` and `git@` are refused because they
   * need a key on the runtime, and a key that can clone can usually also push.
   * `file://` is refused because the runtime's filesystem holds every other
   * project — a local path is a way to read somebody else's work.
   *
   * `http://` is allowed on purpose: an internal git server on a private network
   * is exactly the deployment this product is for. It is the caller's network to
   * judge.
   */
  gitUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value), {
      message: "Only http:// and https:// repository URLs are supported",
    })
    .optional(),
  /**
   * A token for a private repository, used for this clone and never stored.
   *
   * Nothing at rest is nothing to leak at rest, nothing to rotate, and nothing
   * for another user of a shared instance to borrow. The cost is pasting it
   * again to refresh a clone — and refreshing does not exist yet, which is the
   * right time to design credential storage rather than now.
   */
  gitToken: z.string().min(1).max(500).optional(),
  /** Optional first instruction — the project is created, then this is sent to the agent. */
  prompt: z.string().max(20_000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const messageRoleSchema = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  // zod 4 requires both key and value types; the one-argument form is gone.
  input: z.record(z.string(), z.unknown()),
  /** Populated once the tool has run. */
  result: z.string().optional(),
  isError: z.boolean().optional(),
  durationMs: z.number().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const messageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  /** Summarised reasoning, when the model returns it. */
  thinking: z.string().nullable().optional(),
  toolCalls: z.array(toolCallSchema).default([]),
  /**
   * The project as it stood immediately before this turn, so it can be undone.
   * Null on user messages and on turns taken before snapshots were automatic.
   */
  snapshotId: z.string().nullable().optional(),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof messageSchema>;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Model vendors Zelyq can drive. The agent's registry is the source of truth.
 *
 * `custom` is not a vendor: it is any endpoint speaking the OpenAI dialect at a
 * base URL the operator supplies — Ollama, vLLM, LM Studio, an in-house
 * gateway. It is the option that lets a team keep its code on its own network.
 */
export const providerIdSchema = z.enum(["anthropic", "google", "openai", "custom"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof effortSchema>;

export const sessionStatusSchema = z.enum(["idle", "running", "closed", "error"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: sessionStatusSchema,
  provider: providerIdSchema,
  model: z.string(),
  effort: effortSchema,
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Session = z.infer<typeof sessionSchema>;

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const fileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative().optional(),
  modifiedAt: z.string().datetime().optional(),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const fileTreeSchema = z.object({
  projectId: z.string(),
  entries: z.array(fileEntrySchema),
});
export type FileTree = z.infer<typeof fileTreeSchema>;

export const fileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  truncated: z.boolean().default(false),
});
export type FileContent = z.infer<typeof fileContentSchema>;

export const writeFileSchema = z.object({
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});
export type WriteFileInput = z.infer<typeof writeFileSchema>;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export const previewStatusSchema = z.enum(["stopped", "starting", "running", "crashed"]);
export type PreviewState = z.infer<typeof previewStatusSchema>;

export const previewSchema = z.object({
  projectId: z.string(),
  status: previewStatusSchema,
  url: z.string().nullable(),
  port: z.number().int().nullable(),
  pid: z.number().int().nullable(),
  startedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});
export type Preview = z.infer<typeof previewSchema>;

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export const snapshotSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  fileCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Project- and team-level actions, per `030` in the council notes. Instance-
 * wide actions (settings, account deletion) are deliberately not here yet —
 * a separate read surface, scoped to instance admins rather than a team.
 */
export const auditActionSchema = z.enum([
  "project.created",
  "project.updated",
  "project.deleted",
  "file.written",
  "file.deleted",
  "snapshot.created",
  "snapshot.restored",
  "team.member_added",
  "team.member_role_changed",
  "team.member_removed",
]);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  teamId: z.string().nullable(),
  projectId: z.string().nullable(),
  userId: z.string().nullable(),
  /**
   * Snapshotted at write time, not joined from `users` on read — so the log
   * still says who did something after that account no longer exists.
   */
  actorName: z.string(),
  actorEmail: z.string(),
  action: auditActionSchema,
  /** Never a secret value — a path, a role, which fields changed. */
  detail: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;
