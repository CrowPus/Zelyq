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

/** Model vendors Zelyq can drive. The agent's registry is the source of truth. */
export const providerIdSchema = z.enum(["anthropic", "google"]);
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
