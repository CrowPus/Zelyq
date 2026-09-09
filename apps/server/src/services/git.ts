import type {
  CreatePullRequestInput,
  GitPullInput,
  GitStatus,
  PullRequestResult,
} from "@zelyq/core";
import { ZelyqError } from "@zelyq/core";
import type { RuntimeDriver } from "@zelyq/runtime";

/**
 * Every git operation Zelyq performs on a project, in one place.
 *
 * ## The rules this service exists to keep
 *
 * **One remote, always called `origin`.** There is no API here for a second
 * one. Multiple remotes are how a person ends up pushing somewhere they were
 * not looking — `git push` picking a different default than they assumed — and
 * nothing in this product needs them. Changing where a project points is an
 * explicit, confirmed replacement (`setRemote`), never an addition.
 *
 * **Never force, never auto-resolve, never lose the working tree.** A push
 * that is not a fast-forward fails. A pull that conflicts is undone rather
 * than left half-applied. Neither is a limitation to route around: both are
 * the moments where automation destroys somebody's work.
 *
 * **The agent must never commit a conflicted tree.** `assertCommittable`
 * refuses while a merge or rebase is unfinished, because a per-turn commit
 * that swept up conflict markers would put them in the history and then push
 * them to a collaborator.
 *
 * **A local commit cannot conflict.** Worth stating because it is the natural
 * thing to assume it can: conflicts happen when histories are combined, which
 * is `pull`. What a turn's commit genuinely has to check is that it is not
 * committing *someone else's* half-finished merge, and whether the remote has
 * since moved on — which is why `commitTurn` reports `behind` back to the
 * caller rather than silently succeeding.
 *
 * ## Credentials
 *
 * A token is used for exactly one command and never written anywhere. The
 * mechanism is the same in every direction: an empty `credential.helper` first
 * so the machine's own ambient git identity cannot answer, then a one-shot
 * helper reading it from the environment. After any operation that was given
 * one, `.git/config` is checked to prove it was not persisted.
 */
export class GitService {
  constructor(private readonly runtime: RuntimeDriver) {}

  // ---------------------------------------------------------------------
  // Reading state
  // ---------------------------------------------------------------------

  /**
   * The whole state of a project's git, in one container round-trip.
   *
   * Deliberately one script rather than a dozen `exec` calls: on the container
   * runtime each one is a `docker exec`, so the obvious version of this took
   * over a second to answer a question the UI wants to ask on every render.
   *
   * No network. `ahead`/`behind` come from refs already on disk, so this is
   * safe to call without a token and cannot hang on an unreachable host — at
   * the cost of being only as fresh as the last fetch, which is what
   * `fetchedAt` is for.
   */
  async status(projectId: string): Promise<GitStatus> {
    const script = [
      "top=$(git rev-parse --show-toplevel 2>/dev/null || true)",
      "here=$(pwd -P)",
      '[ "$top" = "$here" ] || { printf "repo\\t0\\n"; exit 0; }',
      'printf "repo\\t1\\n"',
      'printf "branch\\t%s\\n" "$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"',
      'printf "commits\\t%s\\n" "$(git rev-list --count HEAD 2>/dev/null || echo 0)"',
      'printf "remote\\t%s\\n" "$(git remote get-url origin 2>/dev/null || true)"',
      'up=$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null || true)',
      'printf "upstream\\t%s\\n" "$up"',
      '[ -n "$up" ] && printf "counts\\t%s\\n" "$(git rev-list --left-right --count "$up...HEAD" 2>/dev/null || true)"',
      'printf "dirty\\t%s\\n" "$(git status --porcelain 2>/dev/null | head -c 1 | wc -c)"',
      'if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then printf "progress\\trebase\\n";',
      'elif [ -f .git/MERGE_HEAD ]; then printf "progress\\tmerge\\n";',
      'elif [ -f .git/CHERRY_PICK_HEAD ]; then printf "progress\\tcherry-pick\\n"; fi',
      '[ -f .git/FETCH_HEAD ] && printf "fetched\\t%s\\n" "$(date -u -r .git/FETCH_HEAD +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || true)"',
      'git diff --name-only --diff-filter=U 2>/dev/null | while read -r p; do printf "conflict\\t%s\\n" "$p"; done',
      "exit 0",
    ].join("\n");

    const result = await this.runtime.exec(projectId, { command: script });
    if (gitIsMissing(result.stderr || result.stdout)) {
      throw ZelyqError.badRequest(GIT_MISSING_MESSAGE);
    }

    const fields = new Map<string, string>();
    const conflicts: string[] = [];
    for (const line of result.stdout.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const key = line.slice(0, tab);
      const value = line.slice(tab + 1).trim();
      if (key === "conflict") conflicts.push(value);
      else fields.set(key, value);
    }

    if (fields.get("repo") !== "1") {
      return {
        repository: false,
        branch: null,
        detached: false,
        commits: 0,
        remote: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        fetchedAt: null,
        dirty: false,
        conflicts: [],
        inProgress: null,
      };
    }

    // `git rev-list --left-right --count <upstream>...HEAD` prints the two
    // sides in that order: behind, then ahead.
    const [behind = "0", ahead = "0"] = (fields.get("counts") ?? "").split(/\s+/);
    const branch = fields.get("branch") || null;
    const progress = fields.get("progress");

    return {
      repository: true,
      branch,
      detached: branch === null,
      commits: Number.parseInt(fields.get("commits") ?? "0", 10) || 0,
      remote: redactCredentials(fields.get("remote") || null),
      upstream: fields.get("upstream") || null,
      ahead: Number.parseInt(ahead, 10) || 0,
      behind: Number.parseInt(behind, 10) || 0,
      fetchedAt: fields.get("fetched") || null,
      dirty: fields.get("dirty") === "1",
      conflicts,
      inProgress:
        progress === "merge" || progress === "rebase" || progress === "cherry-pick"
          ? progress
          : null,
    };
  }

  // ---------------------------------------------------------------------
  // The repository itself
  // ---------------------------------------------------------------------

  /**
   * A project's own git repository, created if it is not there and left alone
   * if it is — so an existing history, or one someone cloned, is respected
   * rather than overwritten.
   *
   * The check is that the repository's top level *is* this project, not merely
   * that one exists. `--is-inside-work-tree` succeeds from anywhere under any
   * enclosing repository, and the default workspace directory sits inside the
   * Zelyq checkout — so on the local runtime this skipped `git init`, wrote
   * Zelyq's identity into the developer's own `.git/config`, and then
   * committed their entire working tree under the project's turn prompt. Found
   * by running the e2e suite, which does exactly that.
   */
  async ensureRepo(projectId: string): Promise<void> {
    const top = await this.runtime.exec(projectId, { command: "git rev-parse --show-toplevel" });
    const here = await this.runtime.exec(projectId, { command: "pwd -P" });
    const ownRepo = top.exitCode === 0 && top.stdout.trim() === here.stdout.trim();
    if (!ownRepo) {
      // `-b main` rather than whatever the host's git defaults to. It is not
      // cosmetic: GitHub creates repositories with `main`, so a project that
      // started on `master` pushes a second branch alongside it, and a pull
      // request then defaults to comparing against a base it shares no history
      // with. Old git without `-b` falls back rather than failing.
      const init = await this.runtime.exec(projectId, {
        command: "git init -q -b main 2>/dev/null || git init -q",
      });
      if (init.exitCode !== 0) {
        const output = init.stderr || init.stdout;
        if (gitIsMissing(output)) throw new Error(GIT_MISSING_MESSAGE);
        throw new Error(`git init failed: ${output || `exit ${init.exitCode}`}`);
      }
    }
    const identity = await this.runtime.exec(projectId, {
      command: "git config --local user.name",
    });
    if (identity.exitCode !== 0 || !identity.stdout.trim()) {
      await this.runtime.exec(projectId, { command: 'git config --local user.name "Zelyq"' });
      await this.runtime.exec(projectId, {
        command: 'git config --local user.email "noreply@zelyq.dev"',
      });
    }
    await this.ensureDefaultExcludes(projectId);
  }

  /**
   * A safety net for a project with no `.gitignore` of its own.
   *
   * Both templates ship one, so this is normally a single `test -f` and
   * nothing else. It matters for the projects that do not: a clone of a
   * repository without one, or a project whose files the agent wrote from
   * scratch. Every commit path here stages everything that changed, and on
   * such a project that means `node_modules` — hundreds of megabytes of
   * dependencies committed, and then pushed to someone's GitHub.
   *
   * Written to `.git/info/exclude` rather than a `.gitignore`, deliberately:
   * it does the same job, and it does not put a file into someone's project
   * that they did not ask for and would find in their own first commit. `.env`
   * is in the list for the obvious reason — a push should not be how a
   * project's secrets leave the machine.
   */
  private async ensureDefaultExcludes(projectId: string): Promise<void> {
    const hasIgnore = await this.runtime.exec(projectId, { command: "test -f .gitignore" });
    if (hasIgnore.exitCode === 0) return;

    const patterns = ["node_modules/", "dist/", "build/", ".next/", ".expo/", ".env", ".env.*"];
    const lines = patterns.map((pattern) => sq(pattern)).join(" ");
    await this.runtime.exec(projectId, {
      command: `mkdir -p .git/info && printf '%s\\n' ${lines} > .git/info/exclude`,
    });
  }

  // ---------------------------------------------------------------------
  // Committing
  // ---------------------------------------------------------------------

  /**
   * Refuses while the repository is mid-merge, mid-rebase, or holding
   * unresolved conflicts.
   *
   * This is the check the per-turn commit actually needs. A commit on its own
   * cannot conflict — conflicts come from combining histories — but committing
   * *during* an unfinished combine is how conflict markers end up in the
   * history and then in a collaborator's checkout. It is also the state in
   * which an agent must not be editing files at all, which is why the turn
   * itself is stopped on it rather than only the commit.
   */
  async assertCommittable(projectId: string): Promise<void> {
    const state = await this.status(projectId);
    if (!state.repository) return;

    if (state.inProgress) {
      throw ZelyqError.badRequest(
        `This project is in the middle of a ${state.inProgress} that was never finished` +
          `${state.conflicts.length ? `, with ${state.conflicts.length} file(s) still conflicting` : ""}. ` +
          "Finish or undo it before making more changes — undoing it puts the project back " +
          "exactly as it was before the pull.",
      );
    }
    if (state.conflicts.length > 0) {
      throw ZelyqError.badRequest(
        `${state.conflicts.length} file(s) in this project still have unresolved conflicts ` +
          `(${state.conflicts.slice(0, 3).join(", ")}${state.conflicts.length > 3 ? ", …" : ""}). ` +
          "Resolve them before making more changes, so the conflict markers are not committed.",
      );
    }
  }

  /**
   * Commits whatever a turn actually changed — a real `git diff`, not a
   * tool-name allowlist, so this covers a plugin tool's own file writes the
   * same as a built-in one's. No commit when nothing actually changed: an
   * empty commit for a turn that only read files would be noise in a history
   * meant to be real and usable, not a log of every attempt.
   *
   * Returns what the caller needs to tell the user afterwards — whether
   * anything was committed, and whether the remote has moved on since. The
   * `behind` count costs no network: it reads refs already fetched, so a turn
   * never waits on a git host or needs a token to produce it.
   *
   * Throws on a real git failure rather than swallowing it — the caller
   * (`gateway.ts`) is the one that decides this is best-effort and wraps the
   * call in its own try/catch; silently no-op'ing here would mean a genuine
   * failure (disk full, permissions) never reaches that log line at all.
   */
  async commitTurn(
    projectId: string,
    prompt: string,
  ): Promise<{ committed: boolean; behind: number; branch: string | null }> {
    await this.assertCommittable(projectId);

    // Pathspec, not a bare `git add -A`: without one git stages the whole
    // repository the command happens to be inside, not this directory's.
    await this.runtime.exec(projectId, { command: "git add -A ." });
    const staged = await this.runtime.exec(projectId, { command: "git diff --cached --quiet" });

    let committed = false;
    if (staged.exitCode === 1) {
      // The exact text a snapshot's own label already uses.
      const message = `Before: ${prompt.slice(0, 120)}`;
      const commit = await this.runtime.exec(projectId, {
        command: `git commit -q -m ${sq(message)}`,
      });
      if (commit.exitCode !== 0) {
        const output = commit.stderr || commit.stdout;
        if (gitIsMissing(output)) throw new Error(GIT_MISSING_MESSAGE);
        throw new Error(`git commit failed: ${output || `exit ${commit.exitCode}`}`);
      }
      committed = true;
    } else if (staged.exitCode !== 0) {
      // 0 = no diff, 1 = a diff exists — anything else means git itself failed.
      const output = staged.stderr || staged.stdout;
      if (gitIsMissing(output)) throw new Error(GIT_MISSING_MESSAGE);
      throw new Error(`git diff failed: ${output || `exit ${staged.exitCode}`}`);
    }

    const after = await this.status(projectId);
    return { committed, behind: after.behind, branch: after.branch };
  }

  /**
   * A repository with no commits at all has nothing for `push origin HEAD` to
   * name — git answers "src refspec HEAD does not match any", which says
   * nothing useful to someone who has just built an app and pressed push. A
   * project that has never had a turn committed is exactly that case, so its
   * current files become the first commit here.
   */
  private async commitInitialIfEmpty(projectId: string, message = "Initial commit"): Promise<void> {
    const head = await this.runtime.exec(projectId, { command: "git rev-parse --verify -q HEAD" });
    if (head.exitCode === 0) return;

    await this.runtime.exec(projectId, { command: "git add -A ." });
    const staged = await this.runtime.exec(projectId, { command: "git diff --cached --quiet" });
    if (staged.exitCode === 0) {
      throw ZelyqError.badRequest(
        "This project has no files yet, so there is nothing to push. Ask for something to be " +
          "built first.",
      );
    }
    const commit = await this.runtime.exec(projectId, {
      command: `git commit -q -m ${sq(message)}`,
    });
    if (commit.exitCode !== 0) {
      const output = commit.stderr || commit.stdout;
      if (gitIsMissing(output)) throw ZelyqError.badRequest(GIT_MISSING_MESSAGE);
      throw ZelyqError.badRequest(`Could not make the first commit. ${lastLines(output, 2)}`);
    }
  }

  // ---------------------------------------------------------------------
  // The remote
  // ---------------------------------------------------------------------

  /**
   * Points the project at a repository, or moves it to a different one.
   *
   * The `replace` gate is the whole point. Repointing silently is how a push
   * ends up somewhere nobody is looking: the address in the box changed, the
   * push said "done", and the commits went to the old place — or the new one,
   * depending on which way the code guessed. Neither guess is acceptable, so
   * an attempt to change an existing remote is refused, the current address is
   * reported back, and the caller has to ask a human.
   *
   * Replacing also drops the branch's upstream. `ahead`/`behind` were measured
   * against a different repository and mean nothing now; leaving them would be
   * a confident number about the wrong thing.
   */
  async setRemote(
    projectId: string,
    gitUrl: string,
    replace: boolean,
  ): Promise<{ previous: string | null }> {
    await this.ensureRepo(projectId);

    const existing = await this.runtime.exec(projectId, { command: "git remote get-url origin" });
    const previous = existing.exitCode === 0 ? existing.stdout.trim() : null;

    if (previous && sameRemote(previous, gitUrl)) return { previous: redactCredentials(previous) };

    if (previous && !replace) {
      throw ZelyqError.badRequest(
        `This project already pushes to ${redactCredentials(previous)}. Confirm that you want to ` +
          "point it somewhere else — the commits it already has will not be sent to the old " +
          "address afterwards.",
        { currentRemote: redactCredentials(previous), requestedRemote: gitUrl },
      );
    }

    const command = previous
      ? `git remote set-url origin ${sq(gitUrl)}`
      : `git remote add origin ${sq(gitUrl)}`;
    const result = await this.runtime.exec(projectId, { command });
    if (result.exitCode !== 0) {
      const output = result.stderr || result.stdout;
      if (gitIsMissing(output)) throw ZelyqError.badRequest(GIT_MISSING_MESSAGE);
      throw ZelyqError.badRequest(`Could not set that remote. ${lastLines(output, 2)}`);
    }

    if (previous) {
      // Tracking now refers to a repository this project no longer talks to.
      const branch = await this.currentBranch(projectId);
      if (branch) {
        await this.runtime.exec(projectId, {
          command: `git branch --unset-upstream ${sq(branch)} 2>/dev/null || true`,
        });
      }
      await this.runtime.exec(projectId, {
        command: "git remote prune origin 2>/dev/null || true",
      });
    }

    return { previous: previous ? redactCredentials(previous) : null };
  }

  // ---------------------------------------------------------------------
  // Talking to the remote
  // ---------------------------------------------------------------------

  /**
   * Updates what this project knows about the remote, and changes nothing
   * else. The safe half of a pull: no working-tree changes, no merge, nothing
   * to undo — so it is the right thing to do before showing someone how far
   * behind they are.
   */
  async fetch(projectId: string, token?: string): Promise<GitStatus> {
    await this.requireRemote(projectId);
    const result = await this.network(projectId, "fetch --prune origin", token);
    if (result.exitCode !== 0) {
      throw remoteFailure(result.stderr || result.stdout, result.exitCode, "fetch from", token);
    }
    await this.assertTokenNotStored(projectId, token);
    return this.status(projectId);
  }

  /**
   * Brings a collaborator's commits into this project.
   *
   * Ordered so that the dangerous parts cannot happen by accident:
   *
   * 1. Refuse outright while the tree is dirty or a merge is unfinished. A
   *    pull into uncommitted work is the classic way to lose it, and this
   *    product has an obvious alternative to offer — a turn commits, so there
   *    is something to say.
   * 2. Fetch, so the decision below is made on current facts rather than
   *    whatever was last seen.
   * 3. Fast-forward if that is all it takes. Nothing else can go wrong.
   * 4. If the histories have genuinely diverged, refuse under the default
   *    strategy and say so with both counts. Combining them is a choice
   *    between a merge commit and a rebase, and it is not this code's to make
   *    on somebody's behalf.
   * 5. If the chosen combine conflicts, undo it. The project goes back exactly
   *    as it was, the fetched commits stay fetched, and the caller is told
   *    which files disagreed.
   */
  async pull(projectId: string, input: GitPullInput): Promise<GitStatus & { pulled: boolean }> {
    const before = await this.requireRemote(projectId);

    if (before.inProgress || before.conflicts.length > 0) {
      await this.assertCommittable(projectId); // throws with the specific wording
    }
    if (before.dirty) {
      throw ZelyqError.badRequest(
        "This project has changes that are not committed yet, and pulling on top of them could " +
          "lose them. Send a turn — that commits what is there — or undo the changes first.",
      );
    }
    if (before.detached) {
      throw ZelyqError.badRequest(
        "This project is not on a branch, so there is nothing for a pull to update. Switch to a " +
          "branch first.",
      );
    }
    if (before.commits === 0) {
      throw ZelyqError.badRequest(
        "This project has no commits of its own yet, so there is nothing to pull into. Send a " +
          "turn first, or create the project by cloning the repository.",
      );
    }

    const fetched = await this.fetch(projectId, input.gitToken);
    const branch = fetched.branch;
    if (!branch) {
      throw ZelyqError.badRequest("This project is not on a branch, so a pull has no target.");
    }
    const target = fetched.upstream ?? `origin/${branch}`;

    const remoteHas = await this.runtime.exec(projectId, {
      command: `git rev-parse --verify -q ${sq(target)}`,
    });
    if (remoteHas.exitCode !== 0) {
      throw ZelyqError.badRequest(
        `The remote has no branch called "${branch}", so there is nothing to pull. Push this ` +
          "branch first to create it there.",
      );
    }

    const counts = await this.runtime.exec(projectId, {
      command: `git rev-list --left-right --count ${sq(`${target}...HEAD`)}`,
    });
    const [behindRaw = "0", aheadRaw = "0"] = counts.stdout.trim().split(/\s+/);
    const behind = Number.parseInt(behindRaw, 10) || 0;
    const ahead = Number.parseInt(aheadRaw, 10) || 0;

    if (behind === 0) {
      return { ...(await this.status(projectId)), pulled: false };
    }

    const diverged = ahead > 0;
    if (diverged && input.strategy === "ff-only") {
      throw ZelyqError.badRequest(
        `This project and the remote have both moved on — ${ahead} commit(s) here that are not ` +
          `there, and ${behind} there that are not here. They have to be combined deliberately: ` +
          "rebase puts this project's commits on top of theirs, merge keeps both and records a " +
          "merge commit.",
        { ahead, behind, strategies: ["rebase", "merge"] },
      );
    }

    const strategy = diverged ? input.strategy : "ff-only";
    const command =
      strategy === "rebase"
        ? `git rebase ${sq(target)}`
        : strategy === "merge"
          ? `git merge --no-edit ${sq(target)}`
          : `git merge --ff-only ${sq(target)}`;

    const result = await this.runtime.exec(projectId, { command, timeoutMs: 2 * 60_000 });
    if (result.exitCode === 0) {
      return { ...(await this.status(projectId)), pulled: true };
    }

    const after = await this.status(projectId);
    const conflicted = after.conflicts;

    if (input.onConflict === "keep") {
      return { ...after, pulled: false };
    }

    // Undo, so nothing is left half-applied. The fetched commits stay; only
    // the attempt to combine them is reversed.
    if (after.inProgress === "rebase") {
      await this.runtime.exec(projectId, { command: "git rebase --abort" });
    } else if (after.inProgress === "merge") {
      await this.runtime.exec(projectId, { command: "git merge --abort" });
    }

    const restored = await this.status(projectId);
    if (conflicted.length > 0) {
      throw ZelyqError.badRequest(
        `The remote's changes clash with this project's in ${conflicted.length} file(s): ` +
          `${conflicted.slice(0, 5).join(", ")}${conflicted.length > 5 ? ", …" : ""}. ` +
          "Nothing was changed — the project is exactly as it was. Ask for those files to be " +
          "reworked, then pull again.",
        { conflicts: conflicted, ahead, behind },
      );
    }
    throw ZelyqError.badRequest(
      `Could not combine the remote's changes. ${lastLines(result.stderr || result.stdout, 2)}`,
      { ahead: restored.ahead, behind: restored.behind },
    );
  }

  /**
   * Push, manual and on-demand. Zelyq never pushes without being asked, and
   * still never stores what you give it.
   *
   * Pushes the *current branch* with tracking (`-u`), not a bare `HEAD`. The
   * difference matters the first time: without it the branch on the remote has
   * no relationship to this one, so nothing afterwards can say how far ahead
   * or behind the project is, and every later push has to be told the branch
   * again.
   *
   * Never `--force`, and not configurable to be. A push that is not a
   * fast-forward fails with git's own ordinary error rather than overwriting
   * whatever a collaborator pushed — the correct outcome, not a bug to route
   * around.
   */
  async push(
    projectId: string,
    gitUrl?: string,
    token?: string,
  ): Promise<{ branch: string; remote: string }> {
    // A push must not assume a turn has already run in this project. Turn
    // start is the only other place that creates the repository, so a project
    // made before Zelyq kept git histories has no `.git` at all, and the first
    // thing the user saw was git's "fatal: not a git repository", from a
    // dialog that had just asked them for a repository address.
    await this.ensureRepo(projectId).catch((error: unknown) => {
      throw ZelyqError.badRequest(
        error instanceof Error ? error.message : "Could not prepare this project's git history.",
      );
    });

    const existing = await this.runtime.exec(projectId, { command: "git remote get-url origin" });
    const current = existing.exitCode === 0 ? existing.stdout.trim() : null;

    if (!current) {
      if (!gitUrl) {
        throw ZelyqError.badRequest(
          "This project has no remote yet. Paste a repository URL to push to.",
        );
      }
      await this.setRemote(projectId, gitUrl, false);
    } else if (gitUrl && !sameRemote(current, gitUrl)) {
      // The old behaviour ignored the address in this case and pushed to the
      // existing remote anyway — the user watching would have every reason to
      // believe their commits went to the address they had just typed.
      throw ZelyqError.badRequest(
        `This project pushes to ${redactCredentials(current)}, not the address given. Change ` +
          "where it points first if that is what you meant — pushing would have sent these " +
          "commits somewhere other than the address you typed.",
        { currentRemote: redactCredentials(current), requestedRemote: gitUrl },
      );
    }

    await this.commitInitialIfEmpty(projectId);
    await this.assertCommittable(projectId);

    const state = await this.status(projectId);
    if (!state.branch) {
      throw ZelyqError.badRequest(
        "This project is not on a branch, so there is nothing to push. Switch to a branch first.",
      );
    }
    if (state.upstream && state.behind > 0 && state.ahead > 0) {
      throw ZelyqError.badRequest(
        `The remote has ${state.behind} commit(s) this project does not, and this project has ` +
          `${state.ahead} it does not. Pull first — Zelyq never force-pushes, so sending these ` +
          "as-is would overwrite somebody else's work.",
        { ahead: state.ahead, behind: state.behind },
      );
    }

    const result = await this.network(
      projectId,
      `push -u origin ${sq(state.branch)}`,
      token,
      5 * 60_000,
    );
    if (result.exitCode !== 0) {
      throw remoteFailure(
        result.stderr || result.stdout,
        result.exitCode,
        "push to",
        token,
        "write access",
      );
    }
    await this.assertTokenNotStored(projectId, token);

    const remote = await this.runtime.exec(projectId, { command: "git remote get-url origin" });
    return { branch: state.branch, remote: redactCredentials(remote.stdout.trim()) ?? "" };
  }

  // ---------------------------------------------------------------------
  // Branches and pull requests
  // ---------------------------------------------------------------------

  /**
   * Switches branch, creating it if asked. Refuses on a dirty tree: git would
   * happily carry uncommitted changes across, which is exactly the surprise
   * nobody wants when they are trying to isolate work.
   */
  async switchBranch(projectId: string, name: string, create: boolean): Promise<GitStatus> {
    await this.ensureRepo(projectId);
    assertBranchName(name);

    const state = await this.status(projectId);
    if (state.inProgress || state.conflicts.length > 0) await this.assertCommittable(projectId);
    if (state.dirty) {
      throw ZelyqError.badRequest(
        "This project has changes that are not committed yet. Send a turn to commit them before " +
          "switching branch, so they stay with the branch they were made on.",
      );
    }
    if (state.commits === 0) {
      throw ZelyqError.badRequest(
        "This project has no commits yet, so there is no branch to move away from. Send a turn " +
          "first.",
      );
    }
    if (state.branch === name) return state;

    const exists = await this.runtime.exec(projectId, {
      command: `git rev-parse --verify -q ${sq(`refs/heads/${name}`)}`,
    });
    const command =
      exists.exitCode === 0
        ? `git checkout -q ${sq(name)}`
        : create
          ? `git checkout -q -b ${sq(name)}`
          : "";
    if (!command) {
      throw ZelyqError.badRequest(`This project has no branch called "${name}".`);
    }

    const result = await this.runtime.exec(projectId, { command });
    if (result.exitCode !== 0) {
      throw ZelyqError.badRequest(
        `Could not switch branch. ${lastLines(result.stderr || result.stdout, 2)}`,
      );
    }
    return this.status(projectId);
  }

  /**
   * Opens a pull request instead of pushing straight at a shared branch — the
   * right move when somebody else is working in the same repository.
   *
   * GitHub only, and explicit about it. Every host has a different API, and
   * guessing wrong would fail *after* the branch had already been pushed,
   * leaving a half-done job. For other hosts the branch is still pushed and a
   * compare URL comes back, which is the same outcome one click later.
   *
   * The token reaches GitHub's API from this server, not from the project's
   * container — the container never needs to know it, and this way the API
   * call is not shaped by anything inside the project.
   */
  async createPullRequest(
    projectId: string,
    input: CreatePullRequestInput,
  ): Promise<PullRequestResult> {
    await this.ensureRepo(projectId);

    const remoteUrl = await this.runtime.exec(projectId, { command: "git remote get-url origin" });
    if (remoteUrl.exitCode !== 0 || !remoteUrl.stdout.trim()) {
      throw ZelyqError.badRequest(
        "This project has no remote yet, so there is nowhere to open a pull request. Set the " +
          "repository address first.",
      );
    }
    const origin = remoteUrl.stdout.trim();
    const repo = parseGitHubRepo(origin);

    await this.commitInitialIfEmpty(projectId, input.title);
    await this.assertCommittable(projectId);

    const state = await this.status(projectId);
    const base = input.base ?? (repo ? await this.githubDefaultBranch(repo, input.gitToken) : null);

    if (base && state.branch === base && !input.branch) {
      // Opening a pull request from the base branch onto itself is not a
      // thing. A generated name keeps the flow working rather than making the
      // user think about branches they never asked to care about.
      await this.switchBranchCarryingWork(projectId, generatedBranchName(input.title));
    } else if (input.branch && state.branch !== input.branch) {
      await this.switchBranchCarryingWork(projectId, input.branch);
    }

    // Whatever is uncommitted becomes the pull request's own commit — someone
    // asking to open one is asking to propose the work in front of them.
    const beforeCommit = await this.status(projectId);
    if (beforeCommit.dirty) {
      await this.runtime.exec(projectId, { command: "git add -A ." });
      await this.runtime.exec(projectId, { command: `git commit -q -m ${sq(input.title)}` });
    }

    const head = (await this.status(projectId)).branch;
    if (!head) {
      throw ZelyqError.badRequest(
        "This project is not on a branch, so there is nothing to open a pull request from.",
      );
    }

    const pushed = await this.network(
      projectId,
      `push -u origin ${sq(head)}`,
      input.gitToken,
      5 * 60_000,
    );
    if (pushed.exitCode !== 0) {
      throw remoteFailure(
        pushed.stderr || pushed.stdout,
        pushed.exitCode,
        "push to",
        input.gitToken,
        "write access",
      );
    }
    await this.assertTokenNotStored(projectId, input.gitToken);

    if (!repo || !base) {
      return {
        branch: head,
        base: base ?? "the default branch",
        url: null,
        compareUrl: null,
        existing: false,
      };
    }
    if (head === base) {
      throw ZelyqError.badRequest(
        `A pull request needs two different branches, and this project is on "${base}", which is ` +
          "what it would be merging into. Name a branch to propose the changes from.",
      );
    }

    const compareUrl = `https://github.com/${repo.owner}/${repo.name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`;
    const opened = await this.githubOpenPullRequest(repo, input, head, base);
    return { branch: head, base, compareUrl: opened.url ? null : compareUrl, ...opened };
  }

  /**
   * Branch switching for the pull-request flow, where uncommitted work is the
   * normal case rather than a problem — the whole point is to propose it. git
   * carries it across on its own; this only exists so the safety checks in
   * `switchBranch` are not applied where they would be wrong.
   */
  private async switchBranchCarryingWork(projectId: string, name: string): Promise<void> {
    assertBranchName(name);
    const exists = await this.runtime.exec(projectId, {
      command: `git rev-parse --verify -q ${sq(`refs/heads/${name}`)}`,
    });
    const result = await this.runtime.exec(projectId, {
      command:
        exists.exitCode === 0 ? `git checkout -q ${sq(name)}` : `git checkout -q -b ${sq(name)}`,
    });
    if (result.exitCode !== 0) {
      throw ZelyqError.badRequest(
        `Could not create the branch "${name}". ${lastLines(result.stderr || result.stdout, 2)}`,
      );
    }
  }

  private async githubDefaultBranch(
    repo: { owner: string; name: string },
    token: string,
  ): Promise<string> {
    const response = await githubRequest(`/repos/${repo.owner}/${repo.name}`, token);
    if (!response.ok) {
      throw ZelyqError.badRequest(
        response.status === 404
          ? "That repository was not found on GitHub, which usually means this token cannot " +
              "reach it. Check the address, and that the token has access."
          : `GitHub refused to describe the repository (${response.status}). Check the token has ` +
              "access to it.",
      );
    }
    const body = (await response.json()) as { default_branch?: string };
    return body.default_branch ?? "main";
  }

  private async githubOpenPullRequest(
    repo: { owner: string; name: string },
    input: CreatePullRequestInput,
    head: string,
    base: string,
  ): Promise<{ url: string | null; existing: boolean }> {
    const response = await githubRequest(
      `/repos/${repo.owner}/${repo.name}/pulls`,
      input.gitToken,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          ...(input.body ? { body: input.body } : {}),
          head,
          base,
        }),
      },
    );

    if (response.status === 201) {
      const body = (await response.json()) as { html_url?: string };
      return { url: body.html_url ?? null, existing: false };
    }

    // GitHub answers 422 both for "one already exists" and for a genuinely
    // invalid request, so the existing one is looked up rather than assumed.
    if (response.status === 422) {
      const open = await githubRequest(
        `/repos/${repo.owner}/${repo.name}/pulls?head=${encodeURIComponent(`${repo.owner}:${head}`)}&state=open`,
        input.gitToken,
      );
      if (open.ok) {
        const list = (await open.json()) as Array<{ html_url?: string }>;
        const first = list[0];
        if (first?.html_url) return { url: first.html_url, existing: true };
      }
    }

    // The branch is pushed either way, so this is a degraded success, not a
    // failure: the caller gets a compare URL and one click finishes the job.
    return { url: null, existing: false };
  }

  // ---------------------------------------------------------------------
  // Shared mechanics
  // ---------------------------------------------------------------------

  private async currentBranch(projectId: string): Promise<string | null> {
    const result = await this.runtime.exec(projectId, {
      command: "git symbolic-ref --quiet --short HEAD",
    });
    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  }

  private async requireRemote(projectId: string): Promise<GitStatus> {
    const state = await this.status(projectId);
    if (!state.repository) {
      throw ZelyqError.badRequest(
        "This project does not have a git history yet. Send a turn, or push it once, and it will.",
      );
    }
    if (!state.remote) {
      throw ZelyqError.badRequest(
        "This project has no remote yet, so there is nothing to talk to. Set the repository " +
          "address first.",
      );
    }
    return state;
  }

  /**
   * Any git command that talks to the remote, with the one-shot credential.
   *
   * The empty helper first is not redundant: without it, a machine with its
   * own git credentials configured would quietly answer for a request nobody
   * gave a credential for, and the operation would succeed as somebody else.
   */
  private network(projectId: string, args: string, token?: string, timeoutMs?: number) {
    const helper = token
      ? `-c credential.helper= -c credential.helper='!f() { echo username=x-access-token; echo "password=$ZELYQ_GIT_TOKEN"; }; f' `
      : "-c credential.helper= ";
    return this.runtime.exec(projectId, {
      command: `git ${helper}${args}`,
      timeoutMs: timeoutMs ?? 2 * 60_000,
      env: {
        GIT_TERMINAL_PROMPT: "0",
        ...(token ? { ZELYQ_GIT_TOKEN: token } : {}),
      },
    });
  }

  /**
   * The credential was a one-shot `-c` flag and a variable in the environment,
   * so nothing should have been written into the project. Checked rather than
   * assumed: a token in `.git/config` is readable by the agent and usable to
   * push, which is the one thing this feature promises not to do.
   */
  private async assertTokenNotStored(projectId: string, token?: string): Promise<void> {
    if (!token) return;
    const config = await this.runtime
      .readFile(projectId, ".git/config")
      .then((file) => file.content)
      .catch(() => "");
    if (!config.includes(token)) return;

    await this.runtime.exec(projectId, {
      command: "git config --unset-all credential.helper || true",
    });
    throw ZelyqError.badRequest(
      "That operation stored your token in the project, which Zelyq does not allow. Please " +
        "revoke that token.",
    );
  }
}

// -------------------------------------------------------------------------
// Free functions — shared with `projects.ts`, which clones at creation time.
// -------------------------------------------------------------------------

/**
 * `git: command not found` — the environment a project runs in has no git at
 * all, which is a different thing from any git command failing and needs a
 * different answer. It happened for real: project containers ran on
 * `node:22-bookworm-slim`, which does not ship git, so every call failed this
 * way. The turn-level calls are best-effort, so it was silent until someone
 * tried to push and got the raw shell error.
 *
 * Matched on the shell's own wording rather than exit 127, because a git
 * subcommand can exit 127 for its own reasons.
 */
export function gitIsMissing(output: string): boolean {
  return /\bgit: command not found|command not found: git|executable file not found.*\bgit\b/i.test(
    output,
  );
}

/** The same sentence wherever that is what happened. */
export const GIT_MISSING_MESSAGE =
  "git is not installed in the environment this project runs in, so Zelyq cannot " +
  "keep its history or push it anywhere. If you set ZELYQ_CONTAINER_IMAGE, that " +
  "image needs git in it; otherwise restart Zelyq and it will build one that has it.";

/** Single-quoted for the shell, with embedded quotes escaped the POSIX way. */
export function sq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * A URL can carry `user:password@`, and it is echoed back by git in its own
 * error output. Anything leaving this server for a screen, a log or an audit
 * entry goes through here first.
 */
export function redactCredentials(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/\/\/[^/@\s]+@/, "//");
}

/** Trailing lines of git's own output, for a message a person has to read. */
export function lastLines(output: string, count: number): string {
  return output.trim().split("\n").slice(-count).join(" ").trim();
}

/**
 * Whether two addresses mean the same repository, so that a re-pasted URL is
 * not treated as a change. A trailing `.git` and a trailing slash are the two
 * differences people actually produce by copying from different places.
 */
export function sameRemote(a: string, b: string): boolean {
  const normalize = (url: string) =>
    url
      .trim()
      .replace(/\.git$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * git's own rules, minus the exotic parts: no leading dash, no whitespace, no
 * `..`, none of the characters git reserves. Checked here rather than left to
 * git so the message is about branch names, not about `refname` syntax.
 */
export function assertBranchName(name: string): void {
  const invalid =
    name.length === 0 ||
    name.length > 200 ||
    /[\s~^:?*[\\]/.test(name) ||
    name.includes("..") ||
    name.startsWith("-") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.endsWith(".") ||
    name.endsWith(".lock");
  if (invalid) {
    throw ZelyqError.badRequest(
      `"${name}" is not a usable branch name. Letters, numbers, dashes and slashes work; spaces ` +
        "and the characters git reserves do not.",
    );
  }
}

/** `zelyq/add-a-contact-form-4f2a91` — readable, and unlikely to collide. */
export function generatedBranchName(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "changes";
  const suffix = Math.random().toString(16).slice(2, 8);
  return `zelyq/${slug}-${suffix}`;
}

/** `https://github.com/owner/name(.git)` — anything else is not GitHub. */
export function parseGitHubRepo(url: string): { owner: string; name: string } | null {
  const match = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
    url.trim(),
  );
  if (!match) return null;
  const [, owner, name] = match;
  return owner && name ? { owner, name } : null;
}

function githubRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "zelyq",
      "x-github-api-version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

/**
 * git's failures, translated once, for every direction of talking to a remote.
 *
 * `403` is matched only as an HTTP status. git echoes the remote URL back in
 * its failure output, so a bare `403` matched the digits of a port (40312) or
 * a repository name, and a plain non-fast-forward came back as "this
 * repository needs a token" — flaky exactly as often as either happened to
 * contain those digits.
 */
export function remoteFailure(
  output: string,
  exitCode: number,
  verb: string,
  token?: string,
  /**
   * What the token has to be able to do. Worth saying: a read-scoped token is
   * the commonest reason a push is refused after a fetch worked, and "needs a
   * token" sends someone back to make the same one again.
   */
  access: "access" | "write access" = "access",
): ZelyqError {
  if (gitIsMissing(output)) return ZelyqError.badRequest(GIT_MISSING_MESSAGE);

  if (
    /authentication failed|could not read username|invalid credentials|http\W{0,3}403\b/i.test(
      output,
    )
  ) {
    return ZelyqError.badRequest(
      token
        ? `That token was refused. Check it has ${access} to this repository and has not expired.`
        : `This repository needs a token with ${access}. Create one and paste it into the token ` +
            "field.",
    );
  }
  if (/repository not found|not found|does not exist/i.test(output)) {
    return ZelyqError.badRequest(
      token
        ? "That repository was not found, which usually means this token cannot reach it. Check " +
            `the address, and that the token has ${access} to it.`
        : "That repository was not found. Check the address, and if it is private, paste a token " +
            `with ${access} to it.`,
    );
  }
  if (/non-fast-forward|fetch first|rejected/i.test(output)) {
    return ZelyqError.badRequest(
      "The remote has commits this project doesn't. Zelyq never force-pushes, so pull first — " +
        "that brings their changes in, and then this will go through.",
    );
  }
  if (/could not resolve host|connection refused|timed out|network is unreachable/i.test(output)) {
    return ZelyqError.badRequest(
      "Could not reach the repository host. Check the address and that this machine has network " +
        "access to it.",
    );
  }
  return ZelyqError.badRequest(
    `Could not ${verb} that repository. ${lastLines(output, 3) || `git exited with code ${exitCode}`}`,
  );
}
