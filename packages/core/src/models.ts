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

/**
 * `http://` and `https://` only. `ssh://` and `git@` are refused because they
 * need a key on the runtime, and a key that can clone can usually also push.
 * `file://` is refused because the runtime's filesystem holds every other
 * project — a local path is a way to read somebody else's work.
 *
 * `http://` is allowed on purpose: an internal git server on a private network
 * is exactly the deployment this product is for. It is the caller's network to
 * judge.
 *
 * Shared by `createProjectSchema` (clone) and `pushToRemoteSchema` (push) —
 * the same address shape either direction.
 */
const gitUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), {
    message: "Only http:// and https:// repository URLs are supported",
  });

/**
 * Used for one operation and never stored — nothing at rest is nothing to
 * leak, nothing to rotate, nothing for another user of a shared instance to
 * borrow. The cost is pasting it again next time. Shared by
 * `createProjectSchema` (clone) and `pushToRemoteSchema` (push).
 */
const gitTokenSchema = z.string().min(1).max(500);

export const createProjectSchema = z.object({
  /** Omitted means the caller's default team. */
  teamId: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  template: z.string().default("vite-react"),
  /** Clone this repository instead of scaffolding a template. */
  gitUrl: gitUrlSchema.optional(),
  gitToken: gitTokenSchema.optional(),
  /** Optional first instruction — the project is created, then this is sent to the agent. */
  prompt: z.string().max(20_000).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * `gitUrl` is only needed the first time a project with no remote yet is
 * pushed — `git remote add origin` then push, the other
 * direction of the same job clone already does. Once a remote exists, later
 * pushes need only `gitToken`, if the repository is private.
 */
export const pushToRemoteSchema = z.object({
  gitUrl: gitUrlSchema.optional(),
  gitToken: gitTokenSchema.optional(),
});
export type PushToRemoteInput = z.infer<typeof pushToRemoteSchema>;

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

/**
 * Tool-input fields that carry whole-file contents. Persisted verbatim in a
 * message's `toolCalls`, `write_file` + `edit_file` inputs are ~68% of every
 * tool-call byte in the database (finding A2), and each one duplicates what is
 * on disk and re-readable with `read_file`. `stripHeavyToolInputs` replaces
 * them with a marker before a message is stored, so a session rebuilt from
 * history — after a server restart, or for a subagent — does not recarry them.
 *
 * The transcript UI never renders these (it shows `input.path` and `result`),
 * so nothing user-facing is lost. Small values are kept as-is: a one-line edit
 * is still worth seeing inline, and the saving is all in the large ones.
 */
const HEAVY_TOOL_INPUT_FIELDS: Record<string, readonly string[]> = {
  write_file: ["content"],
  edit_file: ["old_text", "new_text"],
};

export const OMITTED_TOOL_INPUT_MARKER = "[omitted from history — on disk, use read_file]";

/** A heavy field longer than this is replaced; shorter ones stay inline. */
const HEAVY_TOOL_INPUT_KEEP = 200;

export function stripHeavyToolInputs(calls: ToolCall[]): ToolCall[] {
  return calls.map((call) => {
    const heavy = HEAVY_TOOL_INPUT_FIELDS[call.name];
    if (!heavy) return call;
    let changed = false;
    const input = { ...call.input };
    for (const field of heavy) {
      const value = input[field];
      if (typeof value === "string" && value.length > HEAVY_TOOL_INPUT_KEEP) {
        input[field] = OMITTED_TOOL_INPUT_MARKER;
        changed = true;
      }
    }
    return changed ? { ...call, input } : call;
  });
}

/**
 * What a message's attachment refers to — never the bytes themselves. The
 * browser fetches those separately when it actually needs to render one;
 * a transcript that always carried them inline would make every history
 * load pay for every image ever attached, whether shown or not.
 */
export const attachmentRefSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const messageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  /** Summarised reasoning, when the model returns it. */
  thinking: z.string().nullable().optional(),
  toolCalls: z.array(toolCallSchema).default([]),
  attachments: z.array(attachmentRefSchema).default([]),
  /**
   * What the composer's `/` menu named on this message — skills, specialists,
   * plugin tools. Display only: it records what was pointed at, the `content`
   * field still holds exactly what was typed. `null` when nothing was named.
   */
  mentions: z
    .object({
      skills: z.array(z.string()).default([]),
      agents: z.array(z.string()).default([]),
      plugins: z.array(z.string()).default([]),
    })
    .nullable()
    .optional(),
  /**
   * The project as it stood immediately before this turn, so it can be undone.
   * Null on user messages and on turns taken before snapshots were automatic.
   */
  snapshotId: z.string().nullable().optional(),
  /**
   * Usage for THIS turn — not a session running total. Before the R1 fix these
   * held a cumulative figure, which is why `usageSchema: 0` rows must be
   * excluded from any baseline (`docs/token-usage/07-review-and-amendments.md`).
   */
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  /**
   * Prompt tokens served from / written to the provider's cache this turn
   * (~0.1x and ~1.25x of the input price). Optional rather than defaulted: a
   * message built client-side, or one from a provider that reports no cache
   * figures, genuinely has no value here, and a `0` would be a claim.
   */
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  /** 0 = pre-R1 cumulative figures, unusable. 1 = per-turn, trustworthy. */
  usageSchema: z.number().int().nonnegative().optional(),
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
export const providerIdSchema = z.enum([
  "anthropic",
  "google",
  "openai",
  "xai",
  "deepseek",
  "mistral",
  "groq",
  "openrouter",
  "custom",
]);
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
 * Project- and team-level actions. Instance-wide actions (settings, account
 * deletion) are deliberately not here yet —
 * a separate read surface, scoped to instance admins rather than a team.
 */
export const auditActionSchema = z.enum([
  "project.created",
  "project.updated",
  "project.deleted",
  "project.pushed",
  "file.written",
  "file.deleted",
  "snapshot.created",
  "snapshot.restored",
  "team.member_added",
  "team.member_role_changed",
  "team.member_removed",
  "provider.connected",
  "provider.disconnected",
  "provider.resource_linked",
  "provider.resource_unlinked",
  "provider.resource_provisioned",
  "provider.resource_deleted",
  "provider.auth_configured",
  "provider.migration_applied",
  "provider.function_deployed",
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

// ---------------------------------------------------------------------------
// Skill uploads
// ---------------------------------------------------------------------------

export const uploadSkillFileSchema = z.object({
  /** Relative to the skill's own root — "SKILL.md", "references/detail.md". */
  path: z.string().min(1),
  /** Base64. */
  data: z.string(),
});

export const uploadSkillSchema = z.object({
  files: z.array(uploadSkillFileSchema).min(1),
});
export type UploadSkillInput = z.infer<typeof uploadSkillSchema>;
