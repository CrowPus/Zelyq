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
  /** Whether this project's agent may generate images. Off until someone
   *  turns it on — generating spends money against the instance's image key. */
  imageGenerationEnabled: z.boolean().default(false),
  /** Permission for this project's agent to generate video. Separate from the
   *  image permission: a clip costs far more than a picture. */
  videoGenerationEnabled: z.boolean().default(false),
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

/**
 * What a project's git actually looks like right now — the whole state one
 * screen needs, so the UI never has to infer it from whether an action failed.
 *
 * Read with no network access at all: every field comes from the repository on
 * disk. `ahead`/`behind` are therefore only as current as the last fetch, and
 * `fetchedAt` is included precisely so that can be said out loud rather than
 * presented as live truth.
 */
export const gitStatusSchema = z.object({
  /** False for a project that has never had a turn or a push. */
  repository: z.boolean(),
  /** Null on a detached HEAD, which `detached` then explains. */
  branch: z.string().nullable(),
  detached: z.boolean(),
  /** Commits on the current branch. 0 means a repository with no history yet. */
  commits: z.number().int().nonnegative(),
  /**
   * Zelyq manages exactly one remote and always calls it `origin` — see
   * `setGitRemoteSchema`. Credentials are stripped before this leaves the
   * server.
   */
  remote: z.string().nullable(),
  /** e.g. `origin/main`. Null until the branch has been pushed once. */
  upstream: z.string().nullable(),
  /** Commits the local branch has that the upstream does not, and vice versa. */
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  /** When `origin` was last fetched. Null if never. */
  fetchedAt: z.string().datetime().nullable(),
  /** Uncommitted changes in the working tree. */
  dirty: z.boolean(),
  /** Paths git considers unmerged. Non-empty means a pull needs finishing. */
  conflicts: z.array(z.string()),
  /** A merge, rebase or cherry-pick that was started and not finished. */
  inProgress: z.enum(["merge", "rebase", "cherry-pick"]).nullable(),
});
export type GitStatus = z.infer<typeof gitStatusSchema>;

/**
 * Setting where a project pushes to.
 *
 * `replace` exists because silently repointing a project at a different
 * repository is how work goes missing: someone pastes a new address, the push
 * succeeds, and it went somewhere they were not looking. Without it, an
 * attempt to change an existing remote is refused and the current one is
 * reported back, so the caller can ask first.
 */
export const setGitRemoteSchema = z.object({
  gitUrl: gitUrlSchema,
  replace: z.boolean().default(false),
});
export type SetGitRemoteInput = z.infer<typeof setGitRemoteSchema>;

export const gitFetchSchema = z.object({
  gitToken: gitTokenSchema.optional(),
});
export type GitFetchInput = z.infer<typeof gitFetchSchema>;

/**
 * Bringing a collaborator's commits in.
 *
 * `ff-only` is the default because it is the one strategy that cannot invent a
 * merge nobody asked for: it either applies cleanly on top or refuses. The
 * other two are only reachable by asking for them, which is the point — a
 * diverged history is a decision, not something to paper over.
 *
 * `onConflict` defaults to `abort`: a half-merged working tree is the worst
 * possible state to hand back to an agent that is about to edit files in it.
 * `keep` is for someone who intends to resolve it themselves.
 */
export const gitPullSchema = z.object({
  gitToken: gitTokenSchema.optional(),
  strategy: z.enum(["ff-only", "rebase", "merge"]).default("ff-only"),
  onConflict: z.enum(["abort", "keep"]).default("abort"),
});
export type GitPullInput = z.infer<typeof gitPullSchema>;

export const gitBranchSchema = z.object({
  /** Refused if it is not a name git will accept. */
  name: z.string().min(1).max(200),
  /** Create it if it does not exist yet. */
  create: z.boolean().default(true),
});
export type GitBranchInput = z.infer<typeof gitBranchSchema>;

/**
 * Opening a pull request, for the collaboration case where pushing straight to
 * the shared branch is the wrong move.
 *
 * GitHub only, and deliberately explicit about that rather than pretending:
 * every host has its own API, and a wrong guess would fail after the branch
 * had already been pushed. For anything else the branch is still pushed and
 * the caller is told to open it themselves.
 */
export const createPullRequestSchema = z.object({
  title: z.string().min(1).max(250),
  body: z.string().max(20_000).optional(),
  /** Defaults to a generated `zelyq/...` name based on the title. */
  branch: z.string().max(200).optional(),
  /** Defaults to the repository's own default branch. */
  base: z.string().max(200).optional(),
  gitToken: gitTokenSchema,
});
export type CreatePullRequestInput = z.infer<typeof createPullRequestSchema>;

/** What opening one produced — a real PR, or the next best thing. */
export const pullRequestResultSchema = z.object({
  /** The branch that was pushed. */
  branch: z.string(),
  base: z.string(),
  /** Null when the host is not GitHub, or the token could not open one. */
  url: z.string().nullable(),
  /** Set when `url` is null: where the caller can open it by hand. */
  compareUrl: z.string().nullable(),
  /** True when the pull request already existed and was reused. */
  existing: z.boolean(),
});
export type PullRequestResult = z.infer<typeof pullRequestResultSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  /** Permission for this project's agent to generate images. Any member of the
   *  team may set it: they can already spend model tokens and run code through
   *  the agent, so images are the same kind of decision. */
  imageGenerationEnabled: z.boolean().optional(),
  videoGenerationEnabled: z.boolean().optional(),
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
 * tool-call byte in the database, and each one duplicates what is
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
   * excluded from any baseline.
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

/**
 * One entry in a provider's model picker. Shared by every curated catalog —
 * `openai-models.ts` and `anthropic-models.ts` both build on it — so the
 * chat picker and Settings render any provider's list the same way.
 */
export const modelOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  group: z.enum(["recommended", "previous", "legacy"]).optional(),
  tier: z.enum(["strong", "standard", "cheap"]).optional(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

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
  "project.git_remote_set",
  "project.git_fetched",
  "project.git_pulled",
  "project.git_branch_switched",
  "project.pull_request_opened",
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
