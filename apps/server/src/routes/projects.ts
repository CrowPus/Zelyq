import {
  createProjectSchema,
  createPullRequestSchema,
  gitBranchSchema,
  gitFetchSchema,
  gitPullSchema,
  pushToRemoteSchema,
  setGitRemoteSchema,
  updateProjectSchema,
} from "@zelyq/core";
import type { FastifyInstance } from "fastify";
import type { AccessControl } from "../services/access.js";
import type { ProjectService } from "../services/projects.js";
import { listTemplates } from "../services/templates.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  deps: { projects: ProjectService; access: AccessControl; templatesDir: string },
): void {
  const { access } = deps;

  app.get("/api/templates", async (request) => {
    access.requireUser(request);
    return { templates: await listTemplates(deps.templatesDir) };
  });

  app.get("/api/projects", async (request) => {
    const user = access.requireUser(request);
    // Only projects in teams the caller belongs to. Nothing else is listable.
    return { projects: await deps.projects.listForUser(user) };
  });

  app.post("/api/projects", async (request, reply) => {
    const user = access.requireUser(request);
    const input = createProjectSchema.parse(request.body);

    const teamId = input.teamId ?? (await access.defaultTeamFor(user));
    await access.requireTeamRole(user, teamId, "editor");

    const project = await deps.projects.create({ ...input, teamId });
    await access.recordChange(user, {
      teamId,
      projectId: project.id,
      action: "project.created",
      detail: { name: project.name },
    });
    reply.status(201);
    return { project };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "viewer");
    return { project };
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const user = access.requireUser(request);
    const { project: before } = await access.requireProject(user, request.params.id, "editor");
    const changes = updateProjectSchema.parse(request.body);
    const project = await deps.projects.update(request.params.id, changes);
    await access.recordChange(user, {
      teamId: before.teamId,
      projectId: project.id,
      action: "project.updated",
      detail: { fields: Object.keys(changes) },
    });
    return { project };
  });

  // ---------------------------------------------------------------------
  // git
  //
  // Reading is `viewer`; anything that changes the repository or talks to the
  // remote is `editor` — the same role sending a prompt already needs — and is
  // recorded in the audit log, because every one of them is externally
  // visible or changes history.
  // ---------------------------------------------------------------------

  /** No network, no token: safe to poll while a panel is open. */
  app.get<{ Params: { id: string } }>("/api/projects/:id/git", async (request) => {
    const user = access.requireUser(request);
    await access.requireProject(user, request.params.id, "viewer");
    return { status: await deps.projects.git.status(request.params.id) };
  });

  /**
   * Where the project pushes to. A `PUT` rather than a `POST` because there is
   * only ever one remote and this sets it — see `GitService` for why a second
   * one is not offered at all.
   */
  app.put<{ Params: { id: string } }>("/api/projects/:id/git/remote", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = setGitRemoteSchema.parse(request.body);
    const { previous } = await deps.projects.git.setRemote(
      request.params.id,
      input.gitUrl,
      input.replace,
    );
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.git_remote_set",
      // The address, never a credential — `setRemote` redacts before it returns.
      detail: { previous, replaced: previous !== null },
    });
    return { status: await deps.projects.git.status(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/git/fetch", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = gitFetchSchema.parse(request.body ?? {});
    const status = await deps.projects.git.fetch(request.params.id, input.gitToken);
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.git_fetched",
      detail: { ahead: status.ahead, behind: status.behind },
    });
    return { status };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/git/pull", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = gitPullSchema.parse(request.body ?? {});

    // A pull rewrites the working tree, which is exactly what snapshots are
    // for. Taken before, so "undo" covers it like any turn — and taken even
    // though `pull` undoes its own failures, because a *successful* pull is
    // also something someone can want back.
    await deps.projects
      .snapshot(request.params.id, "Before pulling from the remote")
      .catch(() => undefined);

    const status = await deps.projects.git.pull(request.params.id, input);
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.git_pulled",
      detail: { strategy: input.strategy, pulled: status.pulled },
    });
    return { status };
  });

  // Manual, on-demand. Zelyq never pushes without being asked.
  app.post<{ Params: { id: string } }>("/api/projects/:id/git/push", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = pushToRemoteSchema.parse(request.body);
    const result = await deps.projects.pushToRemote(
      request.params.id,
      input.gitUrl,
      input.gitToken,
    );
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.pushed",
      detail: { branch: result.branch },
    });
    return { pushed: true, ...result, status: await deps.projects.git.status(request.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/git/branch", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = gitBranchSchema.parse(request.body);
    const status = await deps.projects.git.switchBranch(
      request.params.id,
      input.name,
      input.create,
    );
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.git_branch_switched",
      detail: { branch: input.name },
    });
    return { status };
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/git/pull-request", async (request) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "editor");
    const input = createPullRequestSchema.parse(request.body);
    const result = await deps.projects.git.createPullRequest(request.params.id, input);
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.pull_request_opened",
      detail: { branch: result.branch, base: result.base, opened: result.url !== null },
    });
    return { pullRequest: result, status: await deps.projects.git.status(request.params.id) };
  });

  // Deleting removes files from disk as well as the row, so it takes admin.
  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request, reply) => {
    const user = access.requireUser(request);
    const { project } = await access.requireProject(user, request.params.id, "admin");
    await deps.projects.remove(request.params.id);
    await access.recordChange(user, {
      teamId: project.teamId,
      projectId: project.id,
      action: "project.deleted",
      detail: { name: project.name },
    });
    reply.status(204);
  });
}
