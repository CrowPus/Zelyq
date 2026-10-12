import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  type AppFiles,
  inspectScript,
  planBuild,
  readInspection,
} from "../src/services/build-detect.js";

/**
 * Deploying without a Dockerfile: which kind of app it is, the Dockerfile
 * Zelyq writes for it, and — with Docker here — that each one really builds,
 * starts and answers on the port the deploy step names.
 */

function files(names: string[], contents: Record<string, string> = {}): AppFiles {
  return { names, contents, wsgi: [], goCommands: [] };
}
const pkg = (value: object) => JSON.stringify(value);

test("Node: the package manager, the version, how it starts", () => {
  const plan = planBuild(
    files(["package.json", "pnpm-lock.yaml", "src"], {
      "package.json": pkg({
        scripts: { build: "tsc", start: "node dist/index.js" },
        engines: { node: ">=20" },
      }),
    }),
    3000,
    null,
  );
  assert.ok(plan.ok);
  assert.equal(plan.kind, "Node 20 (pnpm)");
  assert.equal(plan.start, "pnpm run start");
  const dockerfile = plan.files.Dockerfile ?? "";
  assert.match(dockerfile, /^FROM node:20-alpine/);
  assert.match(dockerfile, /RUN corepack enable/);
  assert.match(dockerfile, /COPY package.json pnpm-lock.yaml \.\//);
  assert.match(dockerfile, /RUN pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /RUN pnpm run build/);
  assert.match(dockerfile, /ENV NODE_ENV=production PORT=3000/);
  assert.match(dockerfile, /CMD \["sh","-c","pnpm run start"\]/);
  // The build comes before production mode: it may need development packages.
  assert.ok(dockerfile.indexOf("run build") < dockerfile.indexOf("NODE_ENV=production"));
});

test("Node: no start script, a main file; a .nvmrc; npm ci with a lock file", () => {
  const plan = planBuild(
    files(["package.json", "package-lock.json", "server.js", ".nvmrc"], {
      "package.json": pkg({}),
      ".nvmrc": "v18.19.0\n",
    }),
    8080,
    null,
  );
  assert.ok(plan.ok);
  assert.equal(plan.kind, "Node 18 (npm)");
  assert.equal(plan.start, "node server.js");
  assert.match(plan.files.Dockerfile ?? "", /RUN npm ci/);
});

test("Node: a Vite site is built and served as files, with single-page links", () => {
  const plan = planBuild(
    files(["package.json", "package-lock.json", "index.html", "src"], {
      "package.json": pkg({
        scripts: { build: "vite build", dev: "vite" },
        devDependencies: { vite: "^6" },
      }),
    }),
    80,
    null,
  );
  assert.ok(plan.ok);
  assert.match(plan.kind, /a site built to files/);
  assert.match(plan.files.Dockerfile ?? "", /FROM caddy:2\.8\.4-alpine/);
  assert.match(plan.files[".zelyq.Caddyfile"] ?? "", /try_files \{path\} \/index\.html/);
});

test("Node: Next.js runs as a server; nothing to start is said plainly", () => {
  const next = planBuild(
    files(["package.json"], {
      "package.json": pkg({
        scripts: { build: "next build", start: "next start" },
        dependencies: { next: "15" },
      }),
    }),
    3000,
    null,
  );
  assert.ok(next.ok);
  assert.match(next.kind, /Next\.js/);
  const none = planBuild(files(["package.json"], { "package.json": pkg({}) }), 3000, null);
  assert.equal(none.ok, false);
  assert.match(!none.ok ? none.error : "", /add a "start" script/);
});

test("Python: Django, FastAPI, Flask, a plain script; the version; the server it needs", () => {
  const django = planBuild(
    {
      ...files(["manage.py", "requirements.txt", "shop"], { "requirements.txt": "Django==5.1\n" }),
      wsgi: ["shop"],
    },
    8000,
    null,
  );
  assert.ok(django.ok);
  assert.equal(django.kind, "Python 3.12 (Django)");
  assert.equal(django.start, "gunicorn shop.wsgi --bind 0.0.0.0:$PORT");
  assert.match(django.files.Dockerfile ?? "", /RUN pip install --no-cache-dir gunicorn/);

  const fastapi = planBuild(
    files(["main.py", "requirements.txt", ".python-version"], {
      "requirements.txt": "fastapi\nuvicorn[standard]\n",
      ".python-version": "3.11.9\n",
    }),
    8000,
    null,
  );
  assert.ok(fastapi.ok);
  assert.equal(fastapi.kind, "Python 3.11 (FastAPI)");
  assert.equal(fastapi.start, "uvicorn main:app --host 0.0.0.0 --port $PORT");
  assert.doesNotMatch(
    fastapi.files.Dockerfile ?? "",
    /pip install --no-cache-dir uvicorn/,
    "listed already",
  );

  const flask = planBuild(
    files(["app.py", "requirements.txt"], { "requirements.txt": "Flask>=3\n" }),
    5000,
    null,
  );
  assert.ok(flask.ok);
  assert.equal(flask.start, "gunicorn app:app --bind 0.0.0.0:$PORT");

  const plain = planBuild(
    files(["main.py", "pyproject.toml"], { "pyproject.toml": "[project]\nname='x'\n" }),
    8000,
    null,
  );
  assert.ok(plain.ok);
  assert.equal(plain.start, "python main.py");
  assert.match(plain.files.Dockerfile ?? "", /RUN pip install --no-cache-dir \./);
});

test("Go: the version from go.mod, a main package at the top or in cmd/<name>", () => {
  const top = planBuild(
    files(["go.mod", "main.go"], { "go.mod": "module x\n\ngo 1.22.3\n" }),
    8080,
    null,
  );
  assert.ok(top.ok);
  assert.equal(top.kind, "Go 1.22");
  assert.match(top.files.Dockerfile ?? "", /go build -o \/out\/server \.$/m);
  const cmd = planBuild(
    { ...files(["go.mod", "cmd"], { "go.mod": "go 1.23\n" }), goCommands: ["api"] },
    8080,
    null,
  );
  assert.ok(cmd.ok);
  assert.match(cmd.files.Dockerfile ?? "", /go build -o \/out\/server \.\/cmd\/api/);
  const many = planBuild(
    { ...files(["go.mod", "cmd"]), goCommands: ["api", "worker"] },
    8080,
    null,
  );
  assert.equal(many.ok, false);
});

test("a Procfile or start: decides how it starts; a static site; nothing known", () => {
  const procfile = planBuild(
    files(["requirements.txt", "Procfile"], {
      Procfile: "release: migrate\nweb: python -m http.server $PORT\n",
    }),
    8000,
    null,
  );
  assert.ok(procfile.ok);
  assert.equal(procfile.start, "python -m http.server $PORT");
  const step = planBuild(
    files(["package.json"], { "package.json": "{}" }),
    3000,
    "node app/run.js",
  );
  assert.ok(step.ok);
  assert.equal(step.start, "node app/run.js");
  assert.equal(planBuild(files(["package.json"], {}), 3000, "a\nb").ok, false);

  const site = planBuild(files(["index.html", "style.css"]), 8080, null);
  assert.ok(site.ok);
  assert.equal(site.kind, "a static site");
  assert.match(site.files[".zelyq.Caddyfile"] ?? "", /^:8080 \{/);

  const unknown = planBuild(files(["README.md"]), 8080, null);
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.error : "", /could not tell what kind of app/);
});

test("the machine's report is read back exactly", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-inspect-"));
  try {
    await fs.writeFile(
      path.join(dir, "package.json"),
      '{"name":"x y","scripts":{"start":"node a.js"}}',
    );
    await fs.writeFile(path.join(dir, "Procfile"), "web: node a.js\n");
    await fs.writeFile(path.join(dir, ".nvmrc"), "20\n");
    await fs.mkdir(path.join(dir, "shop"));
    await fs.writeFile(path.join(dir, "shop", "wsgi.py"), "");
    await fs.mkdir(path.join(dir, "cmd", "api"), { recursive: true });
    await fs.writeFile(path.join(dir, "cmd", "api", "main.go"), "package main");
    const output = execFileSync("sh", ["-s"], { cwd: dir, input: inspectScript() }).toString();
    const read = readInspection(output);
    assert.ok(read);
    assert.deepEqual(read.names.sort(), [".nvmrc", "Procfile", "cmd", "package.json", "shop"]);
    assert.equal(read.contents["package.json"], '{"name":"x y","scripts":{"start":"node a.js"}}');
    assert.equal(read.contents.Procfile, "web: node a.js\n");
    assert.deepEqual(read.wsgi, ["shop"]);
    assert.deepEqual(read.goCommands, ["api"]);
    await fs.writeFile(path.join(dir, "Dockerfile"), "FROM scratch\n");
    const own = execFileSync("sh", ["-s"], { cwd: dir, input: inspectScript() }).toString();
    assert.equal(readInspection(own), null, "an app's own Dockerfile wins");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------- real builds, with Docker

function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as net.AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
}

/** Writes the app, plans it as a deploy would, builds and runs it, and returns what / answers. */
async function buildAndAsk(
  name: string,
  app: Record<string, string>,
  port: number,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `zelyq-build-${name}-`));
  const image = `zelyq-build-test-${name}:1`;
  const container = `zelyq-build-test-${name}`;
  try {
    for (const [file, text] of Object.entries(app)) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), text);
    }
    const read = readInspection(
      execFileSync("sh", ["-s"], { cwd: dir, input: inspectScript() }).toString(),
    );
    assert.ok(read, "no Dockerfile in the sample");
    const plan = planBuild(read, port, null);
    assert.ok(plan.ok, !plan.ok ? plan.error : "");
    for (const [file, text] of Object.entries(plan.files))
      await fs.writeFile(path.join(dir, file), text);
    execFileSync("docker", ["build", "-q", "-t", image, dir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const hostPort = await freePort();
    execFileSync(
      "docker",
      ["run", "-d", "--name", container, "-p", `127.0.0.1:${hostPort}:${port}`, image],
      {
        stdio: "ignore",
      },
    );
    const deadline = Date.now() + 60_000;
    for (;;) {
      const answer = await fetch(`http://127.0.0.1:${hostPort}/`, {
        signal: AbortSignal.timeout(2000),
      })
        .then((response) => response.text())
        .catch(() => null);
      if (answer !== null) return answer;
      if (Date.now() > deadline) {
        const logs = execFileSync("docker", ["logs", "--tail", "20", container]).toString();
        throw new Error(`${name} did not answer:\n${logs}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    try {
      execFileSync("docker", ["rmi", "-f", image], { stdio: "ignore" });
    } catch {
      // never built
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const docker = dockerAvailable();

test("built for real: Node, a Vite-style site, FastAPI, Flask, Go, static", {
  skip: !docker && "no Docker",
  timeout: 1_200_000,
}, async () => {
  assert.equal(
    await buildAndAsk(
      "node",
      {
        "package.json": pkg({ scripts: { start: "node server.js" } }),
        "server.js":
          'require("http").createServer((q, s) => s.end("node on " + process.env.PORT)).listen(process.env.PORT);\n',
      },
      3000,
    ),
    "node on 3000",
  );

  // A site that builds to files, with a build script and no start: served by Caddy.
  const site = await buildAndAsk(
    "site",
    {
      "package.json": pkg({ scripts: { build: "node build.js" }, devDependencies: { vite: "*" } }),
      "build.js":
        'require("fs").mkdirSync("dist");require("fs").writeFileSync("dist/index.html","built site");\n',
    },
    8080,
  );
  assert.equal(site, "built site");

  assert.match(
    await buildAndAsk(
      "fastapi",
      {
        "requirements.txt": "fastapi==0.115.6\nuvicorn==0.34.0\n",
        "main.py":
          'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root():\n    return {"from": "fastapi"}\n',
      },
      8000,
    ),
    /"from":"fastapi"/,
  );

  assert.equal(
    await buildAndAsk(
      "flask",
      {
        "requirements.txt": "Flask==3.1.0\n",
        "app.py":
          'from flask import Flask\napp = Flask(__name__)\n@app.get("/")\ndef root():\n    return "flask"\n',
      },
      5000,
    ),
    "flask",
  );

  assert.equal(
    await buildAndAsk(
      "go",
      {
        "go.mod": "module example.com/hello\n\ngo 1.22\n",
        "main.go":
          'package main\n\nimport (\n\t"fmt"\n\t"net/http"\n\t"os"\n)\n\nfunc main() {\n\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "go") })\n\thttp.ListenAndServe(":"+os.Getenv("PORT"), nil)\n}\n',
      },
      8080,
    ),
    "go",
  );

  assert.equal(await buildAndAsk("static", { "index.html": "plain html" }, 8080), "plain html");
});
