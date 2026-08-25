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
        await this.cloneInto(id, input.gitUrl, input.gitToken);
        await this.assertZelyqCanWorkHere(id);
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
      if (input.gitUrl) {
        // A repository that was refused, or failed to clone, leaves nothing
        // behind: no half-project in the list, and no files on a disk that
        // would otherwise collect every repository we declined. The caller
        // gets the reason in the response.
        await this.runtime.removeProject(id).catch(() => undefined);
        await this.store.projects.remove(id).catch(() => undefined);
        throw error;
      }
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
   * Refuses a repository Zelyq cannot honestly work in.
   *
   * The agent is told, as fact, that it is in a React project. That was harmless
   * while every project came from one template and is a lie the moment a real
   * repository arrives. Teaching the agent five stacks is a different company;
   * saying so in ten seconds costs a person nothing and misleading them for an
   * hour costs their trust.
   *
   * "Is there a package.json with react in it" is the obvious test and it refuses
   * this project's own repository — the root manifest has no react, because the
   * web app is a workspace. Monorepos are normal in exactly the codebases this
   * feature is for, so every manifest in the tree is considered, not just the
   * one at the top.
   */
  private async assertZelyqCanWorkHere(id: string): Promise<void> {
    const entries = await this.runtime.listFiles(id, { depth: 3 });
    const paths = entries.filter((entry) => entry.type === "file").map((entry) => entry.path);

    const manifests = paths.filter((file) => file.endsWith("package.json")).slice(0, 30);
    for (const manifest of manifests) {
      const file = await this.runtime.readFile(id, manifest).catch(() => null);
      if (!file || file.encoding !== "utf8") continue;
      try {
        const parsed = JSON.parse(file.content) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...parsed.dependencies, ...parsed.devDependencies };
        if ("react" in deps) return;
      } catch {
        // A manifest we cannot parse tells us nothing; keep looking.
      }
    }

    // Name what was found rather than what was missing. "Unsupported" tells
    // somebody nothing; "this looks like a Python project" tells them why.
    const looksLike = describeStack(paths, manifests.length > 0);
    throw ZelyqError.badRequest(
      `${looksLike} Zelyq only works on React projects at the moment — support for others is planned.`,
    );
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
    // An empty value first, which resets the list rather than adding to it.
    //
    // Without this, git uses whatever credentials the machine already has —
    // and a machine that has ever run `gh auth login` has some. Two
    // consequences, both bad: a private repository clones with no token at all,
    // using the *server's* identity, so anyone on a shared Zelyq reaches every
    // repository that identity can see; and a token that is supplied is
    // ignored, because the machine's helper answers first. The second one looks
    // like "repository not found", because the server's identity genuinely
    // cannot see somebody else's private repository.
    const helper = token
      ? `-c credential.helper= -c credential.helper='!f() { echo username=x-access-token; echo "password=$ZELYQ_GIT_TOKEN"; }; f' `
      : "-c credential.helper= ";

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
      const output = result.stderr || result.stdout;

      // A private repository refuses in several dialects, and none of them tell
      // somebody what to do about it. Repeating git's wording here would be
      // accurate and useless.
      if (/authentication failed|could not read username|invalid credentials|403/i.test(output)) {
        throw ZelyqError.badRequest(
          token
            ? "That token was refused. Check it has read access to this repository and has not expired."
            : "This repository needs a token. Create one with read access to it — read is enough, " +
                "Zelyq never pushes — and paste it into the token field.",
        );
      }
      if (/repository not found|not found|does not exist/i.test(output)) {
        // GitHub answers 404 for a private repository the caller cannot see,
        // rather than admitting it exists. So "not found" with a token supplied
        // usually means the token cannot reach it, not that it is missing.
        throw ZelyqError.badRequest(
          token
            ? "That repository was not found, which usually means this token cannot reach it. " +
                "Check the address, and that the token has read access to this repository."
            : "That repository was not found. Check the address, and if it is private, paste a " +
                "token with read access to it.",
        );
      }

      const detail = output.trim().split("\n").slice(-3).join(" ");
      throw ZelyqError.badRequest(
        `Could not clone that repository. ${detail || `git exited with code ${result.exitCode}`}`,
      );
    }

    // The credential was a one-shot `-c` flag and a variable in the environment,
    // so nothing should have been written into the clone. Checked rather than
    // assumed: a token in .git/config is readable by the agent and usable to
    // push, which is the one thing this feature promises not to do.
    if (token) {
      const config = await this.runtime
        .readFile(id, ".git/config")
        .then((file) => file.content)
        .catch(() => "");
      if (config.includes(token)) {
        await this.runtime.exec(id, {
          command: "git config --unset-all credential.helper || true",
        });
        throw ZelyqError.badRequest(
          "The clone stored your token in the project, which Zelyq does not allow. " +
            "The project has been discarded; please revoke that token.",
        );
      }
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

  /**
   * Real, ordinary git, separate from snapshots — which remain the actual
   * undo mechanism. See `035` in the council notes: this exists so a
   * project's history is real and usable the moment someone runs `git log`,
   * not because anything else here needs it.
   *
   * Never through the agent's own shell tool — `shell.ts` already blocks git
   * commands there, for the reason it always has: the project's git history
   * sits outside the snapshot that makes a turn undoable, so a tool-driven
   * git command could corrupt what this quietly maintains alongside it. This
   * is the second, server-orchestrated git operation that relationship
   * already describes — the same one `cloneInto` already is.
   *
   * Idempotent and cheap enough to call every turn: `git init` only runs if
   * `.git` is not already there (a fresh scaffold; a clone already has one),
   * and identity is only set if this repo has none of its own yet — a
   * cloned repository's own configured author, if it somehow already has
   * one, is respected rather than overwritten.
   */
  async ensureGitRepo(id: string): Promise<void> {
    const isRepo = await this.runtime.exec(id, { command: "git rev-parse --is-inside-work-tree" });
    if (isRepo.exitCode !== 0) {
      const init = await this.runtime.exec(id, { command: "git init -q" });
      if (init.exitCode !== 0) {
        throw new Error(
          `git init failed: ${init.stderr || init.stdout || `exit ${init.exitCode}`}`,
        );
      }
    }
    const identity = await this.runtime.exec(id, { command: "git config --local user.name" });
    if (identity.exitCode !== 0 || !identity.stdout.trim()) {
      await this.runtime.exec(id, { command: 'git config --local user.name "Zelyq"' });
      await this.runtime.exec(id, { command: 'git config --local user.email "noreply@zelyq.dev"' });
    }
  }

  /**
   * Commits whatever a turn actually changed — a real `git diff`, not a
   * tool-name allowlist, so this covers a plugin tool's own file writes
   * (`037`) the same as a built-in one's. No commit when nothing actually
   * changed: an empty commit for a turn that only read files would be noise
   * in a history meant to be real and usable, not a log of every attempt.
   *
   * Throws on a real git failure rather than swallowing it — the caller
   * (`gateway.ts`) is the one that decides this is best-effort and wraps
   * the call in its own try/catch; silently no-op'ing here would mean a
   * genuine failure (disk full, permissions) never reaches that log line
   * at all.
   */
  async commitTurn(id: string, prompt: string): Promise<void> {
    await this.runtime.exec(id, { command: "git add -A" });
    const staged = await this.runtime.exec(id, { command: "git diff --cached --quiet" });
    if (staged.exitCode === 0) return; // nothing staged — nothing changed
    if (staged.exitCode > 1) {
      // 0 = no diff, 1 = a diff exists — anything else means git itself
      // failed (no repository, corrupt index), not "nothing to commit".
      throw new Error(
        `git diff failed: ${staged.stderr || staged.stdout || `exit ${staged.exitCode}`}`,
      );
    }

    // The exact text a snapshot's own label already uses — one more
    // consumer of a value already computed, not a new decision about what a
    // commit message should say.
    const message = `Before: ${prompt.slice(0, 120)}`;
    const safeMessage = `'${message.replaceAll("'", "'\\''")}'`;
    const commit = await this.runtime.exec(id, { command: `git commit -q -m ${safeMessage}` });
    if (commit.exitCode !== 0) {
      throw new Error(
        `git commit failed: ${commit.stderr || commit.stdout || `exit ${commit.exitCode}`}`,
      );
    }
  }

  /**
   * Push, manual and on-demand — `035` Part B. The promise clone already
   * made had to be replaced with its honest version, not quietly broken:
   * **Zelyq never pushes without being asked, and still never stores what
   * you give it.** Reuses `cloneInto`'s exact shape — the credential-helper
   * trick, the same safe quoting, `GIT_TERMINAL_PROMPT=0` — because this is
   * the same job in the other direction, not a new one.
   *
   * Never `--force`, not configurable to be one. A push that is not a
   * fast-forward fails with git's own ordinary error rather than
   * overwriting anything someone else pushed — the correct outcome, not a
   * bug to route around.
   */
  async pushToRemote(id: string, gitUrl?: string, token?: string): Promise<void> {
    const existingRemote = await this.runtime.exec(id, { command: "git remote get-url origin" });
    if (existingRemote.exitCode !== 0) {
      if (!gitUrl) {
        throw ZelyqError.badRequest(
          "This project has no remote yet. Paste a repository URL to push to.",
        );
      }
      const safeUrl = `'${gitUrl.replaceAll("'", "'\\''")}'`;
      const addRemote = await this.runtime.exec(id, {
        command: `git remote add origin ${safeUrl}`,
      });
      if (addRemote.exitCode !== 0) {
        throw ZelyqError.badRequest(
          `Could not add that remote. ${
            addRemote.stderr.trim() || `git exited with code ${addRemote.exitCode}`
          }`,
        );
      }
    }

    // Same trick cloneInto already uses: an empty helper first so the
    // server's own ambient git identity, if it has one, cannot answer for a
    // push nobody gave a credential for.
    const helper = token
      ? `-c credential.helper= -c credential.helper='!f() { echo username=x-access-token; echo "password=$ZELYQ_GIT_TOKEN"; }; f' `
      : "-c credential.helper= ";
    const env = {
      GIT_TERMINAL_PROMPT: "0",
      ...(token ? { ZELYQ_GIT_TOKEN: token } : {}),
    };

    const result = await this.runtime.exec(id, {
      command: `git ${helper}push -- origin HEAD`,
      timeoutMs: 5 * 60_000,
      env,
    });

    if (result.exitCode !== 0) {
      const output = result.stderr || result.stdout;

      if (/authentication failed|could not read username|invalid credentials|403/i.test(output)) {
        throw ZelyqError.badRequest(
          token
            ? "That token was refused. Check it has write access to this repository and has not expired."
            : "This repository needs a token with write access. Create one and paste it into the token field.",
        );
      }
      if (/repository not found|not found|does not exist/i.test(output)) {
        throw ZelyqError.badRequest(
          token
            ? "That repository was not found, which usually means this token cannot reach it. " +
                "Check the address, and that the token has write access to it."
            : "That repository was not found. Check the address, and if it is private, paste a " +
                "token with write access to it.",
        );
      }
      if (/non-fast-forward|fetch first|rejected/i.test(output)) {
        throw ZelyqError.badRequest(
          "The remote has commits this project doesn't. Zelyq never force-pushes, so this needs " +
            "resolving by hand — pull the remote's changes into this project's history first.",
        );
      }

      const detail = output.trim().split("\n").slice(-3).join(" ");
      throw ZelyqError.badRequest(
        `Could not push. ${detail || `git exited with code ${result.exitCode}`}`,
      );
    }

    // Same paranoia clone already has: the credential was one-shot, so
    // nothing should have been written into the project.
    if (token) {
      const config = await this.runtime
        .readFile(id, ".git/config")
        .then((file) => file.content)
        .catch(() => "");
      if (config.includes(token)) {
        await this.runtime.exec(id, {
          command: "git config --unset-all credential.helper || true",
        });
        throw ZelyqError.badRequest(
          "The push stored your token in the project, which Zelyq does not allow. " +
            "Please revoke that token.",
        );
      }
    }
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

/** A one-line guess at what somebody actually handed us, from the files present. */
function describeStack(paths: string[], hasManifest: boolean): string {
  const markers: Array<[string, string]> = [
    ["requirements.txt", "This looks like a Python project."],
    ["pyproject.toml", "This looks like a Python project."],
    ["go.mod", "This looks like a Go project."],
    ["Cargo.toml", "This looks like a Rust project."],
    ["Gemfile", "This looks like a Ruby project."],
    ["pom.xml", "This looks like a Java project."],
    ["build.gradle", "This looks like a Java project."],
    ["composer.json", "This looks like a PHP project."],
    ["Package.swift", "This looks like a Swift project."],
    ["pubspec.yaml", "This looks like a Dart or Flutter project."],
  ];

  const root = new Set(paths.map((file) => file.split("/").pop()));
  for (const [marker, description] of markers) {
    if (root.has(marker)) return description;
  }
  return hasManifest
    ? "This looks like a JavaScript project, but nothing in it uses React."
    : "This repository has no package.json, so it is not a React project.";
}
