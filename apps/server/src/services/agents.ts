import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AGENT_ACTION_PERMISSION,
  type Agent,
  type AgentActionType,
  type AgentCreate,
  type AgentCreated,
  type AgentMedia,
  type AgentPermission,
  type AgentPermissions,
  type AgentProposal,
  type AgentUpdate,
  APP_ACTIONS,
  agentCreateSchema,
  agentMediaSchema,
  agentUpdateSchema,
  newId,
  normaliseAgentPermissions,
  type Project,
  type User,
  type VideoGenerationInput,
  videoModelCapability,
  ZelyqError,
} from "@zelyq/core";
import type { AgentProposalRow, AgentRow, Store } from "@zelyq/db";
import type { AccessControl } from "./access.js";
import type { AgentReferenceStore } from "./agent-references.js";
import type { DeployService } from "./deploy.js";
import type { ImageGenerationService } from "./image-generation.js";
import type { PipelineService } from "./pipelines/service.js";
import type { PipelineTriggerService } from "./pipelines/triggers.js";
import type { ProjectService } from "./projects.js";
import type { VaultService } from "./vault.js";
import type { VideoGenerationService } from "./video-generation.js";

const KEY_PREFIX = "zlq_agent_";

/** Who is calling the gateway, once its key checked out. */
export interface AgentContext {
  agent: AgentRow;
  permissions: AgentPermissions;
  /** null: every app in the team. */
  projectIds: string[] | null;
  /** null: every pipeline in the team. */
  pipelineIds: string[] | null;
  /** null: every deploy environment in the team. */
  environmentIds: string[] | null;
  /** Which provider and Vault secret pay for its images and video. */
  media: AgentMedia;
  ip: string;
}

const list = (ids: string[] | null): string | null => (ids ? JSON.stringify(ids) : null);
const parseList = (json: string | null): string[] | null => (json ? JSON.parse(json) : null);

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function newKey(): { key: string; prefix: string; hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 6), hash: hashKey(key) };
}

/**
 * Outside agents — Claude Code, Codex, Cursor, any MCP client — and what they
 * ask a person to approve.
 *
 * Only a team's admins and owners manage its agents: an agent's key can change
 * every app it was given. The key is shown once and stored as a SHA-256 hash;
 * 256 random bits leave nothing to guess.
 *
 * An approved request is carried out **as the person who approved it**, with
 * that person's own permissions — the agent never acts with more than the
 * human who said yes.
 */
export class AgentService {
  constructor(
    private readonly store: Store,
    private readonly access: AccessControl,
    private readonly projects: ProjectService,
    private readonly vault: VaultService,
    private readonly pipelines: PipelineService,
    private readonly deploys: DeployService,
    private readonly triggers: PipelineTriggerService,
    private readonly videos: VideoGenerationService,
    private readonly images: ImageGenerationService,
    private readonly references: AgentReferenceStore,
  ) {}

  /** Media settings as given; each secret must be one the team's Vault has. */
  private async media(teamId: string, raw: unknown): Promise<AgentMedia> {
    const media = agentMediaSchema.parse(raw ?? {});
    const names = new Set((await this.store.vault.list(teamId)).map((entry) => entry.name));
    for (const choice of [media.image, media.video]) {
      if (choice && !names.has(choice.secret)) {
        throw ZelyqError.badRequest(`${choice.secret} is not in this team's Vault.`);
      }
    }
    return media;
  }

  /**
   * Whom the agent works for when Zelyq's own services need a person: the
   * admin who created it. Every check those services make still applies — an
   * agent never has more than its creator, and loses what its creator loses.
   */
  async actingUser(context: AgentContext): Promise<User> {
    const user = context.agent.createdBy
      ? await this.store.users.findById(context.agent.createdBy)
      : null;
    if (!user) {
      throw new ZelyqError(
        "forbidden",
        "The person who created this agent no longer has an account. Ask an admin to create it again.",
      );
    }
    return user;
  }

  /** Pipelines a person put triggers on run without approval, so only a person changes them. */
  async requireNoTriggers(context: AgentContext, pipelineId: string): Promise<void> {
    const user = await this.actingUser(context);
    const triggers = await this.triggers.list(user, context.agent.teamId, pipelineId);
    if (triggers.some((trigger) => trigger.enabled)) {
      throw new ZelyqError(
        "forbidden",
        "This pipeline has triggers switched on, so it can start runs without approval. Only a person may change it; ask them, or write a new pipeline.",
      );
    }
  }

  // ------------------------------------------------------------- management

  async list(user: User, teamId: string): Promise<Agent[]> {
    await this.access.requireTeamRole(user, teamId, "admin");
    return (await this.store.agents.listForTeam(teamId)).map(toAgent);
  }

  async create(user: User, teamId: string, raw: AgentCreate): Promise<AgentCreated> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const input = agentCreateSchema.parse(raw);
    const permissions = this.permissions(input.permissions);
    await this.requireTeamProjects(teamId, input.projectIds);
    await this.requireTeamPipelines(teamId, input.pipelineIds);
    await this.requireTeamEnvironments(teamId, input.environmentIds);
    const media = await this.media(teamId, input.media);
    const { key, prefix, hash } = newKey();
    const row = await this.store.agents.create({
      id: newId("agent"),
      teamId,
      name: input.name,
      job: input.job,
      projectIds: list(input.projectIds),
      pipelineIds: list(input.pipelineIds),
      media: JSON.stringify(media),
      environmentIds: list(input.environmentIds),
      permissions: JSON.stringify(permissions),
      keyPrefix: prefix,
      keyHash: hash,
      revokedAt: null,
      lastUsedAt: null,
      lastUsedIp: null,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    });
    await this.access.recordChange(user, {
      teamId,
      action: "agent.created",
      detail: { agent: row.name, agentId: row.id },
    });
    return { agent: toAgent(row), key };
  }

  async update(user: User, teamId: string, agentId: string, raw: AgentUpdate): Promise<Agent> {
    const row = await this.manage(user, teamId, agentId);
    const input = agentUpdateSchema.parse(raw);
    if (input.projectIds !== undefined) await this.requireTeamProjects(teamId, input.projectIds);
    if (input.pipelineIds !== undefined) await this.requireTeamPipelines(teamId, input.pipelineIds);
    if (input.environmentIds !== undefined) {
      await this.requireTeamEnvironments(teamId, input.environmentIds);
    }
    const updated = await this.store.agents.update(row.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.job !== undefined ? { job: input.job } : {}),
      ...(input.projectIds !== undefined ? { projectIds: list(input.projectIds) } : {}),
      ...(input.pipelineIds !== undefined ? { pipelineIds: list(input.pipelineIds) } : {}),
      ...(input.media !== undefined
        ? { media: JSON.stringify(await this.media(teamId, input.media)) }
        : {}),
      ...(input.environmentIds !== undefined ? { environmentIds: list(input.environmentIds) } : {}),
      ...(input.permissions !== undefined
        ? { permissions: JSON.stringify(this.permissions(input.permissions)) }
        : {}),
    });
    await this.access.recordChange(user, {
      teamId,
      action: "agent.updated",
      detail: { agent: row.name, agentId: row.id, fields: Object.keys(input) },
    });
    return toAgent(updated as AgentRow);
  }

  /** A new key; the old one stops working at once. */
  async rotate(user: User, teamId: string, agentId: string): Promise<AgentCreated> {
    const row = await this.manage(user, teamId, agentId);
    if (row.revokedAt) throw ZelyqError.badRequest("This agent has been revoked.");
    const { key, prefix, hash } = newKey();
    const updated = await this.store.agents.update(row.id, { keyPrefix: prefix, keyHash: hash });
    await this.access.recordChange(user, {
      teamId,
      action: "agent.key_rotated",
      detail: { agent: row.name, agentId: row.id },
    });
    return { agent: toAgent(updated as AgentRow), key };
  }

  async revoke(user: User, teamId: string, agentId: string): Promise<Agent> {
    const row = await this.manage(user, teamId, agentId);
    const updated = await this.store.agents.revoke(row.id, new Date().toISOString());
    await this.access.recordChange(user, {
      teamId,
      action: "agent.revoked",
      detail: { agent: row.name, agentId: row.id },
    });
    return toAgent(updated as AgentRow);
  }

  async remove(user: User, teamId: string, agentId: string): Promise<void> {
    const row = await this.manage(user, teamId, agentId);
    // Its imported images' files go with it; the rows cascade.
    for (const given of await this.store.agents.references.list(row.id)) {
      await this.references.remove(given.id, given.mimeType);
    }
    await this.store.agents.remove(row.id);
    await this.access.recordChange(user, {
      teamId,
      action: "agent.deleted",
      detail: { agent: row.name, agentId: row.id },
    });
  }

  // --------------------------------------------------------- the gateway side

  /**
   * The key on a gateway request. Every failure says the same kind of thing
   * an outside client can act on, and nothing about which agents exist.
   */
  async authenticate(header: string | undefined, ip: string): Promise<AgentContext> {
    const token = header?.replace(/^Bearer\s+/i, "").trim();
    if (!token?.startsWith(KEY_PREFIX)) {
      throw new ZelyqError(
        "unauthorized",
        "Send this agent's key as 'Authorization: Bearer zlq_agent_…'.",
      );
    }
    const row = await this.store.agents.findByHash(hashKey(token));
    if (!row) throw new ZelyqError("unauthorized", "That agent key is not valid.");
    if (row.revokedAt) throw new ZelyqError("unauthorized", "This agent has been revoked.");
    await this.store.agents.touch(row.id, new Date().toISOString(), ip);
    return {
      agent: row,
      permissions: this.permissions(JSON.parse(row.permissions)),
      projectIds: parseList(row.projectIds),
      pipelineIds: parseList(row.pipelineIds),
      environmentIds: parseList(row.environmentIds),
      media: parseMedia(row.media),
      ip,
    };
  }

  /** The apps this agent may work on, as they are now. */
  async allowedProjects(context: AgentContext): Promise<Project[]> {
    const all = await this.store.projects.listForTeams([context.agent.teamId]);
    return context.projectIds ? all.filter((p) => context.projectIds?.includes(p.id)) : all;
  }

  /** The app, if this agent may touch it; the same refusal otherwise. */
  async requireProject(context: AgentContext, projectId: string): Promise<Project> {
    const project = await this.store.projects.findById(projectId);
    if (
      !project ||
      project.teamId !== context.agent.teamId ||
      (context.projectIds && !context.projectIds.includes(project.id))
    ) {
      throw new ZelyqError(
        "not_found",
        `No app ${projectId} that this agent may work on. Call list_apps.`,
      );
    }
    return project;
  }

  /** The pipeline, if this agent may see it; the same refusal otherwise. */
  async requirePipeline(context: AgentContext, pipelineId: string): Promise<void> {
    const pipeline = await this.store.pipelines.pipelines.findById(pipelineId);
    if (
      !pipeline ||
      pipeline.teamId !== context.agent.teamId ||
      (context.pipelineIds && !context.pipelineIds.includes(pipeline.id))
    ) {
      throw new ZelyqError(
        "not_found",
        `No pipeline ${pipelineId} that this agent may use. Call list_pipelines.`,
      );
    }
  }

  /** The run's pipeline must be one this agent may see. */
  async requireRun(context: AgentContext, runId: string): Promise<void> {
    const run = await this.store.pipelines.runs.findById(runId);
    if (!run || run.teamId !== context.agent.teamId) {
      throw new ZelyqError("not_found", `No run ${runId} that this agent may see.`);
    }
    await this.requirePipeline(context, run.pipelineId);
  }

  /** The environment, if this agent may see and act on it. */
  async requireEnvironment(context: AgentContext, environmentId: string): Promise<void> {
    const environment = await this.store.deploy.environments.findById(environmentId);
    if (
      !environment ||
      environment.teamId !== context.agent.teamId ||
      (context.environmentIds && !context.environmentIds.includes(environment.id))
    ) {
      throw new ZelyqError(
        "not_found",
        `No environment ${environmentId} that this agent may use. Call list_environments.`,
      );
    }
  }

  /** The deployment's environment must be one this agent may use. */
  async requireDeployment(context: AgentContext, deploymentId: string): Promise<void> {
    const deployment = await this.store.deploy.deployments.findById(deploymentId);
    if (!deployment || deployment.teamId !== context.agent.teamId) {
      throw new ZelyqError("not_found", `No deployment ${deploymentId} that this agent may see.`);
    }
    await this.requireEnvironment(context, deployment.environmentId);
  }

  allowsPipeline(context: AgentContext, pipelineId: string): boolean {
    return !context.pipelineIds || context.pipelineIds.includes(pipelineId);
  }

  allowsEnvironment(context: AgentContext, environmentId: string): boolean {
    return !context.environmentIds || context.environmentIds.includes(environmentId);
  }

  /**
   * What a pipeline file reaches must be within this agent's reach: its
   * source app one of its apps, and every environment it deploys to one of
   * its environments. Checked on the file as it will run, templates included.
   */
  async requirePipelineTargets(context: AgentContext, source: string): Promise<void> {
    const user = await this.actingUser(context);
    const targets = await this.pipelines.targets(user, context.agent.teamId, source);
    if (!targets) return; // Not valid yet: saving refuses it with the real reason.
    if (targets.app && context.projectIds) {
      const apps = await this.allowedProjects(context);
      if (!apps.some((app) => app.name === targets.app)) {
        throw new ZelyqError(
          "forbidden",
          `This agent may not build "${targets.app}": its source must be one of its apps (list_apps).`,
        );
      }
    }
    if (context.environmentIds) {
      for (const name of targets.environments) {
        const environment = await this.store.deploy.environments.findByName(
          context.agent.teamId,
          name,
        );
        if (!environment || !context.environmentIds.includes(environment.id)) {
          throw new ZelyqError(
            "forbidden",
            `This agent may not deploy to "${name}". Its environments: call list_environments.`,
          );
        }
      }
    }
  }

  /**
   * A pipeline the agent just created joins its own list, so an agent kept to
   * some pipelines can still see and use the ones it writes.
   */
  async adoptPipeline(context: AgentContext, pipelineId: string): Promise<void> {
    if (!context.pipelineIds) return;
    context.pipelineIds = [...context.pipelineIds, pipelineId];
    await this.store.agents.update(context.agent.id, { pipelineIds: list(context.pipelineIds) });
  }

  requirePermission(context: AgentContext, permission: AgentPermission): void {
    if (context.permissions[permission] === "off") {
      throw new ZelyqError("forbidden", `This agent may not use '${permission}'.`);
    }
  }

  /** What the agent did, in the team's audit log, under the agent's name. */
  async record(
    context: AgentContext,
    entry: {
      projectId?: string;
      action:
        | "agent.files_changed"
        | "agent.command_run"
        | "agent.committed"
        | "agent.pipeline_changed"
        | "agent.proposed";
      detail: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.store.auditLog.record({
      id: newId("audit"),
      teamId: context.agent.teamId,
      projectId: entry.projectId ?? null,
      userId: null,
      actorName: `${context.agent.name} (agent)`,
      actorEmail: `agent:${context.agent.id}`,
      action: entry.action,
      detail: { ...entry.detail, agentId: context.agent.id },
      createdAt: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------- proposals

  async propose(
    context: AgentContext,
    input: {
      actionType: AgentActionType;
      projectId: string | null;
      title: string;
      reason: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<AgentProposal> {
    this.requirePermission(context, AGENT_ACTION_PERMISSION[input.actionType]);
    const row = await this.store.agents.proposals.create({
      id: newId("agentProposal"),
      teamId: context.agent.teamId,
      agentId: context.agent.id,
      projectId: input.projectId,
      actionType: input.actionType,
      title: input.title.slice(0, 200),
      reason: input.reason?.slice(0, 2000) ?? null,
      payload: JSON.stringify(input.payload),
      status: "pending",
      result: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: new Date().toISOString(),
    });
    await this.record(context, {
      ...(input.projectId ? { projectId: input.projectId } : {}),
      action: "agent.proposed",
      detail: { proposalId: row.id, actionType: row.actionType, title: row.title },
    });
    return toProposal(row, context.agent.name);
  }

  async agentProposals(context: AgentContext): Promise<AgentProposal[]> {
    const rows = await this.store.agents.proposals.listForTeam(context.agent.teamId, {
      agentId: context.agent.id,
      limit: 50,
    });
    return rows.map((row) => toProposal(row, context.agent.name));
  }

  /** For the team's inbox. Members can see what is waiting; admins decide. */
  async listProposals(user: User, teamId: string, status?: string): Promise<AgentProposal[]> {
    await this.access.requireTeamRole(user, teamId, "viewer");
    const names = new Map(
      (await this.store.agents.listForTeam(teamId)).map((row) => [row.id, row.name]),
    );
    const rows = await this.store.agents.proposals.listForTeam(teamId, {
      ...(status ? { status } : {}),
    });
    return rows.map((row) => toProposal(row, names.get(row.agentId) ?? "Deleted agent"));
  }

  async decide(
    user: User,
    teamId: string,
    proposalId: string,
    decision: "approve" | "decline",
  ): Promise<AgentProposal> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const existing = await this.store.agents.proposals.findById(proposalId);
    if (!existing || existing.teamId !== teamId) {
      throw ZelyqError.notFound("Request", proposalId);
    }
    const agentName = (await this.store.agents.findById(existing.agentId))?.name ?? "Deleted agent";
    // Studio makes one video at a time per person. Approving another while one
    // is generating would only fail it; leave it waiting instead.
    if (decision === "approve" && existing.actionType === "media.video") {
      const creator = (await this.store.agents.findById(existing.agentId))?.createdBy;
      if (creator && (await this.store.videos.hasActive(creator))) {
        throw ZelyqError.badRequest(
          "Another video is still being generated in Studio. Approve this one when it has finished.",
        );
      }
    }
    const claimed = await this.store.agents.proposals.decide(proposalId, {
      status: decision === "approve" ? "approved" : "declined",
      decidedBy: user.id,
      decidedAt: new Date().toISOString(),
    });
    if (!claimed) {
      throw ZelyqError.badRequest(`This request was already ${existing.status}.`);
    }
    await this.access.recordChange(user, {
      teamId,
      ...(claimed.projectId ? { projectId: claimed.projectId } : {}),
      action: decision === "approve" ? "agent.proposal_approved" : "agent.proposal_declined",
      detail: { proposalId, actionType: claimed.actionType, agent: agentName },
    });
    if (decision === "decline") return toProposal(claimed, agentName);

    try {
      const result = await this.carryOut(user, claimed, agentName);
      await this.store.agents.proposals.setOutcome(proposalId, "approved", result);
    } catch (error) {
      await this.store.agents.proposals.setOutcome(
        proposalId,
        "failed",
        (error as Error).message.slice(0, 2000),
      );
    }
    return toProposal(
      (await this.store.agents.proposals.findById(proposalId)) as AgentProposalRow,
      agentName,
    );
  }

  /** The approved action, done as the approver, through the same paths a person uses. */
  private async carryOut(
    user: User,
    proposal: AgentProposalRow,
    agentName: string,
  ): Promise<string> {
    const payload = JSON.parse(proposal.payload) as Record<string, unknown>;
    const note = `By ${agentName} (agent), approved by ${user.name}`;
    const pipelineId = String(payload.pipelineId ?? "");
    if (proposal.actionType === "pipeline.create") {
      const pipeline = await this.pipelines.create(user, proposal.teamId, String(payload.source), {
        note,
      });
      // Kept to some pipelines: the one it wrote is now one of them.
      const agent = await this.store.agents.findById(proposal.agentId);
      if (agent?.pipelineIds) {
        const ids = [...JSON.parse(agent.pipelineIds), pipeline.id];
        await this.store.agents.update(agent.id, { pipelineIds: JSON.stringify(ids) });
      }
      return `Pipeline ${pipeline.name} created.`;
    }
    if (proposal.actionType === "pipeline.update" || proposal.actionType === "pipeline.restore") {
      // The diff that was approved must still be the change: refuse if the
      // pipeline moved on since the agent asked.
      const current = await this.store.pipelines.pipelines.findById(pipelineId);
      if (!current || current.teamId !== proposal.teamId) {
        throw ZelyqError.notFound("Pipeline", pipelineId);
      }
      if (typeof payload.baseSource === "string" && current.source !== payload.baseSource) {
        throw ZelyqError.badRequest(
          "The pipeline changed after the agent asked, so this is no longer the change you saw. Ask the agent to look again.",
        );
      }
      const pipeline =
        proposal.actionType === "pipeline.restore"
          ? await this.pipelines.restore(
              user,
              proposal.teamId,
              pipelineId,
              Number(payload.version),
              {
                note: `Restored version ${payload.version}. ${note}`,
              },
            )
          : await this.pipelines.update(user, proposal.teamId, pipelineId, String(payload.source), {
              note,
            });
      return `Pipeline ${pipeline.name} saved.`;
    }
    if (proposal.actionType === "media.video") {
      // Paid by the agent's own key, kept in its creator's Studio library.
      const agent = await this.store.agents.findById(proposal.agentId);
      const media = parseMedia(agent?.media ?? null);
      if (!agent || !media.video)
        throw ZelyqError.badRequest("This agent has no video key any more.");
      const owner = agent.createdBy ? await this.store.users.findById(agent.createdBy) : null;
      if (!owner)
        throw ZelyqError.badRequest("The person who created this agent no longer exists.");
      // Animating one of its Studio images: that image becomes the starting frame.
      let referenceId: string | undefined;
      if (typeof payload.startImageId === "string") {
        let bytes: Buffer;
        if (payload.startImageId.startsWith("arf_")) {
          // An image it was given: a portrait, a logo.
          const given = await this.store.agents.references.find(payload.startImageId);
          if (!given || given.agentId !== agent.id) {
            throw ZelyqError.badRequest("The image to animate is no longer in Studio.");
          }
          bytes = await this.references.read(given.id, given.mimeType);
        } else {
          const image = await this.store.images.find(payload.startImageId);
          if (!image || image.sessionId !== `agent:${agent.id}` || image.status !== "succeeded") {
            throw ZelyqError.badRequest("The image to animate is no longer in Studio.");
          }
          bytes = await this.images.read(image.ownerId, image.id);
        }
        referenceId = (await this.videos.addReference(owner.id, bytes)).id;
      }
      const video = await this.videos.submit(
        owner.id,
        {
          ...(payload.input as Record<string, unknown>),
          provider: media.video.provider,
          model: videoModelCapability(media.video.provider).model,
          mode: referenceId ? "image-to-video" : "text-to-video",
          ...(referenceId ? { referenceId } : {}),
          idempotencyKey: randomUUID(),
        } as VideoGenerationInput,
        {
          source: "agent",
          projectId: proposal.projectId ?? "",
          projectName: String(payload.appName ?? ""),
          sessionId: `agent:${agent.id}`,
          keyRef: { teamId: agent.teamId, name: media.video.secret },
        },
      );
      return `Video ${video.id} is being generated. When it is ready the agent can place it with place_media, or see it with studio_view.`;
    }
    if (proposal.actionType === "pipeline.delete") {
      await this.pipelines.remove(user, proposal.teamId, pipelineId);
      return "Pipeline deleted.";
    }
    if (proposal.actionType === "git.push") {
      if (!proposal.projectId) throw ZelyqError.badRequest("No app to push.");
      const { project } = await this.access.requireProject(user, proposal.projectId, "editor");
      let token: string | undefined;
      const vaultName = typeof payload.gitTokenVault === "string" ? payload.gitTokenVault : null;
      if (vaultName) {
        await this.vault.requireUse(user, { kind: "team", teamId: project.teamId }, vaultName);
        token = (await this.vault.resolve(project.teamId, [vaultName])).get(vaultName);
        if (!token) throw ZelyqError.badRequest(`${vaultName} could not be read from Vault.`);
      }
      const result = await this.projects.pushToRemote(project.id, undefined, token);
      await this.access.recordChange(user, {
        teamId: project.teamId,
        projectId: project.id,
        action: "project.pushed",
        detail: { branch: result.branch, commits: result.commits, viaAgent: proposal.agentId },
      });
      return `Pushed ${result.commits} commit(s) to ${result.branch ?? "the remote"}.`;
    }
    if (proposal.actionType === "pipeline.run") {
      const pipelineId = String(payload.pipelineId ?? "");
      const run = await this.pipelines.startRun(user, proposal.teamId, pipelineId, {
        ref: typeof payload.ref === "string" ? payload.ref : null,
        inputs: (payload.inputs as Record<string, string> | undefined) ?? {},
      });
      return `Pipeline run ${run.id} started.`;
    }
    if (proposal.actionType === "pipeline.rerun") {
      const run = await this.pipelines.rerun(
        user,
        proposal.teamId,
        String(payload.runId ?? ""),
        typeof payload.fromStage === "number" ? payload.fromStage : null,
      );
      return `Pipeline run ${run.id} started.`;
    }
    if (proposal.actionType === "app.action") {
      const action = String(payload.action) as (typeof APP_ACTIONS)[number];
      if (!APP_ACTIONS.includes(action)) throw ZelyqError.badRequest(`Unknown action ${action}.`);
      const status = await this.deploys.appAction(
        user,
        proposal.teamId,
        String(payload.environmentId ?? ""),
        String(payload.app ?? ""),
        action,
      );
      return `${action} done; the app is ${status.state}.`;
    }
    if (proposal.actionType === "deploy.rollback") {
      const deployment = await this.deploys.rollBack(
        user,
        proposal.teamId,
        String(payload.deploymentId ?? ""),
      );
      return `Rolled back: deployment ${deployment.id} is ${deployment.status}.`;
    }
    if (proposal.actionType === "deploy.promote") {
      const deployment = await this.deploys.promote(
        user,
        proposal.teamId,
        String(payload.deploymentId ?? ""),
        String(payload.environmentId ?? ""),
      );
      return `Promoted: deployment ${deployment.id} is ${deployment.status}.`;
    }
    throw ZelyqError.badRequest(`Unknown action ${proposal.actionType}.`);
  }

  // ------------------------------------------------------------------ helpers

  private permissions(input: Record<string, unknown> | undefined): AgentPermissions {
    try {
      return normaliseAgentPermissions(input as never);
    } catch (error) {
      throw ZelyqError.badRequest((error as Error).message);
    }
  }

  private async manage(user: User, teamId: string, agentId: string): Promise<AgentRow> {
    await this.access.requireTeamRole(user, teamId, "admin");
    const row = await this.store.agents.findById(agentId);
    if (!row || row.teamId !== teamId) throw ZelyqError.notFound("Agent", agentId);
    return row;
  }

  private async requireTeamPipelines(teamId: string, ids: string[] | null): Promise<void> {
    for (const id of ids ?? []) {
      const pipeline = await this.store.pipelines.pipelines.findById(id);
      if (!pipeline || pipeline.teamId !== teamId) {
        throw ZelyqError.badRequest(`${id} is not a pipeline in this team.`);
      }
    }
  }

  private async requireTeamEnvironments(teamId: string, ids: string[] | null): Promise<void> {
    for (const id of ids ?? []) {
      const environment = await this.store.deploy.environments.findById(id);
      if (!environment || environment.teamId !== teamId) {
        throw ZelyqError.badRequest(`${id} is not an environment in this team.`);
      }
    }
  }

  private async requireTeamProjects(teamId: string, projectIds: string[] | null): Promise<void> {
    if (!projectIds) return;
    for (const id of projectIds) {
      const project = await this.store.projects.findById(id);
      if (!project || project.teamId !== teamId) {
        throw ZelyqError.badRequest(`${id} is not an app in this team.`);
      }
    }
  }
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    job: row.job,
    projectIds: parseList(row.projectIds),
    pipelineIds: parseList(row.pipelineIds),
    environmentIds: parseList(row.environmentIds),
    media: parseMedia(row.media),
    permissions: normaliseAgentPermissions(JSON.parse(row.permissions)),
    keyPrefix: row.keyPrefix,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    createdAt: row.createdAt,
  };
}

function toProposal(row: AgentProposalRow, agentName: string): AgentProposal {
  return {
    id: row.id,
    teamId: row.teamId,
    agentId: row.agentId,
    agentName,
    projectId: row.projectId,
    actionType: row.actionType as AgentActionType,
    title: row.title,
    reason: row.reason,
    payload: JSON.parse(row.payload),
    status: row.status as AgentProposal["status"],
    result: row.result,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}

function parseMedia(json: string | null): AgentMedia {
  try {
    return agentMediaSchema.parse(json ? JSON.parse(json) : {});
  } catch {
    return { image: null, video: null };
  }
}
