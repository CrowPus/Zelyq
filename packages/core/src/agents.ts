import { z } from "zod";
import { imageProviderIds } from "./images.js";
import { videoProviderIds } from "./videos.js";

// ---------------------------------------------------------------------------
// Agents: outside AI agents working inside Zelyq
//
// Claude Code, Codex, Cursor, Gemini CLI — any MCP client — connects to
// `/agent-gateway/mcp` with a key a team admin issued. The agent thinks on its
// own subscription; Zelyq lends it hands on the team's apps, only the ones it
// was given, and only what each permission allows.
// ---------------------------------------------------------------------------

/**
 * What an agent may do, as groups a person can reason about. A group is
 * switched on as a whole: "write code" means every file-changing tool.
 *
 * `levels` is what the group may be set to. Pushing and running pipelines
 * reach outside the app — a remote, a server — so they are never "allow":
 * at most the agent asks, and a person approves.
 */
export const AGENT_PERMISSIONS = {
  "code.read": {
    label: "Read code",
    description: "List, read and search the app's files.",
    levels: ["off", "allow"],
    default: "allow",
  },
  "code.write": {
    label: "Write code",
    description: "Create, edit and delete files. An undo point is taken first.",
    levels: ["off", "allow"],
    default: "allow",
  },
  commands: {
    label: "Run commands",
    description: "Run shell commands in the app's workspace: install, test, build.",
    levels: ["off", "allow"],
    default: "allow",
  },
  preview: {
    label: "Preview",
    description: "Start the app's preview, read its logs and take a screenshot.",
    levels: ["off", "allow"],
    default: "allow",
  },
  "git.commit": {
    label: "Commit",
    description: "Commit its changes to the app's own git history.",
    levels: ["off", "allow"],
    default: "allow",
  },
  "git.push": {
    label: "Push",
    description: "Push the app to its remote repository. A person approves each push.",
    levels: ["off", "approve"],
    default: "approve",
  },
  "pipelines.write": {
    label: "Write pipelines",
    description:
      "Create, edit, delete and restore the team's pipelines. With approval, you see the change as a diff first.",
    levels: ["off", "approve", "allow"],
    default: "allow",
  },
  "pipelines.run": {
    label: "Run pipelines",
    description:
      "Run, re-run and stop pipelines, deploys included, and read their logs. A person approves each run.",
    levels: ["off", "approve"],
    default: "approve",
  },
  "deploy.manage": {
    label: "Deployments",
    description:
      "See environments, deployed apps and their logs. Restart, stop, start, roll back and promote wait for a person.",
    levels: ["off", "approve"],
    default: "approve",
  },
  "media.image": {
    label: "Generate images",
    description:
      "Generate images in Studio on this agent's own provider key (set below), and put them in its apps.",
    levels: ["off", "allow"],
    default: "allow",
  },
  "media.video": {
    label: "Generate video",
    description:
      "Generate video in Studio on this agent's own key — from text or by animating its images — and split it into frames. A person approves each video; it costs far more.",
    levels: ["off", "approve"],
    default: "approve",
  },
  "media.files": {
    label: "Bring its own media",
    description: "Put an image or video it made itself into an app, from a link or the file.",
    levels: ["off", "allow"],
    default: "allow",
  },
  "vault.names": {
    label: "Vault names",
    description: "See which secrets the app can use, by name. Never their values.",
    levels: ["off", "allow"],
    default: "allow",
  },
} as const;

export type AgentPermission = keyof typeof AGENT_PERMISSIONS;
export const agentPermissionNames = Object.keys(AGENT_PERMISSIONS) as AgentPermission[];

export const agentPermissionLevelSchema = z.enum(["off", "allow", "approve"]);
export type AgentPermissionLevel = z.infer<typeof agentPermissionLevelSchema>;

export type AgentPermissions = Record<AgentPermission, AgentPermissionLevel>;

export function defaultAgentPermissions(): AgentPermissions {
  return Object.fromEntries(
    agentPermissionNames.map((name) => [name, AGENT_PERMISSIONS[name].default]),
  ) as AgentPermissions;
}

/**
 * Fills in anything missing with its default and refuses a level a group does
 * not have — "allow" on push is not a choice, whatever the request says.
 */
export function normaliseAgentPermissions(
  input: Partial<Record<string, AgentPermissionLevel>> | undefined,
): AgentPermissions {
  const permissions = defaultAgentPermissions();
  for (const [name, level] of Object.entries(input ?? {})) {
    if (!(name in AGENT_PERMISSIONS)) {
      throw new Error(`Unknown permission: ${name}`);
    }
    const group = AGENT_PERMISSIONS[name as AgentPermission];
    if (!level || !(group.levels as readonly string[]).includes(level)) {
      throw new Error(`${group.label} cannot be set to "${level}".`);
    }
    permissions[name as AgentPermission] = level;
  }
  return permissions;
}

/** The actions an agent asks a person to approve. */
export const agentActionTypeSchema = z.enum([
  "git.push",
  "pipeline.create",
  "pipeline.update",
  "pipeline.delete",
  "pipeline.restore",
  "pipeline.run",
  "pipeline.rerun",
  "app.action",
  "deploy.rollback",
  "deploy.promote",
  "media.video",
]);
export type AgentActionType = z.infer<typeof agentActionTypeSchema>;

/** The permission each action belongs to. */
export const AGENT_ACTION_PERMISSION: Record<AgentActionType, AgentPermission> = {
  "git.push": "git.push",
  "pipeline.create": "pipelines.write",
  "pipeline.update": "pipelines.write",
  "pipeline.delete": "pipelines.write",
  "pipeline.restore": "pipelines.write",
  "pipeline.run": "pipelines.run",
  "pipeline.rerun": "pipelines.run",
  "app.action": "deploy.manage",
  "deploy.rollback": "deploy.manage",
  "deploy.promote": "deploy.manage",
  "media.video": "media.video",
};

/**
 * Which provider, and which of the team's Vault secrets, pay for an agent's
 * images and video. Never the instance's own keys: with nothing set, the
 * agent has no generation tools at all.
 */
export const agentMediaSchema = z.object({
  image: z
    .object({ provider: z.enum(imageProviderIds), secret: z.string().trim().min(1).max(200) })
    .nullable()
    .default(null),
  video: z
    .object({ provider: z.enum(videoProviderIds), secret: z.string().trim().min(1).max(200) })
    .nullable()
    .default(null),
});
export type AgentMedia = z.infer<typeof agentMediaSchema>;

export const agentSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  /** What the agent is for, in the team's words. The agent reads it first. */
  job: z.string(),
  /** The apps it may work on; null means every app in the team. */
  projectIds: z.array(z.string()).nullable(),
  /** The pipelines it may see, write and ask to run; null means every one. */
  pipelineIds: z.array(z.string()).nullable(),
  /** The deploy environments it may see and act on; null means every one. */
  environmentIds: z.array(z.string()).nullable(),
  media: agentMediaSchema,
  permissions: z.record(z.string(), agentPermissionLevelSchema),
  /** The first characters of its key, to tell keys apart. Never the key. */
  keyPrefix: z.string(),
  revokedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  createdAt: z.string(),
});
export type Agent = z.infer<typeof agentSchema>;

/** Returned once, when an agent is created or its key replaced. */
export type AgentCreated = { agent: Agent; key: string };

const permissionsInput = z.record(z.string(), agentPermissionLevelSchema).optional();

export const agentCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  job: z.string().trim().max(4000).default(""),
  projectIds: z.array(z.string()).max(200).nullable().default(null),
  pipelineIds: z.array(z.string()).max(200).nullable().default(null),
  environmentIds: z.array(z.string()).max(50).nullable().default(null),
  media: agentMediaSchema.optional(),
  permissions: permissionsInput,
});
export type AgentCreate = z.input<typeof agentCreateSchema>;

export const agentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  job: z.string().trim().max(4000).optional(),
  projectIds: z.array(z.string()).max(200).nullable().optional(),
  pipelineIds: z.array(z.string()).max(200).nullable().optional(),
  environmentIds: z.array(z.string()).max(50).nullable().optional(),
  media: agentMediaSchema.optional(),
  permissions: permissionsInput,
});
export type AgentUpdate = z.input<typeof agentUpdateSchema>;

export const agentProposalStatusSchema = z.enum(["pending", "approved", "declined", "failed"]);
export type AgentProposalStatus = z.infer<typeof agentProposalStatusSchema>;

export const agentProposalSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  projectId: z.string().nullable(),
  actionType: agentActionTypeSchema,
  title: z.string(),
  reason: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: agentProposalStatusSchema,
  /** What happened when it was carried out, or why it failed. */
  result: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentProposal = z.infer<typeof agentProposalSchema>;

export const agentDecisionSchema = z.object({ decision: z.enum(["approve", "decline"]) });
