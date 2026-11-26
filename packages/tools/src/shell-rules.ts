/**
 * Which shell commands run_command refuses, judged on the command actually
 * being run rather than on words anywhere in the line.
 *
 * The rules used to be regular expressions over the whole string, and failed
 * both ways. They refused `cat vite.config.ts`, `grep vite` and
 * `npm install vite@latest` (the word "vite" looked like a dev server), and
 * let through `rm -rf ./*`, `find .git -delete` and `git -C . reset --hard`.
 * Of 1,060 recorded commands, all 6 refusals were false.
 *
 * This splits a line into its simple commands (`a && b | c; d`), reads each
 * one's program and arguments, and decides on those. It is a guard against
 * mistakes, not a security boundary — that is the container and its egress
 * rules — so it reads quotes and separators well enough for that and no more.
 */

export interface ShellRefusal {
  kind: "blocking" | "destructive";
  reason: string;
}

/** The simple commands in a line, each as its words. */
export function simpleCommands(line: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;

  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      continue;
    }
    if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      continue;
    }
    // Separators: ; & | newline, and the brackets of a subshell or $( ).
    if (c === ";" || c === "&" || c === "|" || c === "\n" || c === "(" || c === ")") {
      if (c === "(" && word === "$") {
        word = "";
        inWord = false;
      }
      endCommand();
      continue;
    }
    word += c;
    inWord = true;
  }
  endCommand();
  return commands;
}

/** Wrappers that run the command after them, and how many arguments they take first. */
const WRAPPERS: Record<string, number> = {
  sudo: 0,
  env: 0,
  command: 0,
  exec: 0,
  nohup: 0,
  time: 0,
  nice: 0,
  timeout: 1,
};

/** The program and its arguments, past env assignments and wrappers. */
function program(words: string[]): string[] {
  let rest = words;
  for (;;) {
    const first = rest[0];
    if (first === undefined) return rest;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      rest = rest.slice(1);
      continue;
    }
    const skip = WRAPPERS[first];
    if (skip !== undefined) {
      rest = rest.slice(1);
      while (rest[0]?.startsWith("-")) rest = rest.slice(1);
      rest = rest.slice(skip);
      continue;
    }
    return rest;
  }
}

/** `npx vite …`, `pnpm exec vite …`, `yarn vite …` → `vite …`. */
function viaRunner(args: string[]): string[] | null {
  const [first, second] = args;
  if (first === "npx" || first === "bunx")
    return args.slice(1).filter((a) => a !== "--yes" && a !== "-y");
  if (
    (first === "pnpm" || first === "npm" || first === "yarn") &&
    (second === "exec" || second === "dlx")
  ) {
    return args.slice(2);
  }
  if ((first === "pnpm" || first === "yarn") && second === "vite") return args.slice(1);
  return null;
}

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const LONG_RUNNING_SCRIPTS = new Set(["dev", "start", "serve", "watch", "preview"]);
const VITE_ONE_SHOT = new Set(["build", "optimize", "--version", "-v", "--help", "-h"]);

function blocking(args: string[]): string | null {
  const name = basename(args[0] ?? "");
  const rest = args.slice(1);

  if (PACKAGE_MANAGERS.has(name)) {
    const script = rest[0] === "run" || rest[0] === "run-script" ? rest[1] : rest[0];
    if (script && LONG_RUNNING_SCRIPTS.has(script)) {
      return "Use the start_preview tool to run the dev server — it manages the process and the port.";
    }
  }
  const viteArgs = name === "vite" ? args : viaRunner(args);
  if (viteArgs && basename(viteArgs[0] ?? "") === "vite") {
    const sub = viteArgs[1];
    if (sub === undefined || !VITE_ONE_SHOT.has(sub))
      return "Use start_preview for the dev server.";
  }
  if (["uvicorn", "gunicorn", "hypercorn", "nodemon"].includes(name)) {
    return "Use start_preview to manage Python and frontend services.";
  }
  if (name === "fastapi" && (rest[0] === "dev" || rest[0] === "run")) {
    return "Use start_preview to manage Python and frontend services.";
  }
  if (name === "flask" && rest[0] === "run") return "Use start_preview to manage Python services.";
  if (/^python3?$/.test(name)) {
    if (rest[0] === "-m" && ["uvicorn", "flask", "http.server"].includes(rest[1] ?? "")) {
      return "Use start_preview to manage Python and frontend services.";
    }
    if (rest.some((a) => a.endsWith("manage.py")) && rest.includes("runserver")) {
      return "Use start_preview to manage Python services.";
    }
  }
  if (name === "tail" && rest.some((a) => /^-[a-zA-Z]*[fF]/.test(a) || a === "--follow")) {
    return "Long-running watchers never return.";
  }
  if (name === "watch") return "Long-running watchers never return.";
  return null;
}

/** Git's global options before the subcommand, and whether each takes a value. */
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

function gitSubcommand(args: string[]): { sub: string; rest: string[] } | null {
  let i = 1;
  while (i < args.length) {
    const a = args[i] as string;
    if (GIT_OPTIONS_WITH_VALUE.has(a)) i += 2;
    else if (a.startsWith("-")) i += 1;
    else return { sub: a, rest: args.slice(i + 1) };
  }
  return null;
}

const flags = (rest: string[]) => rest.filter((a) => a.startsWith("-") && !a.startsWith("--"));
const hasShortFlag = (rest: string[], letters: string) =>
  flags(rest).some((f) => [...letters].some((l) => f.slice(1).includes(l)));

/** A path that is the project itself, its repository, or outside it. */
function dangerousTarget(target: string): boolean {
  const t = target.replace(/\/+$/, "");
  if (t === "" || t === "/" || t === "~" || t === "." || t === ".." || t === "*") return true;
  if (t === "./*" || t === "./.*" || t === ".*" || t.startsWith("../")) return true;
  if (t.startsWith("/") || t.startsWith("~")) return true;
  return t === ".git" || t.startsWith(".git/") || t.endsWith("/.git") || t.includes("/.git/");
}

function destructive(args: string[]): string | null {
  const name = basename(args[0] ?? "");
  const rest = args.slice(1);

  if (name === "git") {
    const parsed = gitSubcommand(args);
    if (!parsed) return null;
    const { sub, rest: gitRest } = parsed;
    if (sub === "reset" && gitRest.includes("--hard")) {
      return "A hard reset throws away changes that no snapshot can restore.";
    }
    if (sub === "clean" && (hasShortFlag(gitRest, "fx") || gitRest.includes("--force"))) {
      return "git clean deletes untracked files permanently.";
    }
    if (
      (sub === "checkout" || sub === "restore" || sub === "switch") &&
      (gitRest.includes("--force") ||
        hasShortFlag(gitRest, "f") ||
        gitRest.includes(".") ||
        gitRest.includes(":/"))
    ) {
      return "Discarding working-tree changes cannot be undone from a snapshot.";
    }
    if (sub === "push" || (sub === "remote" && gitRest[0] === "set-url")) {
      return "Zelyq works on a copy. Pushing is the user's decision, not yours.";
    }
    if (sub === "branch" && (hasShortFlag(gitRest, "dD") || gitRest.includes("--delete"))) {
      return "Deleting a branch removes work that is not in the snapshot.";
    }
    return null;
  }

  if (name === "rm") {
    const recursive = hasShortFlag(rest, "rR") || rest.includes("--recursive");
    const targets = rest.filter((a) => !a.startsWith("-"));
    if (recursive && targets.some(dangerousTarget)) {
      return "That would delete the project, its repository, or something outside it.";
    }
    return null;
  }

  if (name === "find") {
    const deletes =
      rest.includes("-delete") ||
      rest.some(
        (a, i) => (a === "-exec" || a === "-execdir") && basename(rest[i + 1] ?? "") === "rm",
      );
    // Paths come before the first expression (-name, -delete, …).
    const firstExpression = rest.findIndex((a) => a.startsWith("-") || a === "(" || a === "!");
    const roots = firstExpression === -1 ? rest : rest.slice(0, firstExpression);
    if (deletes && (roots.some(dangerousTarget) || rest.some((a) => /(^|\/)\.git(\/|$)/.test(a)))) {
      return "That would delete the repository, or everything under it.";
    }
  }
  return null;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The first rule a command line breaks, or null when every part of it may run. */
export function refuseCommand(line: string): ShellRefusal | null {
  for (const words of simpleCommands(line)) {
    const args = program(words);
    if (args.length === 0) continue;
    const block = blocking(args);
    if (block) return { kind: "blocking", reason: block };
    const destroy = destructive(args);
    if (destroy) return { kind: "destructive", reason: destroy };
  }
  return null;
}
