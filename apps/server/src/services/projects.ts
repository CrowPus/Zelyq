import {
  type CreateProjectInput,
  newId,
  type Project,
  type Session,
  type Snapshot,
  slugify,
  type User,
  ZelyqError,
} from "@zelyq/core";
import type { Store } from "@zelyq/db";
import type { RuntimeDriver } from "@zelyq/runtime";
import type { ServerConfig } from "../config.js";
import { loadTemplate } from "./templates.js";

/**
 * Project lifecycle. Creation is the one flow that has to keep two systems in
 * step — a database row and a directory of files — so it owns the failure
 * handling: if scaffolding fails, the project is marked `error` with the reason
 * rather than being left silently empty.
 */
export class ProjectService {
  constructor(
    private readonly store: Store,
    private readonly runtime: RuntimeDriver,
    private readonly config: ServerConfig,
  ) {}

  async create(input: CreateProjectInput & { teamId: string }): Promise<Project> {
    const id = newId("project");
    const project = await this.store.projects.create({
      id,
      teamId: input.teamId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? null,
      template: input.template,
      status: "creating",
      statusMessage: null,
    });

    try {
      await this.runtime.ensureProject(id);
      const files = await loadTemplate(this.config.templatesDir, input.template, {
        projectName: project.name,
        projectSlug: project.slug,
        projectId: project.id,
      });
      await this.runtime.scaffold(id, files);
      await this.store.projects.setStatus(id, "ready");
    } catch (error) {
      await this.store.projects.setStatus(id, "error", (error as Error).message);
      throw error;
    }

    return (await this.store.projects.findById(id)) ?? project;
  }

  /** Only projects in teams the user belongs to. */
  async listForUser(user: User): Promise<Project[]> {
    const teams = await this.store.teams.listForUser(user.id);
    return await this.store.projects.listForTeams(teams.map((team) => team.id));
  }

  async get(id: string): Promise<Project> {
    const project = await this.store.projects.findById(id);
    if (!project) throw ZelyqError.notFound("Project", id);
    return project;
  }

  async update(
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<Project> {
    await this.get(id);
    const updated = await this.store.projects.update(id, patch);
    if (!updated) throw ZelyqError.notFound("Project", id);
    return updated;
  }

  /**
   * Copies the project's files and records it. Used before every agent turn so
   * the turn can be undone, and by the manual snapshot button.
   */
  async snapshot(id: string, label: string): Promise<Snapshot> {
    const snapshot = await this.runtime.createSnapshot(id, label);
    await this.store.snapshots.create(snapshot);
    return snapshot;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.runtime.removeProject(id);
    await this.store.projects.remove(id);
  }

  /**
   * Returns the project's live session, creating one if this is the first
   * connection. Sessions are per project, not per browser tab, so two tabs
   * watch the same conversation.
   */
  async ensureSession(projectId: string): Promise<Session> {
    const existing = await this.store.sessions.findLatestForProject(projectId);
    if (existing && existing.status !== "closed") return existing;

    return await this.store.sessions.create({
      id: newId("session"),
      projectId,
      status: "idle",
      provider: this.config.provider,
      model: this.config.model,
      effort: this.config.effort,
      tokensIn: 0,
      tokensOut: 0,
    });
  }
}
