import type { PipelineShell, RunnerOs } from "@zelyq/core";

/**
 * How a step reaches a shell, on every operating system.
 *
 * The command a runner is given is fixed and holds no secret: it reads the
 * whole script from stdin, then runs it. The script — the step's commands with
 * its variables set first — never appears on a command line (so never in the
 * machine's process list) and never in a file. Reading all of stdin *before*
 * running also means a command inside the step that reads input (npm, ssh,
 * `read`) gets end-of-input instead of swallowing the rest of the script.
 */

export function defaultShell(os: RunnerOs): PipelineShell {
  return os === "windows" ? "pwsh" : "bash";
}

/** Whether a shell runs the POSIX family of scripts. */
export function isPosix(shell: PipelineShell): boolean {
  return shell === "bash" || shell === "sh" || shell === "zsh";
}

/** The fixed command that reads a script from stdin and runs it. */
export function shellCommand(shell: PipelineShell): string {
  switch (shell) {
    case "bash":
      return `bash --noprofile --norc -c 'eval "$(cat)"'`;
    case "zsh":
      return `zsh -f -c 'eval "$(cat)"'`;
    case "sh":
      return `sh -c 'eval "$(cat)"'`;
    case "pwsh":
    case "powershell":
      // Quoted for cmd.exe, which is the default shell of Windows OpenSSH.
      return `${shell} -NoProfile -NonInteractive -OutputFormat Text -Command "& ([scriptblock]::Create([Console]::In.ReadToEnd()))"`;
  }
}

function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface StepScriptInput {
  shell: PipelineShell;
  /** Absolute path of the run's folder on the machine. */
  workspace: string;
  /** Relative to the workspace, already validated not to escape it. */
  workingDirectory?: string;
  env: Record<string, string>;
  /** Folders put in front of PATH, in order (from setup steps). */
  path?: string[];
  /** The step's own commands. */
  commands: string;
}

/**
 * The full script for a step. It records the step's process group (POSIX) or
 * process id (Windows) in the workspace, so a timeout or Cancel can stop the
 * whole tree from a second connection, and it fails on the first failing
 * command, the way CI shells do.
 */
export function stepScript(input: StepScriptInput): string {
  const dir = input.workingDirectory
    ? `${input.workspace}${isPosix(input.shell) ? "/" : "\\"}${input.workingDirectory.replaceAll("\\", "/")}`
    : input.workspace;
  if (isPosix(input.shell)) {
    const strict = input.shell === "sh" ? "set -e" : "set -eo pipefail";
    return [
      "export TERM=dumb NO_COLOR=1 CI=true",
      ...Object.entries(input.env).map(([name, value]) => `export ${name}=${posixQuote(value)}`),
      ...(input.path?.length ? [`export PATH=${posixQuote(input.path.join(":"))}:"$PATH"`] : []),
      // Strict before cd: a step whose folder is missing fails, rather than
      // running somewhere else.
      strict,
      `cd -- ${posixQuote(dir)}`,
      // busybox ps (Alpine) has no -p; Linux always has /proc.
      `{ ps -o pgid= -p $$ 2>/dev/null || cut -d' ' -f5 /proc/$$/stat; } | tr -d ' ' > ${posixQuote(`${input.workspace}/.zelyq-step`)}`,
      input.commands,
      "",
    ].join("\n");
  }
  return [
    "$ErrorActionPreference = 'Stop'",
    // PowerShell 7.3+: a program that fails (npm test exiting 1) stops the
    // step, as `set -e` does in bash. Older PowerShell ignores this line, and
    // the check at the end still reports the last failing exit code.
    "$PSNativeCommandUseErrorActionPreference = $true",
    "$ProgressPreference = 'SilentlyContinue'",
    "$env:TERM = 'dumb'; $env:NO_COLOR = '1'; $env:CI = 'true'",
    ...Object.entries(input.env).map(([name, value]) => `$env:${name} = ${psQuote(value)}`),
    ...(input.path?.length
      ? [`$env:PATH = ${psQuote(`${input.path.join(";")};`)} + $env:PATH`]
      : []),
    `Set-Location -LiteralPath ${psQuote(dir.replaceAll("/", "\\"))}`,
    `Set-Content -LiteralPath ${psQuote(`${input.workspace}\\.zelyq-step`)} -Value $PID`,
    "try {",
    input.commands,
    "} catch {",
    // Keep the program's own exit code rather than PowerShell's generic 1.
    "  if ((Test-Path -LiteralPath variable:\\LASTEXITCODE) -and $LASTEXITCODE -ne 0) { [Console]::Error.WriteLine($_.ToString()); exit $LASTEXITCODE }",
    "  throw",
    "}",
    "if ((Test-Path -LiteralPath variable:\\LASTEXITCODE) -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "",
  ].join("\r\n");
}

/** Stops a step's whole process tree, from a separate connection. */
export function stopCommand(os: RunnerOs, workspace: string, force: boolean): string {
  if (os === "windows") {
    const file = `${workspace}\\.zelyq-step`;
    return `powershell -NoProfile -NonInteractive -Command "$p = Get-Content -LiteralPath ${psQuote(file)} -ErrorAction SilentlyContinue; if ($p) { taskkill /PID $p /T /F | Out-Null }"`;
  }
  const file = posixQuote(`${workspace}/.zelyq-step`);
  const signal = force ? "KILL" : "TERM";
  return `sh -c 'g=$(cat ${file.replaceAll("'", "'\\''")} 2>/dev/null); [ -n "$g" ] && kill -${signal} -"$g" 2>/dev/null; true'`;
}

/** The run's folder, for a run id, on that kind of machine. */
export function workspacePath(os: RunnerOs, home: string, runId: string): string {
  const short = runId.replace(/^[a-z]+_/, "").slice(0, 12);
  return os === "windows" ? `${home}\\zelyq\\r\\${short}` : `${home}/zelyq/runs/${short}`;
}

/** Makes the run's folder (and nothing else). */
export function prepareCommand(os: RunnerOs, workspace: string): string {
  return os === "windows"
    ? `powershell -NoProfile -NonInteractive -Command "New-Item -ItemType Directory -Force -Path ${psQuote(workspace)} | Out-Null"`
    : `mkdir -p -- ${posixQuote(workspace)}`;
}

/** Removes the run's folder after a run that passed. */
export function cleanupCommand(os: RunnerOs, workspace: string): string {
  return os === "windows"
    ? `powershell -NoProfile -NonInteractive -Command "Remove-Item -LiteralPath ${psQuote(workspace)} -Recurse -Force -ErrorAction SilentlyContinue"`
    : `rm -rf -- ${posixQuote(workspace)}`;
}

/** Unpacks a gzipped tar arriving on stdin into the run's folder. Windows 10+
 * ships bsdtar as tar.exe, so the same archive works everywhere. Windows
 * commands are written for cmd.exe, which Windows' SSH server already runs
 * them in (checked when the machine is probed) — wrapping them in another
 * `cmd /c` leaves a stray quote behind. */
export function unpackCommand(os: RunnerOs, workspace: string): string {
  return os === "windows"
    ? `cd /d "${workspace}" && tar -xzf -`
    : `cd -- ${posixQuote(workspace)} && tar -xzf -`;
}

/** Packs a path inside the run's folder as a gzipped tar on stdout. */
export function packCommand(os: RunnerOs, workspace: string, path: string): string {
  return os === "windows"
    ? `cd /d "${workspace}" && tar -czf - "${path.replaceAll("/", "\\")}"`
    : `cd -- ${posixQuote(workspace)} && tar -czf - -- ${posixQuote(path)}`;
}

/**
 * The commands that check out a git repository into the current folder. The
 * token reaches git through `GIT_CONFIG_*` environment variables (git 2.31+),
 * not through the URL or an argument, so it is never in a command line or in
 * the logged clone command.
 */
export function checkoutCommands(input: {
  shell: PipelineShell;
  repo: string;
  ref: string | null;
}): { commands: string; env: (token: string | null) => Record<string, string> } {
  const env = (token: string | null): Record<string, string> =>
    token
      ? {
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.extraHeader",
          GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
        }
      : { GIT_TERMINAL_PROMPT: "0" };
  const posix = isPosix(input.shell);
  const quote = posix ? posixQuote : psQuote;
  const repo = quote(input.repo);
  const lines = input.ref
    ? [
        "git init -q .",
        `git remote add origin ${repo}`,
        `git fetch -q --depth 1 origin ${quote(input.ref)}`,
        "git checkout -q FETCH_HEAD",
      ]
    : [`git clone -q --depth 1 ${repo} .`];
  return { commands: lines.join(posix ? "\n" : "\r\n"), env };
}
