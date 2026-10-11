import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The biggest pipeline file read from a repository. */
const MAX_FILE_BYTES = 256 * 1024;

export type RepoFileResult =
  | { ok: true; text: string; commit: string }
  | { ok: false; missing: boolean; message: string };

/**
 * Reads one file from a repository at a branch, tag or commit, the way a
 * runner's checkout fetches it: a shallow fetch into an empty folder, then
 * only that file. The token travels as an HTTP header in the environment,
 * never on a command line, and the server's own git settings (credential
 * helpers, saved logins) are never used.
 */
export class RepoFiles {
  constructor(
    /** Which transports git may use: https only, but tests read a local folder. */
    private readonly protocols = "https",
    private readonly timeoutMs = 60_000,
  ) {}

  async read(input: {
    repo: string;
    /** A branch, tag or commit; null: the repository's default branch. */
    ref: string | null;
    path: string;
    token: string | null;
  }): Promise<RepoFileResult> {
    const ref = input.ref ?? "HEAD";
    if (!safeRef(ref)) {
      return { ok: false, missing: false, message: `${ref} is not a branch, tag or commit.` };
    }
    const dir = await mkdtemp(join(tmpdir(), "zelyq-repo-file-"));
    try {
      const git = (args: string[]) => this.git(dir, args, input.token);
      await git(["init", "-q", "."]);
      await git(["remote", "add", "origin", input.repo]);
      // Only the folders, no file contents: the one file is fetched when read.
      await git(["config", "remote.origin.promisor", "true"]);
      await git(["config", "remote.origin.partialclonefilter", "blob:none"]);
      const fetched = await git([
        "fetch",
        "-q",
        "--depth",
        "1",
        "--no-tags",
        "--filter=blob:none",
        "origin",
        ref,
      ]);
      if (fetched.code !== 0)
        return { ok: false, ...fetchProblem(fetched.stderr, input.repo, ref) };
      const commit = (await git(["rev-parse", "FETCH_HEAD"])).stdout.trim();
      const size = await git(["cat-file", "-s", `FETCH_HEAD:${input.path}`]);
      if (size.code !== 0) {
        return {
          ok: false,
          missing: true,
          message: `There is no ${input.path} in the repository at ${shortRef(ref, commit)}.`,
        };
      }
      if (Number(size.stdout.trim()) > MAX_FILE_BYTES) {
        return { ok: false, missing: false, message: `${input.path} is bigger than 256 KB.` };
      }
      const shown = await git(["cat-file", "blob", `FETCH_HEAD:${input.path}`]);
      if (shown.code !== 0) {
        return { ok: false, missing: false, message: `Could not read ${input.path}.` };
      }
      return { ok: true, text: shown.stdout, commit };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** The repository's default branch, such as main; null when it cannot be read. */
  async defaultBranch(repo: string, token: string | null): Promise<string | null> {
    const dir = await mkdtemp(join(tmpdir(), "zelyq-repo-file-"));
    try {
      const listed = await this.git(dir, ["ls-remote", "--symref", repo, "HEAD"], token);
      const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(listed.stdout);
      return listed.code === 0 && match?.[1] ? match[1] : null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private git(
    cwd: string,
    args: string[],
    token: string | null,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: cwd,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ALLOW_PROTOCOL: this.protocols,
    };
    if (token) {
      env.GIT_CONFIG_COUNT = "1";
      env.GIT_CONFIG_KEY_0 = "http.extraHeader";
      env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    }
    return new Promise((resolve) => {
      execFile(
        "git",
        args,
        { cwd, env, timeout: this.timeoutMs, maxBuffer: MAX_FILE_BYTES * 2 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }
}

/** A branch, tag or commit git cannot take for an option or a path trick. */
function safeRef(ref: string): boolean {
  return /^[A-Za-z0-9._/-]{1,200}$/.test(ref) && !ref.startsWith("-") && !ref.includes("..");
}

function shortRef(ref: string, commit: string): string {
  return ref === "HEAD"
    ? `the default branch (${commit.slice(0, 7)})`
    : /^[0-9a-f]{40,64}$/i.test(ref)
      ? ref.slice(0, 7)
      : ref;
}

/** git's complaint, in words a person can act on; never git's own text, which can be long. */
function fetchProblem(
  stderr: string,
  repo: string,
  ref: string,
): { missing: boolean; message: string } {
  if (/couldn't find remote ref|not our ref|no such remote ref|unadvertised object/i.test(stderr)) {
    return { missing: true, message: `There is no branch, tag or commit ${ref} in ${repo}.` };
  }
  if (
    /authentication|could not read username|403|401|not found|repository .* not found/i.test(stderr)
  ) {
    return {
      missing: false,
      message: `Could not read ${repo}. Check its address, and for a private repository the token in source: token:.`,
    };
  }
  return {
    missing: false,
    message: `Could not fetch ${repo}${ref === "HEAD" ? "" : ` at ${ref}`}.`,
  };
}
