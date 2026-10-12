import {
  APPROVERS,
  CONCURRENCY_MODES,
  PIPELINE_CONDITIONS,
  PIPELINE_SHELLS,
  STEP_KINDS,
} from "@zelyq/core";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

/**
 * What the YAML editor knows about a pipeline file: every key, where it may
 * go, what it does, and what values it takes. Pure functions over text, so the
 * editor's suggestions, hover help and quick fixes are tested without a
 * browser. The rules themselves stay in @zelyq/core; this only describes them.
 */

export interface KeyDoc {
  key: string;
  /** One line: what it is. Shown beside the suggestion and on hover. */
  doc: string;
  /** What it looks like written out, shown on hover. */
  example?: string;
  /** What is inserted. `${}` marks where the cursor goes; `\t` is one indent. */
  snippet?: string;
  /** Values to suggest after the colon. */
  values?: ValueSource;
  required?: boolean;
}

/** Fixed words, or something of the team's looked up when suggesting. */
export type ValueSource =
  | readonly string[]
  | "boolean"
  | "vault"
  | "runner"
  | "app"
  | "pipeline"
  | "environment"
  | "plugin"
  | "setup";

const BOOLEAN = "boolean" as const;

const ROOT: KeyDoc[] = [
  { key: "name", doc: "The pipeline's name, shown in the list.", required: true },
  {
    key: "runs-on",
    doc: "Where it runs: local (the Zelyq server), a runner's name, or labels a runner must have.",
    example: "runs-on: build-01\nruns-on: [linux, docker]",
    values: "runner",
    required: true,
  },
  {
    key: "source",
    doc: "What checkout: true fetches: one of the team's apps, or a Git repository.",
    example: "source:\n  app: My app",
    snippet: "source:\n\tapp: ${}",
  },
  {
    key: "env",
    doc: "Variables for every step. A value may be vault://NAME; it is hidden in the log.",
    example: "env:\n  API_KEY: vault://API_KEY",
    snippet: "env:\n\t${NAME}: ${}",
  },
  {
    key: "timeout",
    doc: "How long the whole run may take before it is stopped. Default 1h.",
    example: "timeout: 30m",
    values: ["10m", "30m", "1h", "2h"],
  },
  {
    key: "stages",
    doc: "Stages run in order; the steps inside a stage run one after another.",
    snippet: "stages:\n\t- name: ${Build}\n\t\tsteps:\n\t\t\t- run: ${}",
    required: true,
  },
  {
    key: "artifacts",
    doc: "Files kept for download after the run.",
    example: "artifacts:\n  - name: site\n    path: dist",
    snippet: "artifacts:\n\t- name: ${site}\n\t\tpath: ${dist}",
  },
  {
    key: "notify",
    doc: "Tell Slack, Discord or any address how a run ended.",
    example: "notify:\n  webhook: vault://SLACK_WEBHOOK\n  on: [failed, waiting]",
    snippet: "notify:\n\twebhook: vault://${}\n\ton: [failed]",
  },
  {
    key: "inputs",
    doc: "Values asked for by Run now; used as ${{ inputs.NAME }}. No default means required.",
    example: "inputs:\n  environment: {choices: [staging, production], default: staging}",
    snippet: "inputs:\n\t${environment}:\n\t\tdefault: ${}",
  },
  {
    key: "services",
    doc: "Containers started beside the run and removed when it ends (Docker, Linux or macOS).",
    example: "services:\n  postgres: {image: postgres:16, port: 5432}",
    snippet: "services:\n\t${postgres}:\n\t\timage: ${postgres:16}\n\t\tport: ${5432}",
  },
  {
    key: "concurrency",
    doc: "When a run starts while another is going: wait for it, or cancel it.",
    values: CONCURRENCY_MODES,
  },
  {
    key: "keep",
    doc: "How many runs, and how long their artifacts, are kept.",
    example: "keep: {runs: 50, artifacts: 14d}",
    snippet: "keep:\n\truns: ${50}\n\tartifacts: ${14d}",
  },
];

const SOURCE: KeyDoc[] = [
  { key: "app", doc: "One of this team's apps, by name or id.", values: "app" },
  {
    key: "repo",
    doc: "A Git repository's https:// address.",
    example: "repo: https://github.com/you/app",
  },
  { key: "ref", doc: "The branch, tag or commit to check out.", example: "ref: main" },
  { key: "token", doc: "For a private repository; must come from Vault.", values: "vault" },
  {
    key: "report-status",
    doc: "Put ✓ / ✗ on the commit and the pull request on GitHub or GitLab.",
    values: BOOLEAN,
  },
];

const CONDITION_DOC = "When it runs: success() (default), failure() or always().";

const STAGE: KeyDoc[] = [
  { key: "name", doc: "The stage's name, shown on the run.", required: true },
  { key: "if", doc: CONDITION_DOC, values: PIPELINE_CONDITIONS },
  {
    key: "runs-on",
    doc: "A machine of its own for this stage. It starts in an empty folder: check out again.",
    values: "runner",
  },
  {
    key: "parallel",
    doc: "Run at the same time as the stage above it.",
    values: BOOLEAN,
  },
  {
    key: "matrix",
    doc: "One copy of the stage per value, all at the same time; used as ${{ matrix.NAME }}.",
    example: "matrix: {node: [20, 22]}",
    snippet: "matrix:\n\t${node}: [${20, 22}]",
  },
  {
    key: "steps",
    doc: "What the stage does, one step after another.",
    snippet: "steps:\n\t- run: ${}",
    required: true,
  },
  {
    key: "uses",
    doc: "Copy another pipeline's stages in, by its name: a template.",
    values: "pipeline",
  },
  { key: "with", doc: "The template's inputs.", example: 'with: {node: "22"}' },
];

const STEP: KeyDoc[] = [
  {
    key: "run",
    doc: "A shell command, or several lines of them.",
    example: "run: npm ci && npm test",
  },
  { key: "checkout", doc: "Fetch the source: into the run's folder.", values: ["true"] },
  {
    key: "setup",
    doc: "Put a language on the machine: node, python, java or go, at a version.",
    example: "setup: node@22",
    values: "setup",
  },
  {
    key: "cache",
    doc: "Keep a folder between runs, like node_modules or ~/.m2.",
    example: "cache: node_modules\ncache: {path: build/deps, key: deps.lock}",
    values: ["node_modules", ".venv", "~/.m2", "~/.cache/pip"],
  },
  {
    key: "docker",
    doc: "Build an image, and push it if asked. Needs a runner with Docker.",
    snippet:
      "docker:\n\timage: ${registry.example.com/team/app}\n\ttags: [latest]\n\tpush: ${true}",
  },
  {
    key: "approval",
    doc: "Wait for a person to approve before going on.",
    example: "approval: Deploy to production?",
  },
  {
    key: "deploy",
    doc: "Put the app on an environment in Deployments.",
    snippet: "deploy:\n\tto: ${production}\n\tport: ${3000}",
  },
  {
    key: "pipeline",
    doc: "Start another pipeline of the team; waits for it by default.",
    snippet: "pipeline:\n\trun: ${}",
  },
  {
    key: "download",
    doc: "Files a run that started this one kept.",
    snippet: "download:\n\tartifact: ${dist}",
  },
  {
    key: "plugin",
    doc: "An installed plugin, at an exact version: publisher/name@1.2.0.",
    values: "plugin",
  },
  { key: "with", doc: "A plugin's inputs.", snippet: "with:\n\t${}" },
  { key: "name", doc: "What the step is called on the run; the command when left out." },
  {
    key: "id",
    doc: "For ${{ steps.ID.outputs.NAME }} in later steps. Lower-case letters, digits, '_' or '-'.",
  },
  {
    key: "if",
    doc: CONDITION_DOC,
    values: PIPELINE_CONDITIONS,
  },
  {
    key: "retry",
    doc: "Try a failed step again, up to 5 times. For run, checkout, setup and docker.",
    values: ["1", "2", "3"],
  },
  {
    key: "shell",
    doc: "What runs the command. Default bash; pwsh on Windows.",
    values: PIPELINE_SHELLS,
  },
  { key: "timeout", doc: "How long the step may take.", values: ["5m", "10m", "30m"] },
  { key: "continue-on-error", doc: "Go on with the run when this step fails.", values: BOOLEAN },
  { key: "working-directory", doc: "Run in this folder, inside the run's folder." },
  {
    key: "env",
    doc: "Variables for this step. A value may be vault://NAME.",
    snippet: "env:\n\t${NAME}: ${}",
  },
  {
    key: "tests",
    doc: "JUnit XML files the step writes: passed and failed tests on the run.",
    example: "tests: reports/*.xml",
  },
];

const SETUP: KeyDoc[] = [
  { key: "tool", doc: "node, python, java or go.", values: ["node", "python", "java", "go"] },
  { key: "version", doc: "22, 22.11, 22.11.0 or lts (Node only)." },
];

const CACHE: KeyDoc[] = [
  { key: "path", doc: "The folder kept between runs.", required: true },
  { key: "key", doc: "Files whose change starts a fresh cache, like package-lock.json." },
];

const DOCKER: KeyDoc[] = [
  { key: "image", doc: "The image's name without a tag.", required: true },
  {
    key: "tags",
    doc: "Tags to give it. Default latest.",
    example: 'tags: [latest, "$ZELYQ_RUN_NUMBER"]',
  },
  { key: "file", doc: "The Dockerfile, when not ./Dockerfile." },
  { key: "context", doc: "The folder sent to the build. Default the run's folder." },
  { key: "build-args", doc: "Build arguments. Never a Vault secret: they end up in the image." },
  { key: "push", doc: "Push the image after building.", values: BOOLEAN },
  {
    key: "login",
    doc: "Sign in to the registry before pushing.",
    snippet: "login:\n\tusername: ${}\n\tpassword: vault://${}",
  },
];

const DOCKER_LOGIN: KeyDoc[] = [
  { key: "registry", doc: "The registry's host. Default the image's." },
  { key: "username", doc: "Who signs in.", required: true },
  { key: "password", doc: "Must come from Vault.", values: "vault", required: true },
];

const APPROVAL: KeyDoc[] = [
  { key: "message", doc: "What is being approved.", required: true },
  { key: "approvers", doc: "Who may approve: admins (default) or editors.", values: APPROVERS },
  {
    key: "timeout",
    doc: "How long to wait. Default 24h, at most 7d.",
    values: ["1h", "4h", "24h", "7d"],
  },
  { key: "allow-self", doc: "Whether whoever started the run may approve it.", values: BOOLEAN },
];

const DEPLOY: KeyDoc[] = [
  { key: "to", doc: "An environment in Deployments.", values: "environment", required: true },
  { key: "port", doc: "The app's port inside its container.", required: true },
  { key: "app", doc: "The app's name on the environment. Default the pipeline's app." },
  { key: "host-port", doc: "The port on the machine. Default the same as port." },
  { key: "health", doc: "A path checked after starting. Default /.", values: ["/", "/health"] },
  { key: "health-timeout", doc: "How long the health check may take." },
  { key: "url", doc: "Where the app is reached, shown on the run." },
  { key: "domain", doc: "The app's own name on an environment with a domain." },
  { key: "start", doc: "How the app starts when it has no Dockerfile: node server.js." },
];

const PIPELINE_STEP: KeyDoc[] = [
  { key: "run", doc: "The pipeline to start, by name.", values: "pipeline", required: true },
  { key: "wait", doc: "Wait for it to end. Default true.", values: BOOLEAN },
  { key: "with", doc: "Its inputs." },
];

const DOWNLOAD: KeyDoc[] = [
  { key: "artifact", doc: "The artifact's name.", required: true },
  { key: "from", doc: "Which run kept it. Default upstream: the run that started this one." },
  { key: "path", doc: "Where to put the files." },
];

const ARTIFACT: KeyDoc[] = [
  { key: "name", doc: "What it is called on the run.", required: true },
  { key: "path", doc: "The file or folder kept, inside the run's folder.", required: true },
];

const NOTIFY: KeyDoc[] = [
  {
    key: "webhook",
    doc: "The address to tell; must come from Vault.",
    values: "vault",
    required: true,
  },
  {
    key: "on",
    doc: "Which endings to tell about. Default all of them.",
    values: ["passed", "failed", "cancelled", "timed_out", "waiting"],
  },
];

const INPUT: KeyDoc[] = [
  { key: "description", doc: "Shown beside the field in Run now." },
  { key: "choices", doc: "The values it may take.", example: "choices: [staging, production]" },
  { key: "default", doc: "Used when nobody changes it. No default means it is required." },
];

const SERVICE: KeyDoc[] = [
  { key: "image", doc: "The container image.", required: true },
  { key: "port", doc: "Its port; reached as ${{ services.NAME.port }}.", required: true },
  { key: "env", doc: "Its variables." },
];

const KEEP: KeyDoc[] = [
  { key: "runs", doc: "How many runs are kept." },
  { key: "artifacts", doc: "How long artifacts are kept, like 14d." },
];

/**
 * Where each list of keys belongs. `-` is an item of a list; `*` is a name the
 * file chooses itself (an input, a service).
 */
const CONTEXTS: Record<string, KeyDoc[]> = {
  "": ROOT,
  source: SOURCE,
  "stages.-": STAGE,
  "stages.-.steps.-": STEP,
  "stages.-.steps.-.setup": SETUP,
  "stages.-.steps.-.cache": CACHE,
  "stages.-.steps.-.docker": DOCKER,
  "stages.-.steps.-.docker.login": DOCKER_LOGIN,
  "stages.-.steps.-.approval": APPROVAL,
  "stages.-.steps.-.deploy": DEPLOY,
  "stages.-.steps.-.pipeline": PIPELINE_STEP,
  "stages.-.steps.-.download": DOWNLOAD,
  artifacts: [],
  "artifacts.-": ARTIFACT,
  notify: NOTIFY,
  "inputs.*": INPUT,
  "services.*": SERVICE,
  keep: KEEP,
};

/** Keys whose children are names of the file's own choosing. */
const OPEN_MAPS = new Set(["inputs", "services", "env", "matrix", "with", "build-args"]);

/** A path in the file as the catalogue sees it: list indexes become `-`, chosen names `*`. */
export function contextKey(path: readonly (string | number)[]): string {
  const out: string[] = [];
  for (const [index, part] of path.entries()) {
    const parent = index > 0 ? path[index - 1] : undefined;
    if (typeof part === "number" || part === "-") out.push("-");
    else if (typeof parent === "string" && OPEN_MAPS.has(parent)) out.push("*");
    else out.push(part);
  }
  return out.join(".");
}

/** The keys that may be written at a place in the file, or null when it is the file's own names. */
export function keysAt(path: readonly (string | number)[]): KeyDoc[] | null {
  return CONTEXTS[contextKey(path)] ?? null;
}

/** What a key at a place in the file means. */
export function keyDoc(path: readonly (string | number)[], key: string): KeyDoc | null {
  return keysAt(path)?.find((entry) => entry.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Where the cursor is
// ---------------------------------------------------------------------------

export interface CursorContext {
  /** The keys and list items above the cursor; list items are `-`. */
  path: string[];
  /** The column each part of `path` is written at. */
  columns: number[];
  /** Writing a key, or a key's value. */
  mode: "key" | "value";
  /** For a value: whose. */
  key: string | null;
  /** What is typed so far of the word under the cursor. */
  prefix: string;
  /** Where that word starts in the text. */
  from: number;
  /** The column a new key on this line starts at. */
  column: number;
  /** The line holds only `- ` so far: a new list item. */
  listItem: boolean;
}

interface Frame {
  column: number;
  segment: string;
  /** A key with nothing after its colon: its value is the block below it. */
  block: boolean;
  item: boolean;
}

const KEY = /^((?:"[^"]*"|'[^']*'|[^\s:#"'{[\]}][^:#]*?)):(?:\s+|$)/;

function unquote(key: string): string {
  return /^(["']).*\1$/.test(key) ? key.slice(1, -1) : key.trim();
}

/**
 * Reads the block structure above the cursor by indentation. It works on a
 * file that is half written and not yet valid YAML, which is when suggestions
 * are wanted most; flow collections ({a: 1}) are read as plain values.
 */
export function cursorContext(text: string, pos: number): CursorContext {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const stack: Frame[] = [];
  let blockScalar: number | null = null;

  const consume = (line: string, partial: boolean) => {
    const indent = line.length - line.trimStart().length;
    const body = line.slice(indent);
    if (!partial) {
      if (body === "" || body.startsWith("#")) return null;
      if (blockScalar !== null) {
        if (indent > blockScalar) return null;
        blockScalar = null;
      }
    }
    const dash = /^-(\s+|$)/.test(body);
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as Frame;
      const keep = top.column < indent || (top.column === indent && dash && top.block && !top.item);
      if (keep) break;
      stack.pop();
    }
    let at = indent;
    let rest = body;
    let listItem = false;
    for (;;) {
      const marker = /^-(\s+|$)/.exec(rest);
      if (!marker) break;
      stack.push({ column: at, segment: "-", block: true, item: true });
      at += marker[0].length;
      rest = rest.slice(marker[0].length);
      listItem = rest === "";
    }
    return { at, rest, listItem };
  };

  // Every complete line above the cursor.
  let start = 0;
  while (start < lineStart) {
    const end = text.indexOf("\n", start);
    const line = text.slice(start, end === -1 || end > lineStart ? lineStart : end);
    const read = consume(line, false);
    if (read) {
      const match = KEY.exec(read.rest);
      if (match) {
        const value = read.rest.slice(match[0].length).replace(/\s+#.*$/, "");
        const key = unquote(match[1] ?? "");
        const block = value.trim() === "";
        stack.push({ column: read.at, segment: key, block, item: false });
        if (/^[|>][-+0-9]*\s*$/.test(value.trim())) blockScalar = read.at;
      }
    }
    start = end === -1 ? lineStart : end + 1;
  }

  // The cursor's own line, up to the cursor.
  const before = text.slice(lineStart, pos);
  if (blockScalar !== null) {
    const indent = before.length - before.trimStart().length;
    if (before.trim() === "" || indent > blockScalar) {
      return {
        path: stack.map((frame) => frame.segment),
        columns: stack.map((frame) => frame.column),
        mode: "value",
        key: stack[stack.length - 1]?.segment ?? null,
        prefix: "",
        from: pos,
        column: indent,
        listItem: false,
      };
    }
  }
  const read = consume(before, true) ?? { at: 0, rest: before, listItem: false };
  const match = KEY.exec(read.rest);
  const word = /[^\s:,[\]{}]*$/.exec(before)?.[0] ?? "";
  if (match) {
    const key = unquote(match[1] ?? "");
    return {
      path: stack.map((frame) => frame.segment),
      columns: stack.map((frame) => frame.column),
      mode: "value",
      key,
      prefix: word,
      from: pos - word.length,
      column: read.at,
      listItem: false,
    };
  }
  return {
    path: stack.map((frame) => frame.segment),
    columns: stack.map((frame) => frame.column),
    mode: "key",
    key: null,
    prefix: read.rest,
    from: pos - read.rest.length,
    column: read.at,
    listItem: read.listItem || /^-\s*$/.test(before.trim()),
  };
}

/**
 * The key a position in the text is on, with the path of the map it is in:
 * what hover help explains. Null when the position is not on a key.
 */
export function keyAt(
  text: string,
  pos: number,
): { path: string[]; key: string; from: number; to: number } | null {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const lineEnd = text.indexOf("\n", pos);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const head = /^(\s*(?:-\s+)*)/.exec(line)?.[0] ?? "";
  const match = KEY.exec(line.slice(head.length));
  if (!match) return null;
  const keyText = match[1] ?? "";
  const from = lineStart + head.length;
  const to = from + keyText.length;
  if (pos < from || pos > to) return null;
  const context = cursorContext(text, to + 1);
  return { path: context.path, key: unquote(keyText), from, to };
}

/**
 * The keys already written in the map the cursor is in, and their values when
 * on one line: so a suggestion does not offer `name` twice, and a plugin
 * step's `with:` knows which plugin it is for.
 */
export function siblings(text: string, pos: number, column: number): Map<string, string> {
  const found = new Map<string, string>();
  const lines = text.split("\n");
  const cursorLine = text.slice(0, pos).split("\n").length - 1;
  const read = (index: number): "stop" | "skip" | "next" => {
    const line = lines[index] ?? "";
    const body = line.trimStart();
    if (body === "" || body.startsWith("#")) return "skip";
    const indent = line.length - body.length;
    const head = /^(-\s+)+/.exec(body)?.[0] ?? "";
    const keyColumn = indent + head.length;
    if (head && keyColumn === column) {
      // The list item this map starts at: its first key, and nothing above it.
      const match = KEY.exec(body.slice(head.length));
      if (match)
        found.set(unquote(match[1] ?? ""), body.slice(head.length + match[0].length).trim());
      return "stop";
    }
    if (indent < column) return "stop";
    if (indent === column) {
      const match = KEY.exec(body);
      if (match) found.set(unquote(match[1] ?? ""), body.slice(match[0].length).trim());
    }
    return "next";
  };
  for (let index = cursorLine - 1; index >= 0; index--) {
    if (read(index) === "stop") break;
  }
  for (let index = cursorLine + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const body = line.trimStart();
    if (body === "" || body.startsWith("#")) continue;
    const indent = line.length - body.length;
    if (indent < column || (indent === column && body.startsWith("-"))) break;
    if (/^(-\s+)+/.test(body) && indent + (/^(-\s+)+/.exec(body)?.[0].length ?? 0) === column)
      break;
    if (read(index) === "stop") break;
  }
  return found;
}

/**
 * The file laid out the house way: two spaces, lists under their key, short
 * maps on one line as written. Comments and key order stay. Null when the
 * text is not valid YAML, which formatting must never make worse.
 */
export function formatYaml(text: string): string | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return null;
  return doc.toString({ indent: 2, lineWidth: 0, flowCollectionPadding: false });
}

// ---------------------------------------------------------------------------
// What the file itself names, for ${{ … }}
// ---------------------------------------------------------------------------

export interface FileNames {
  inputs: string[];
  /** Step ids, with the plugin each one uses when it is a plugin step. */
  steps: { id: string; plugin: string | null }[];
  matrix: string[];
  services: string[];
}

/** The names a file declares, read leniently: a file mid-edit still gives what it can. */
export function fileNames(text: string): FileNames {
  const names: FileNames = { inputs: [], steps: [], matrix: [], services: [] };
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(text);
  } catch {
    return names;
  }
  const keys = (node: unknown): string[] =>
    isMap(node) ? node.items.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : "")) : [];
  names.inputs = keys(doc.get("inputs", true)).filter(Boolean);
  names.services = keys(doc.get("services", true)).filter(Boolean);
  const stages = doc.get("stages", true);
  if (isSeq(stages)) {
    for (const stage of stages.items) {
      if (!isMap(stage)) continue;
      for (const name of keys(stage.get("matrix", true))) {
        if (name && !names.matrix.includes(name)) names.matrix.push(name);
      }
      const steps = stage.get("steps", true);
      if (!isSeq(steps)) continue;
      for (const step of steps.items) {
        if (!isMap(step)) continue;
        const id = step.get("id");
        if (typeof id === "string" && id) {
          const plugin = step.get("plugin");
          names.steps.push({ id, plugin: typeof plugin === "string" ? plugin : null });
        }
      }
    }
  }
  return names;
}

/** What may follow `${{ ` given the file's names, with how far back to replace. */
export function expressionOptions(
  typed: string,
  names: FileNames,
  pluginOutputs: (plugin: string) => string[] = () => [],
): string[] {
  const parts = typed.split(".");
  const head = parts[0] ?? "";
  if (parts.length === 1) return ["inputs", "steps", "matrix", "services"];
  if (head === "inputs" && parts.length === 2) return names.inputs;
  if (head === "matrix" && parts.length === 2) return names.matrix;
  if (head === "services") {
    if (parts.length === 2) return names.services;
    if (parts.length === 3) return ["host", "port"];
  }
  if (head === "steps") {
    if (parts.length === 2) return names.steps.map((step) => step.id);
    if (parts.length === 3) return ["outputs"];
    if (parts.length === 4) {
      const step = names.steps.find((entry) => entry.id === parts[1]);
      return step?.plugin ? pluginOutputs(step.plugin) : [];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Quick fixes and placing the server's warnings
// ---------------------------------------------------------------------------

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[b.length] as number;
}

/** The known word a misspelt one was probably meant to be. */
export function closest(word: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const lower = word.toLowerCase();
  for (const candidate of known) {
    const score = distance(lower, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  const allowed = Math.max(1, Math.floor(word.length / 3));
  return best !== null && bestScore <= allowed && best !== word ? best : null;
}

/** For an unknown key at `path` ("stages.0.steps.1.shel"), the key it was probably meant to be. */
export function suggestKey(path: string): string | null {
  const parts = path.split(".");
  const key = parts.pop();
  if (!key) return null;
  const at = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const known = keysAt(at);
  return known
    ? closest(
        key,
        known.map((entry) => entry.key),
      )
    : null;
}

/** The step kinds, in the order the visual editor offers them. */
export const STEP_KEYS: readonly string[] = STEP_KINDS;

/**
 * Where in the text a warning from the server is about, when it names
 * something written there: a Vault secret, a runner, an app, a plugin.
 */
export function locateWarning(text: string, warning: string): { from: number; to: number } | null {
  const find = (needle: string) => {
    const at = text.indexOf(needle);
    return at === -1 ? null : { from: at, to: at + needle.length };
  };
  const vault = /^([A-Za-z][A-Za-z0-9_.-]*) is not in the team's Vault/.exec(warning);
  if (vault) return find(`vault://${vault[1]}`);
  const plugin = /([a-z0-9-]+\/[a-z0-9-]+@[\w.-]+)/.exec(warning);
  if (plugin?.[1]) return find(plugin[1]);
  const named = /called ([^;.]+?)(?: in this team| yet|;|\.|$)/.exec(warning);
  if (named?.[1]) {
    const name = named[1].trim();
    const pattern = new RegExp(
      `(?:^|[\\s:\\[,"'])(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[\\s,\\]"'#])`,
      "m",
    );
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) {
      const from = match.index + match[0].length - match[1].length;
      return { from, to: from + match[1].length };
    }
  }
  return null;
}
