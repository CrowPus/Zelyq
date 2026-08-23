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
      if (input.gitUrl) {
        await this.cloneInto(id, input.gitUrl);
      } else {
        const files = await loadTemplate(this.config.templatesDir, input.template, {
          projectName: project.name,
          projectSlug: project.slug,
          projectId: project.id,
        });
        await this.runtime.scaffold(id, files);
      }
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
   * Clones a repository into a project, through the runtime rather than around
   * it — so this works identically whether execution is local or on a remote
   * host, and the clone lands wherever that runtime keeps projects.
   *
   * Shallow on purpose: the agent needs the code, not the history, and a deep
   * clone of a long-lived repository is minutes of waiting before anything can
   * happen.
   *
   * A token, when configured, is passed through the environment and read by a
   * credential helper. It never appears in the command line, because the command
   * is logged and its output is returned to callers.
   */
  private async cloneInto(id: string, gitUrl: string, token?: string): Promise<void> {
    const helper = token
      ? `-c credential.helper='!f() { echo username=x-access-token; echo "password=$ZELYQ_GIT_TOKEN"; }; f' `
      : "";

    const safeUrl = `'${gitUrl.replaceAll("'", "'\\''")}'`;
    const env = {
      GIT_TERMINAL_PROMPT: "0",
      ...(token ? { ZELYQ_GIT_TOKEN: token } : {}),
    };

    const clone = (depth: boolean) =>
      this.runtime.exec(id, {
        command: `git ${helper}clone ${depth ? "--depth 1 --single-branch " : ""}-- ${safeUrl} .`,
        timeoutMs: 10 * 60_000,
        env,
      });

    let result = await clone(true);

    // Older servers, and anything serving a repository as plain files, cannot
    // do a shallow clone. Falling back costs a slower first clone and is far
    // better than refusing a repository somebody can plainly reach.
    if (result.exitCode !== 0 && /shallow|dumb http/i.test(result.stderr + result.stdout)) {
      await this.runtime.exec(id, { command: "rm -rf ./* ./.[!.]* 2>/dev/null || true" });
      result = await clone(false);
    }

    if (result.exitCode !== 0) {
      // git puts the useful part on stderr, and the useful part is usually
      // "repository not found" or "authentication failed" — both of which the
      // person creating the project can act on.
      const detail = (result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ");
      throw ZelyqError.badRequest(
        `Could not clone that repository. ${detail || `git exited with code ${result.exitCode}`}`,
      );
    }
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
