import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type FileContent,
  managedServiceStateSchema,
  type Preview,
  type ProjectRuntimeManifest,
  projectRuntimeSchema,
  ZelyqError,
} from "@zelyq/core";
import { assertRealPathInside, resolveInside } from "./paths.js";
import type { RuntimeDriver } from "./types.js";

export const RUNTIME_MANIFEST = "zelyq.runtime.json";
export const MANAGED_CAPABILITY = "react-fastapi-v1";

export async function installManagedDependencies(
  runtime: RuntimeDriver,
  id: string,
  root: string,
  manifest: ProjectRuntimeManifest,
): Promise<void> {
  const hash = createHash("sha256").update(runtime.kind).update(JSON.stringify(manifest.install));
  for (const file of [
    "package.json",
    "package-lock.json",
    "backend/pyproject.toml",
    "backend/uv.lock",
    "backend/.python-version",
  ]) {
    hash.update(await fs.readFile(path.join(root, file)).catch(() => Buffer.from("missing")));
  }
  const fingerprint = hash.digest("hex");
  const previous = await fs.readFile(path.join(root, ".zelyq", "install"), "utf8").catch(() => "");
  const installed = await Promise.all(
    ["node_modules", "backend/.venv"].map((file) =>
      fs.access(path.join(root, file)).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (previous === fingerprint && installed.every(Boolean)) return;
  for (const step of manifest.install) {
    const result = await runtime.exec(id, step);
    if (result.exitCode !== 0)
      throw new Error(
        `Dependency setup failed in ${step.cwd}: ${(result.stderr || result.stdout).slice(-4000)}`,
      );
  }
  await writeInside(root, path.join(".zelyq", "install"), fingerprint);
}

export async function readRuntimeManifest(
  runtime: Pick<RuntimeDriver, "readFile">,
  projectId: string,
): Promise<ProjectRuntimeManifest | null> {
  let file: FileContent;
  try {
    file = await runtime.readFile(projectId, RUNTIME_MANIFEST);
  } catch (error) {
    if (
      (error as { code?: string }).code === "not_found" ||
      (error as { code?: string }).code === "ENOENT"
    )
      return null;
    throw error;
  }
  try {
    return projectRuntimeSchema.parse(JSON.parse(file.content));
  } catch {
    throw ZelyqError.badRequest(
      "Invalid zelyq.runtime.json. Expected the version 1 React/FastAPI runtime contract.",
    );
  }
}

export async function prepareManagedRuntime(
  root: string,
  manifest: ProjectRuntimeManifest,
): Promise<void> {
  for (const step of [...manifest.install, ...manifest.checks, ...manifest.services]) {
    await assertRealPathInside(root, resolveInside(root, step.cwd));
  }
  await prepareManagedDirectory(root, ".zelyq");
  await prepareManagedDirectory(root, ".runtime-data");
  await writeInside(root, path.join(".zelyq", "supervisor.mjs"), SUPERVISOR);
  await writeInside(root, path.join(".zelyq", "runtime.json"), JSON.stringify(manifest));
  await fs.rm(path.join(root, ".zelyq", "services.json"), { force: true });
}

/**
 * Create a platform-owned directory, refusing to follow a symlink planted in
 * its place.
 *
 * `fs.mkdir(..., { recursive: true })` succeeds silently when the path is
 * already a symlink to a directory, so validating the path and then creating it
 * is not enough — project code shares this tree (a container bind-mount, a
 * remote host's workspace) and can replace either directory between the two.
 */
async function prepareManagedDirectory(root: string, name: string): Promise<void> {
  const target = resolveInside(root, name);
  const existing = await fs.lstat(target).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw ZelyqError.badRequest(`${name} must be a directory in this project, not a link.`);
  }
  await fs.mkdir(target, { recursive: true });
  await assertRealPathInside(root, target);
}

/**
 * Write one platform-owned file, never through a symlink.
 *
 * Without this, project code creates a real `.zelyq/` holding links and the
 * platform's own writes land wherever those links point — attacker-chosen
 * content at an attacker-chosen path, written by the host process outside the
 * container that planted them.
 */
async function writeInside(root: string, name: string, content: string): Promise<void> {
  const target = resolveInside(root, name);
  // Remove first: `wx` would reject an ordinary file we are meant to replace,
  // and unlinking a symlink removes the link, never its target.
  await fs.rm(target, { force: true });
  const handle = await fs.open(target, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  await assertRealPathInside(root, target);
}

/**
 * Fold the supervisor's per-service status into the aggregate preview.
 *
 * `services.json` lives inside the project, so it is untrusted: anything that
 * can write a file can write this one. It is size-capped and schema-parsed
 * rather than spread into the response, because `lastError` reaches both the UI
 * and the agent's own context — an unvalidated field here is a project file
 * writing directly into the model's prompt.
 */
const MAX_SERVICE_STATE_BYTES = 16 * 1024;

export async function managedStatus(root: string, preview: Preview): Promise<Preview> {
  try {
    const file = path.join(root, ".zelyq", "services.json");
    const { size } = await fs.stat(file);
    if (size > MAX_SERVICE_STATE_BYTES) return preview;

    const state = managedServiceStateSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    const failed = state.services.find((service) => service.status === "crashed");
    return {
      ...preview,
      services: state.services,
      ...(failed ? { status: "crashed" as const, lastError: failed.lastError, url: null } : {}),
    };
  } catch {
    return preview;
  }
}

/**
 * Managed services are installed and started with `uv`, so a runtime without it
 * cannot run a Python project at all. Advertising the capability anyway turns a
 * missing toolchain into a preview that dies partway through dependency
 * installation with a shell's "command not found" — which reads like the
 * project is broken rather than the host. Probe once per runtime and cache it:
 * health endpoints are called often and a probe costs a process (or a
 * container) start.
 */
const capabilityProbes = new Map<string, Promise<string[]>>();

export async function managedCapabilities(
  key: string,
  probe: () => Promise<boolean>,
): Promise<string[]> {
  let pending = capabilityProbes.get(key);
  if (!pending) {
    pending = probe().then(
      (supported) => (supported ? [MANAGED_CAPABILITY] : []),
      () => [],
    );
    capabilityProbes.set(key, pending);
  }
  return await pending;
}

/** Forget cached probes — for tests, and after an image is rebuilt. */
export function resetManagedCapabilities(): void {
  capabilityProbes.clear();
}

/**
 * The error a project gets when its runtime cannot run it, after Zelyq has
 * tried to provision the toolchain itself and failed. Phrased for the person
 * who has to fix it, and it says what went wrong rather than handing them a
 * chore we could not explain.
 */
export function managedUnsupported(where: string, reason?: string): ZelyqError {
  return ZelyqError.badRequest(
    `This project needs Python, and Zelyq could not set up the uv toolchain on ${where}` +
      `${reason ? `: ${reason}` : "."} ` +
      "Installing uv by hand (https://docs.astral.sh/uv/getting-started/installation/) " +
      "also works — Zelyq uses it from your PATH when it is there.",
  );
}

// ---------------------------------------------------------------------------
// Toolchain provisioning
// ---------------------------------------------------------------------------

/**
 * Pinned in step with `docker/sandbox.Dockerfile`, `docker/Dockerfile`, the
 * starter's own Dockerfile and CI, so every place a project can run has the
 * same uv.
 */
export const UV_VERSION = "0.12.16";

/** Where a Zelyq-provisioned toolchain lives: beside the workspace, never in a project. */
export function toolchainBinDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".zelyq-toolchain", `uv-${UV_VERSION}`);
}

/**
 * The PATH project commands run with: a Zelyq-provisioned toolchain first, then
 * whatever the host already has.
 */
export function toolchainPath(workspaceDir: string, basePath: string): string {
  return `${toolchainBinDir(workspaceDir)}${path.delimiter}${basePath}`;
}

const uvTargets: Record<string, string> = {
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
};

const toolchainInstalls = new Map<string, Promise<{ ok: boolean; reason?: string }>>();

/**
 * Make sure `uv` is available, installing it if it is not.
 *
 * Setting up a language toolchain is the platform's job, not something to hand
 * back to whoever wanted to build an app — they asked for a Python project, not
 * for homework. Only when this genuinely cannot work (an unsupported platform,
 * no network, a read-only disk) does the error ask them to do it themselves,
 * and then it says why.
 *
 * The binary is fetched from the pinned GitHub release and checked against the
 * SHA-256 the release publishes, rather than piping an installer script into a
 * shell — the same approach CI uses for gitleaks. Nothing is written outside
 * the workspace and the user's own shell profile is never modified.
 */
export async function ensureUvToolchain(
  workspaceDir: string,
  options: { run: (command: string, env: Record<string, string>) => Promise<{ exitCode: number }> },
): Promise<{ ok: boolean; reason?: string }> {
  let pending = toolchainInstalls.get(workspaceDir);
  if (!pending) {
    pending = provisionUv(workspaceDir, options).catch((error: Error) => ({
      ok: false,
      reason: error.message,
    }));
    toolchainInstalls.set(workspaceDir, pending);
  }
  return await pending;
}

/** Forget provisioning results — for tests. */
export function resetToolchainProvisioning(): void {
  toolchainInstalls.clear();
}

async function provisionUv(
  workspaceDir: string,
  options: { run: (command: string, env: Record<string, string>) => Promise<{ exitCode: number }> },
): Promise<{ ok: boolean; reason?: string }> {
  const binDir = toolchainBinDir(workspaceDir);
  const withToolchain = { PATH: toolchainPath(workspaceDir, process.env.PATH ?? "") };

  // Already usable — either we installed it before, or the host has its own.
  if ((await options.run("uv --version", withToolchain)).exitCode === 0) return { ok: true };

  const target = uvTargets[`${process.platform}-${process.arch}`];
  if (!target) {
    // uv ships for Windows, but as a zip rather than the tarball this unpacks
    // with `tar`, so there it is one command for the operator instead of a
    // vague refusal.
    return {
      ok: false,
      reason:
        process.platform === "win32"
          ? 'automatic setup is not supported on Windows yet — run "winget install --id=astral-sh.uv" ' +
            'or "powershell -c "irm https://astral.sh/uv/install.ps1 | iex"" once, and Zelyq will find it'
          : `there is no uv build for ${process.platform}/${process.arch}`,
    };
  }

  return await withManagedLock(workspaceDir, "uv-toolchain", async () => {
    // Another process may have finished while we waited for the lease.
    if ((await options.run("uv --version", withToolchain)).exitCode === 0) return { ok: true };

    const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;
    const asset = `uv-${target}.tar.gz`;
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-uv-"));
    try {
      const [archive, checksums] = await Promise.all([
        fetchBytes(`${base}/${asset}`, 80 * 1024 * 1024),
        fetchBytes(`${base}/${asset}.sha256`, 4096),
      ]);

      const expected = checksums.toString("utf8").trim().split(/\s+/)[0]?.toLowerCase();
      const actual = createHash("sha256").update(archive).digest("hex");
      if (!expected || expected !== actual) {
        return { ok: false, reason: "the downloaded uv archive failed its checksum check" };
      }

      await fs.writeFile(path.join(staging, asset), archive);
      // --strip-components: the archive holds `uv-<target>/uv`, and we want the
      // binary itself at a predictable path.
      const extract = await options.run(
        `tar -xzf ${JSON.stringify(path.join(staging, asset))} --strip-components=1 -C ${JSON.stringify(staging)}`,
        {},
      );
      if (extract.exitCode !== 0)
        return { ok: false, reason: "the uv archive could not be unpacked" };

      await fs.mkdir(binDir, { recursive: true });
      for (const name of ["uv", "uvx"]) {
        const from = path.join(staging, name);
        if (!(await fs.stat(from).catch(() => null))) continue;
        // Move into place under a temporary name, then rename: a half-copied
        // binary must never be visible on PATH to another process.
        const staged = path.join(binDir, `.${name}.incoming`);
        await fs.copyFile(from, staged);
        await fs.chmod(staged, 0o755);
        await fs.rename(staged, path.join(binDir, name));
      }

      const works = await options.run("uv --version", withToolchain);
      return works.exitCode === 0
        ? { ok: true }
        : { ok: false, reason: "the installed uv could not be run on this machine" };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  });
}

async function fetchBytes(url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: "follow" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > maxBytes) throw new Error("the download was larger than expected");
  return body;
}

/** Host-only environment. Platform credentials must never reach authored code. */
export function cleanProcessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "TEMP",
    "SystemRoot",
    "COMSPEC",
    "LANG",
    "UV_CACHE_DIR",
    "UV_PYTHON_INSTALL_DIR",
  ]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

/** Filesystem lease shared by independent server/agent drivers on the same host. */
export async function withManagedLock<T>(
  workspace: string,
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  const directory = path.join(workspace, ".zelyq-previews");
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, `${id}.managed-lock`);
  const deadline = Date.now() + 660_000;
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        // Reclaiming a dead holder's lease: rename it aside instead of
        // deleting it in place. Two waiters can both see the same stale lock,
        // but only one rename of a given path succeeds — deleting and
        // retrying lets the loser remove the *fresh* lock the winner has
        // just taken, and both then supervise the same project.
        const aside = `${lock}.stale-${process.pid}-${Date.now()}`;
        const won = await fs
          .rename(lock, aside)
          .then(() => true)
          .catch(() => false);
        if (won) await fs.rm(aside, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for project preview operation");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const heartbeat = setInterval(() => {
    void fs.utimes(lock, new Date(), new Date()).catch(() => undefined);
  }, 5000);
  heartbeat.unref();
  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
    await fs.rm(lock, { recursive: true, force: true });
  }
}

// Only platform-owned code is written here. Authored services still execute inside
// the selected runtime's trust boundary. The supervisor never writes secrets.
export const SUPERVISOR = String.raw`
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
const root = process.cwd();
// Our stdout is a pipe held by whichever Zelyq process started us. When that
// process exits, the next write raises EPIPE — which, unhandled, would take
// down a perfectly healthy API and record it as a backend crash. Losing the
// log destination is not a reason to stop supervising.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const manifest = JSON.parse(await fs.readFile('.zelyq/runtime.json', 'utf8'));
const backend = JSON.parse(process.env.ZELYQ_BACKEND_ENV || '{}');
const base = { ...process.env };
delete base.ZELYQ_BACKEND_ENV;
const sensitive = Object.values(backend).filter(v => typeof v === 'string' && v.length >= 4);
const children = [];
const state = { services: manifest.services.map(s => ({ id: s.id, status: 'starting', lastError: null })) };
let ending = false;
let write = Promise.resolve();
function save() {
  const body = JSON.stringify(state);
  write = write.then(() => fs.writeFile('.zelyq/services.tmp', body)).then(() => fs.rename('.zelyq/services.tmp', '.zelyq/services.json'));
  return write;
}
function log(id, line) {
  for (const secret of sensitive) line = line.split(secret).join('[redacted]');
  // Internal URLs must not be mistaken for the browser-facing preview port.
  if (id === 'backend') line = line.replace(/https?:\/\/[^\s]+/g, '[backend address]');
  process.stdout.write('[' + id + '] ' + line.slice(0, 16000) + '\n');
}
function pipe(id, stream) {
  let pending = '';
  stream.on('data', data => {
    pending += data.toString();
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) log(id, line);
    if (pending.length > 32000) { log(id, '[oversized log line omitted]'); pending = ''; }
  });
  stream.on('end', () => { if (pending) log(id, pending); });
}
async function stop(failure) {
  if (ending) return;
  ending = true;
  if (failure) { failure.status = 'crashed'; failure.lastError ||= failure.id + ' service failed'; }
  for (const item of state.services) if (item !== failure) item.status = 'stopped';
  await save().catch(() => {});
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
  setTimeout(() => {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    process.exit(failure ? 1 : 0);
  }, 1200);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
process.on('uncaughtException', () => void stop(state.services.find(s => s.status === 'starting') || state.services[0]));
process.on('unhandledRejection', () => void stop(state.services.find(s => s.status === 'starting') || state.services[0]));
const backendPort = await new Promise((resolve, reject) => {
  const s = net.createServer(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); });
});

// Bring the project's OWN database up to date before the API opens. The server
// sets ZELYQ_DB_AUTOMIGRATE only for a SQLite file Zelyq created for this
// project, so a user's PostgreSQL or MySQL never reaches this path. Without it
// a freshly built feature returns "no such table" until someone runs a command
// by hand, which is not something a person building an app should have to know.
if (manifest.migrate && backend.ZELYQ_DB_AUTOMIGRATE === '1') {
  const status = state.services.find(s => s.id === 'backend');
  const step = manifest.migrate;
  const code = await new Promise(resolve => {
    const child = spawn('/bin/bash', ['-c', step.command], {
      cwd: path.resolve(root, step.cwd),
      env: { ...base, ...backend, ZELYQ_DATA_DIR: path.join(root, '.runtime-data') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipe('migrate', child.stdout); pipe('migrate', child.stderr);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, step.timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve(1); });
    child.on('exit', value => { clearTimeout(timer); resolve(value === null ? 1 : value); });
  });
  if (code !== 0) {
    status.lastError = 'Database migration failed. Read the migrate log above.';
    await stop(status);
  }
}

for (const service of manifest.services) {
  if (ending) break;
  const status = state.services.find(s => s.id === service.id);
  const port = service.id === 'backend' ? backendPort : Number(process.env.PORT);
  const host = service.id === 'backend' ? '127.0.0.1' : process.env.HOST;
  const argv = service.argv.map(v => v.replaceAll('{port}', String(port)).replaceAll('{host}', host));
  const env = service.id === 'backend'
    ? { ...base, ...backend, ZELYQ_DATA_DIR: path.join(root, '.runtime-data') }
    : { ...base, ZELYQ_API_TARGET: 'http://127.0.0.1:' + backendPort };
  const child = spawn(argv[0], argv.slice(1), { cwd: path.resolve(root, service.cwd), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  pipe(service.id, child.stdout); pipe(service.id, child.stderr);
  child.on('error', () => { status.lastError = service.id + ' executable could not start'; void stop(status); });
  child.on('exit', code => { if (!ending) { status.lastError = service.id + ' exited (' + code + ')'; void stop(status); } });
  await save();
  let healthy = false;
  for (let n = 0; n < 120 && !ending; n++) {
    try { const r = await fetch('http://127.0.0.1:' + port + service.healthPath, { signal: AbortSignal.timeout(1000) }); if (r.ok) { healthy = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!healthy) { status.lastError = service.id + ' readiness check failed'; await stop(status); break; }
  status.status = 'running'; await save();
  // After startup, losing readiness is reported, never acted on. A service
  // that stops answering mid-session is almost always code caught between two
  // edits — models.py changed, main.py not yet — and Uvicorn's reloader loads
  // it again the moment the next edit lands. Found live: tearing the preview
  // down here killed it for good sixty seconds before the agent's next edit
  // would have fixed it, and every check then called a working app broken.
  // Only a process that actually exits ends the preview (the 'exit' handler).
  let failures = 0;
  const monitor = setInterval(async () => {
    if (ending) return clearInterval(monitor);
    try {
      const r = await fetch('http://127.0.0.1:' + port + service.healthPath, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw Error();
      failures = 0;
      if (status.status !== 'running') { status.status = 'running'; status.lastError = null; await save(); }
    } catch {
      if (++failures >= 3 && status.status === 'running') {
        status.status = 'crashed';
        status.lastError = service.id + ' stopped responding — usually a code error; read preview_logs. ' +
          'It recovers on its own as soon as the code loads again.';
        await save();
      }
    }
  }, 2000);
}
`;
