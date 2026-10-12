/**
 * Deploying an app without a Dockerfile: Zelyq looks at the app's files and
 * writes one, the way Heroku's buildpacks or Railway's Nixpacks do, but as a
 * plain Dockerfile that is shown in the log and can be kept and changed.
 *
 * The machine reports which files are there (and the few small ones that say
 * how the app runs); everything here is decided from that alone.
 */

/** What the deploy machine reported about the app's folder. */
export interface AppFiles {
  /** File and folder names at the top of the app. */
  names: string[];
  /** Small files read whole: package.json, Procfile, go.mod, requirements.txt, … */
  contents: Record<string, string>;
  /** Django projects: the folders with a wsgi.py. */
  wsgi: string[];
  /** Go: the folders under cmd/ with a main package. */
  goCommands: string[];
}

/** The files read whole, when they are there. */
export const READ_FILES = [
  "package.json",
  "Procfile",
  "go.mod",
  "requirements.txt",
  "pyproject.toml",
  ".python-version",
  ".nvmrc",
  ".node-version",
] as const;

export type BuildPlan =
  | {
      ok: true;
      /** "Node (pnpm, Node 22)", "Python 3.12 (FastAPI)", … for the log. */
      kind: string;
      /** How it starts, for the log. */
      start: string;
      /** Files to write next to the app before building: the Dockerfile, and maybe a Caddyfile. */
      files: Record<string, string>;
    }
  | { ok: false; error: string };

const STATIC_CADDYFILE = ".zelyq.Caddyfile";

/**
 * The Dockerfile for an app, from its files. `port` is what the deploy step
 * says the app listens on; generated images set PORT to it, which Node,
 * Python and Go servers commonly read.
 */
export function planBuild(files: AppFiles, port: number, start: string | null): BuildPlan {
  const has = (name: string) => files.names.includes(name);
  const own = start ?? procfileWeb(files.contents.Procfile);
  if (own !== null && /[\r\n]/.test(own)) {
    return { ok: false, error: "The start command must be one line." };
  }

  if (has("package.json")) return node(files, port, own);
  if (has("requirements.txt") || has("pyproject.toml")) return python(files, port, own);
  if (has("go.mod")) return go(files, port, own);
  if (has("index.html")) return staticSite(port);
  return {
    ok: false,
    error:
      "There is no Dockerfile, and Zelyq could not tell what kind of app this is (it knows Node: package.json, Python: requirements.txt or pyproject.toml, Go: go.mod, and a static site: index.html). Add a Dockerfile, or ask the agent to add one.",
  };
}

/** The `web:` line of a Procfile, as Heroku reads it. */
function procfileWeb(text: string | undefined): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^web:\s*(.+)$/.exec(line.trim());
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/** `CMD ["sh", "-c", "…"]`: one command, read by a shell so $PORT works. */
function shellCmd(command: string): string {
  return `CMD ${JSON.stringify(["sh", "-c", command])}`;
}

/** The first whole number in a version text ("v20.11", ">=18", "22.x"), if any. */
function major(text: string | undefined): number | null {
  const match = text ? /(\d+)/.exec(text) : null;
  return match?.[1] ? Number(match[1]) : null;
}

// ------------------------------------------------------------------- Node

const NODE_VERSIONS = [18, 20, 22, 24];
const STATIC_TOOLS = [
  "vite",
  "react-scripts",
  "@angular/cli",
  "@vue/cli-service",
  "parcel",
  "astro",
];

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function node(files: AppFiles, port: number, own: string | null): BuildPlan {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(files.contents["package.json"] ?? "{}") as PackageJson;
  } catch {
    return { ok: false, error: "package.json is not valid JSON." };
  }
  const has = (name: string) => files.names.includes(name);
  const scripts = pkg.scripts ?? {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const wanted =
    major(pkg.engines?.node) ??
    major(files.contents[".nvmrc"]) ??
    major(files.contents[".node-version"]);
  const version =
    wanted && NODE_VERSIONS.includes(wanted) ? wanted : wanted && wanted > 24 ? 24 : 22;

  const manager = has("pnpm-lock.yaml")
    ? { name: "pnpm", lock: "pnpm-lock.yaml", install: "pnpm install --frozen-lockfile" }
    : has("yarn.lock")
      ? { name: "yarn", lock: "yarn.lock", install: "yarn install" }
      : has("package-lock.json")
        ? { name: "npm", lock: "package-lock.json", install: "npm ci" }
        : { name: "npm", lock: null, install: "npm install" };
  const run = (script: string) =>
    manager.name === "npm" ? `npm run ${script}` : `${manager.name} run ${script}`;
  const corepack = manager.name === "npm" ? [] : ["RUN corepack enable"];
  const install = [
    `COPY package.json ${manager.lock ? `${manager.lock} ` : ""}./`,
    `RUN ${manager.install}`,
    "COPY . .",
  ];
  const build = scripts.build ? [`RUN ${run("build")}`] : [];

  // A site that builds to files (Vite, Create React App, Angular…): served as files.
  const isStatic =
    !own &&
    !scripts.start &&
    Boolean(scripts.build) &&
    !deps.next &&
    STATIC_TOOLS.some((tool) => tool in deps);
  if (isStatic) {
    return {
      ok: true,
      kind: `Node ${version} (${manager.name}), a site built to files`,
      start: "its built files, served by Caddy",
      files: {
        Dockerfile: [
          `FROM node:${version}-alpine AS build`,
          "WORKDIR /app",
          ...corepack,
          ...install,
          ...build,
          // The build's output: dist (Vite), build (Create React App), out, or dist/<name> (Angular).
          'RUN mkdir /out && for d in dist build out dist/*/browser dist/*; do if [ -f "$d/index.html" ]; then cp -r "$d"/. /out/; break; fi; done && [ -f /out/index.html ] || { echo "The build made no index.html in dist, build or out." >&2; exit 1; }',
          "",
          "FROM caddy:2.8.4-alpine",
          "COPY --from=build /out /srv",
          `COPY ${STATIC_CADDYFILE} /etc/caddy/Caddyfile`,
          `EXPOSE ${port}`,
          "",
        ].join("\n"),
        [STATIC_CADDYFILE]: staticCaddyfile(port),
      },
    };
  }

  const start =
    own ??
    (scripts.start
      ? run("start")
      : pkg.main && has(pkg.main.split("/")[0] ?? "")
        ? `node ${pkg.main}`
        : ["server.js", "index.js", "app.js", "main.js"].find(has)
          ? `node ${["server.js", "index.js", "app.js", "main.js"].find(has)}`
          : null);
  if (!start) {
    return {
      ok: false,
      error:
        'Zelyq could not tell how to start this Node app: add a "start" script to package.json, a Procfile with a web: line, or start: on the deploy step.',
    };
  }
  return {
    ok: true,
    kind: `Node ${version} (${manager.name})${deps.next ? ", Next.js" : ""}`,
    start,
    files: {
      Dockerfile: [
        `FROM node:${version}-alpine`,
        "WORKDIR /app",
        ...corepack,
        ...install,
        ...build,
        // Production only once built: the build may need development packages.
        `ENV NODE_ENV=production PORT=${port} HOST=0.0.0.0 HOSTNAME=0.0.0.0`,
        `EXPOSE ${port}`,
        shellCmd(start),
        "",
      ].join("\n"),
    },
  };
}

// ----------------------------------------------------------------- Python

const PYTHON_VERSIONS = ["3.10", "3.11", "3.12", "3.13"];

function python(files: AppFiles, port: number, own: string | null): BuildPlan {
  const has = (name: string) => files.names.includes(name);
  const wanted = /(\d+\.\d+)/.exec(files.contents[".python-version"] ?? "")?.[1];
  const version = wanted && PYTHON_VERSIONS.includes(wanted) ? wanted : "3.12";
  const requirements = (
    (files.contents["requirements.txt"] ?? "") + (files.contents["pyproject.toml"] ?? "")
  ).toLowerCase();
  const uses = (name: string) =>
    new RegExp(`(^|[^a-z0-9_-])${name}([^a-z0-9_-]|$)`, "m").test(requirements);
  const module = ["main.py", "app.py", "server.py", "wsgi.py"].find(has)?.replace(/\.py$/, "");

  let framework = "";
  let start = own;
  if (!start && has("manage.py") && files.wsgi[0]) {
    framework = "Django";
    start = `gunicorn ${files.wsgi[0]}.wsgi --bind 0.0.0.0:$PORT`;
  } else if (!start && uses("fastapi") && module) {
    framework = "FastAPI";
    start = `uvicorn ${module}:app --host 0.0.0.0 --port $PORT`;
  } else if (!start && uses("flask") && module) {
    framework = "Flask";
    start = `gunicorn ${module}:app --bind 0.0.0.0:$PORT`;
  } else if (!start && module) {
    start = `python ${module}.py`;
  }
  if (!start) {
    return {
      ok: false,
      error:
        "Zelyq could not tell how to start this Python app: add a Procfile with a web: line (web: gunicorn app:app), or start: on the deploy step.",
    };
  }
  // The server the start command names, when the app does not list it.
  const servers = ["gunicorn", "uvicorn"].filter(
    (server) => start?.startsWith(server) && !uses(server),
  );
  const install = has("requirements.txt")
    ? ["COPY requirements.txt ./", "RUN pip install --no-cache-dir -r requirements.txt", "COPY . ."]
    : ["COPY . .", "RUN pip install --no-cache-dir ."];
  return {
    ok: true,
    kind: `Python ${version}${framework ? ` (${framework})` : ""}`,
    start,
    files: {
      Dockerfile: [
        `FROM python:${version}-slim`,
        "WORKDIR /app",
        `ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=${port}`,
        ...install,
        ...(servers.length ? [`RUN pip install --no-cache-dir ${servers.join(" ")}`] : []),
        `EXPOSE ${port}`,
        shellCmd(start),
        "",
      ].join("\n"),
    },
  };
}

// --------------------------------------------------------------------- Go

function go(files: AppFiles, port: number, own: string | null): BuildPlan {
  const directive = /^go\s+(\d+)\.(\d+)/m.exec(files.contents["go.mod"] ?? "");
  const minor = directive ? Number(directive[2]) : 23;
  // Go 1.21 and later fetch a newer toolchain themselves when go.mod asks for it.
  const version = `1.${Math.max(21, Math.min(minor, 24))}`;
  const rootMain = files.names.some((name) => name.endsWith(".go"));
  const target = rootMain
    ? "."
    : files.goCommands.length === 1
      ? `./cmd/${files.goCommands[0]}`
      : null;
  if (!target) {
    return {
      ok: false,
      error:
        files.goCommands.length > 1
          ? `There are several commands in cmd/ (${files.goCommands.join(", ")}). Add a Dockerfile that builds the one to run.`
          : "There is no main package at the top of the app or in cmd/<name>. Add a Dockerfile.",
    };
  }
  const start = own ?? "/app/server";
  return {
    ok: true,
    kind: `Go ${version}`,
    start,
    files: {
      Dockerfile: [
        `FROM golang:${version}-alpine AS build`,
        "WORKDIR /src",
        "COPY go.mod go.sum* ./",
        "RUN go mod download",
        "COPY . .",
        `RUN CGO_ENABLED=0 go build -o /out/server ${target}`,
        "",
        "FROM alpine:3.20",
        "RUN apk add --no-cache ca-certificates",
        "WORKDIR /app",
        "COPY --from=build /out/server /app/server",
        `ENV PORT=${port}`,
        `EXPOSE ${port}`,
        shellCmd(start),
        "",
      ].join("\n"),
    },
  };
}

// ----------------------------------------------------------------- static

function staticCaddyfile(port: number): string {
  // Unknown paths fall back to index.html, so single-page apps' links work.
  return [
    `:${port} {`,
    "\troot * /srv",
    "\ttry_files {path} /index.html",
    "\tfile_server",
    "}",
    "",
  ].join("\n");
}

function staticSite(port: number): BuildPlan {
  return {
    ok: true,
    kind: "a static site",
    start: "its files, served by Caddy",
    files: {
      Dockerfile: [
        "FROM caddy:2.8.4-alpine",
        "COPY . /srv",
        `COPY ${STATIC_CADDYFILE} /etc/caddy/Caddyfile`,
        `EXPOSE ${port}`,
        "",
      ].join("\n"),
      [STATIC_CADDYFILE]: staticCaddyfile(port),
    },
  };
}

/**
 * The script the deploy machine runs in the app's folder: whether there is a
 * Dockerfile, and otherwise the names and small files `planBuild` needs, each
 * as base64 so nothing in them can break the reply.
 */
export function inspectScript(): string {
  return [
    "if [ -f Dockerfile ]; then echo DOCKERFILE; exit 0; fi",
    'for n in * .[!.]*; do [ -e "$n" ] && printf "NAME %s\\n" "$n"; done',
    `for f in ${READ_FILES.join(" ")}; do`,
    '  [ -f "$f" ] && printf "FILE %s %s\\n" "$f" "$(head -c 200000 "$f" | base64 | tr -d \'\\n\')"',
    "done",
    'for d in */wsgi.py; do [ -f "$d" ] && printf "WSGI %s\\n" "${d%/wsgi.py}"; done',
    'for d in cmd/*/; do [ -d "$d" ] && ls "$d"*.go >/dev/null 2>&1 && d=${d%/} && printf "GOCMD %s\\n" "${d#cmd/}"; done',
    "exit 0",
    "",
  ].join("\n");
}

/** Reads what `inspectScript` printed; null when there is a Dockerfile. */
export function readInspection(output: string): AppFiles | null {
  const files: AppFiles = { names: [], contents: {}, wsgi: [], goCommands: [] };
  for (const line of output.split("\n")) {
    if (line === "DOCKERFILE") return null;
    const [tag, ...rest] = line.split(" ");
    if (tag === "NAME" && rest.length) files.names.push(rest.join(" "));
    else if (tag === "FILE" && rest.length >= 1 && rest[0]) {
      files.contents[rest[0]] = Buffer.from(rest[1] ?? "", "base64").toString("utf8");
    } else if (tag === "WSGI" && rest[0]) files.wsgi.push(rest[0]);
    else if (tag === "GOCMD" && rest[0]) files.goCommands.push(rest[0]);
  }
  return files;
}
