import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Preview, ProjectRuntimeManifest } from "@zelyq/core";
import {
  cleanProcessEnv,
  ensureUvToolchain,
  installManagedDependencies,
  MANAGED_CAPABILITY,
  managedCapabilities,
  managedStatus,
  managedUnsupported,
  prepareManagedRuntime,
  readRuntimeManifest,
  resetManagedCapabilities,
  resetToolchainProvisioning,
  toolchainBinDir,
  toolchainPath,
  withManagedLock,
} from "../src/managed.js";
import type { ExecOptions, ExecResult, RuntimeDriver } from "../src/types.js";

const MANIFEST: ProjectRuntimeManifest = {
  version: 1,
  stack: "react-fastapi",
  install: [
    { command: "npm ci", cwd: ".", timeoutMs: 120_000 },
    { command: "uv sync --locked", cwd: "backend", timeoutMs: 120_000 },
  ],
  services: [
    {
      id: "backend",
      cwd: "backend",
      argv: ["uv", "run", "uvicorn"],
      healthPath: "/api/health/ready",
    },
    { id: "frontend", cwd: ".", argv: ["npm", "run", "dev"], healthPath: "/" },
  ],
  checks: [{ name: "API tests", command: "uv run pytest", cwd: "backend", timeoutMs: 120_000 }],
};

async function scratch(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-managed-"));
  await fs.mkdir(path.join(root, "backend"), { recursive: true });
  return root;
}

const stoppedPreview: Preview = {
  projectId: "p1",
  status: "running",
  url: "http://127.0.0.1:4100",
  port: 4100,
  pid: 1,
  startedAt: new Date().toISOString(),
  lastError: null,
};

/** A driver stub that records the commands a caller would have run. */
function recordingRuntime(root: string, exitCode = 0): RuntimeDriver & { ran: ExecOptions[] } {
  const ran: ExecOptions[] = [];
  return {
    kind: "local",
    ran,
    async exec(_id: string, options: ExecOptions): Promise<ExecResult> {
      ran.push(options);
      if (exitCode === 0) {
        // Mirror what a real install leaves behind, so the fingerprint check
        // has something to find on the second call.
        await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
        await fs.mkdir(path.join(root, "backend", ".venv"), { recursive: true });
      }
      return {
        exitCode,
        stdout: "",
        stderr: "boom",
        durationMs: 1,
        truncated: false,
        timedOut: false,
      };
    },
  } as unknown as RuntimeDriver & { ran: ExecOptions[] };
}

test("dependency setup runs once and is skipped while the lockfiles are unchanged", async () => {
  const root = await scratch();
  await fs.writeFile(path.join(root, "package-lock.json"), "{}");
  await fs.writeFile(path.join(root, "backend", "uv.lock"), "v1");
  await prepareManagedRuntime(root, MANIFEST);
  const runtime = recordingRuntime(root);

  await installManagedDependencies(runtime, "p1", root, MANIFEST);
  assert.equal(runtime.ran.length, 2, "both install steps run on a fresh project");

  await installManagedDependencies(runtime, "p1", root, MANIFEST);
  assert.equal(runtime.ran.length, 2, "nothing reinstalls when nothing changed");

  await fs.writeFile(path.join(root, "backend", "uv.lock"), "v2");
  await installManagedDependencies(runtime, "p1", root, MANIFEST);
  assert.equal(runtime.ran.length, 4, "a changed lockfile re-synchronises");
});

test("a deleted environment reinstalls even though the lockfiles match", async () => {
  const root = await scratch();
  await prepareManagedRuntime(root, MANIFEST);
  const runtime = recordingRuntime(root);
  await installManagedDependencies(runtime, "p1", root, MANIFEST);
  assert.equal(runtime.ran.length, 2);

  await fs.rm(path.join(root, "backend", ".venv"), { recursive: true, force: true });
  await installManagedDependencies(runtime, "p1", root, MANIFEST);
  assert.equal(runtime.ran.length, 4, "a missing venv is not a current installation");
});

test("a failed install step reports the directory and does not record success", async () => {
  const root = await scratch();
  await prepareManagedRuntime(root, MANIFEST);
  const runtime = recordingRuntime(root, 1);
  await assert.rejects(
    () => installManagedDependencies(runtime, "p1", root, MANIFEST),
    /Dependency setup failed in \./,
  );
  const failing = recordingRuntime(root, 1);
  await assert.rejects(() => installManagedDependencies(failing, "p1", root, MANIFEST));
  assert.equal(failing.ran.length, 1, "a failed install is retried, never assumed done");
});

test("preparing a project writes the supervisor and clears stale service status", async () => {
  const root = await scratch();
  await fs.mkdir(path.join(root, ".zelyq"), { recursive: true });
  await fs.writeFile(path.join(root, ".zelyq", "services.json"), '{"services":[]}');
  await prepareManagedRuntime(root, MANIFEST);

  assert.ok(await fs.readFile(path.join(root, ".zelyq", "supervisor.mjs"), "utf8"));
  assert.ok(await fs.stat(path.join(root, ".runtime-data")));
  await assert.rejects(
    () => fs.readFile(path.join(root, ".zelyq", "services.json"), "utf8"),
    "a previous run's status must not be read as this run's",
  );
});

test("a manifest with an escaping working directory is refused before anything starts", async () => {
  const root = await scratch();
  await assert.rejects(() =>
    prepareManagedRuntime(root, {
      ...MANIFEST,
      install: [{ command: "x", cwd: "../..", timeoutMs: 1000 }],
    }),
  );
});

test("a missing manifest is not an error; an invalid one is", async () => {
  const notFound = {
    async readFile() {
      throw Object.assign(new Error("nope"), { code: "not_found" });
    },
  };
  assert.equal(await readRuntimeManifest(notFound as never, "p1"), null);

  const invalid = {
    async readFile() {
      return { content: '{"version":9}' };
    },
  };
  await assert.rejects(
    () => readRuntimeManifest(invalid as never, "p1"),
    /Invalid zelyq.runtime.json/,
  );
});

test("a crashed service fails the whole preview and drops its URL", async () => {
  const root = await scratch();
  await fs.mkdir(path.join(root, ".zelyq"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".zelyq", "services.json"),
    JSON.stringify({
      services: [
        { id: "backend", status: "crashed", lastError: "backend exited (1)" },
        { id: "frontend", status: "running", lastError: null },
      ],
    }),
  );

  const status = await managedStatus(root, stoppedPreview);
  assert.equal(status.status, "crashed", "a healthy frontend cannot mask a dead API");
  assert.equal(status.url, null);
  assert.equal(status.lastError, "backend exited (1)");
  assert.equal(status.services?.length, 2);
});

test("both services running leaves the preview as it was", async () => {
  const root = await scratch();
  await fs.mkdir(path.join(root, ".zelyq"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".zelyq", "services.json"),
    JSON.stringify({
      services: [
        { id: "backend", status: "running", lastError: null },
        { id: "frontend", status: "running", lastError: null },
      ],
    }),
  );
  const status = await managedStatus(root, stoppedPreview);
  assert.equal(status.status, "running");
  assert.equal(status.url, stoppedPreview.url);
});

test("a project with no service status is reported unchanged", async () => {
  const root = await scratch();
  assert.deepEqual(await managedStatus(root, stoppedPreview), stoppedPreview);
});

test("the child environment carries no platform credentials", () => {
  process.env.ZELYQ_SECRET_KEY = "platform-secret";
  process.env.DATABASE_URL = "postgres://zelyq-platform/db";
  process.env.ANTHROPIC_API_KEY = "sk-should-not-travel";
  try {
    const env = cleanProcessEnv();
    assert.equal(env.ZELYQ_SECRET_KEY, undefined);
    assert.equal(env.DATABASE_URL, undefined, "the platform database is not the app's database");
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.ok(env.PATH, "PATH still has to reach the child");
  } finally {
    delete process.env.ZELYQ_SECRET_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("the capability probe is cached per runtime and reports what it found", async () => {
  resetManagedCapabilities();
  let calls = 0;
  const probe = async () => {
    calls += 1;
    return true;
  };
  assert.deepEqual(await managedCapabilities("unit:a", probe), [MANAGED_CAPABILITY]);
  assert.deepEqual(await managedCapabilities("unit:a", probe), [MANAGED_CAPABILITY]);
  assert.equal(calls, 1, "health endpoints are called often; the probe is not");

  assert.deepEqual(await managedCapabilities("unit:b", async () => false), []);
  assert.deepEqual(
    await managedCapabilities("unit:c", async () => {
      throw new Error("no docker");
    }),
    [],
    "a probe that cannot run means the capability is absent, not an outage",
  );
  resetManagedCapabilities();
});

test("a missing capability is asked again after a minute; a present one is kept", async (t) => {
  // Found in review: one failed probe (the sandbox image not built yet, a
  // toolchain download that failed) hid the Python stack until a restart.
  resetManagedCapabilities();
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  let supported = false;
  let calls = 0;
  const probe = async () => {
    calls += 1;
    return supported;
  };
  assert.deepEqual(await managedCapabilities("unit:later", probe), []);
  supported = true;
  assert.deepEqual(await managedCapabilities("unit:later", probe), [], "not re-probed at once");
  assert.equal(calls, 1);

  t.mock.timers.tick(60_000);
  assert.deepEqual(await managedCapabilities("unit:later", probe), [MANAGED_CAPABILITY]);
  assert.equal(calls, 2);

  t.mock.timers.tick(10 * 60_000);
  supported = false;
  assert.deepEqual(await managedCapabilities("unit:later", probe), [MANAGED_CAPABILITY]);
  assert.equal(calls, 2, "a yes is not asked again");
  resetManagedCapabilities();
});

test("preview operations for one project are serialised across drivers", async () => {
  const workspace = await scratch();
  const order: string[] = [];
  const slow = withManagedLock(workspace, "p1", async () => {
    order.push("first in");
    await new Promise((resolve) => setTimeout(resolve, 60));
    order.push("first out");
  });
  const fast = withManagedLock(workspace, "p1", async () => {
    order.push("second in");
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["first in", "first out", "second in"]);
});

test("a different project is not blocked by a busy one", async () => {
  const workspace = await scratch();
  let released = false;
  const held = withManagedLock(workspace, "p1", async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    released = true;
  });
  await withManagedLock(workspace, "p2", async () => {
    assert.equal(released, false, "p2 ran while p1 still held its own lock");
  });
  await held;
});

test("the lock is released when the operation throws", async () => {
  const workspace = await scratch();
  await assert.rejects(() =>
    withManagedLock(workspace, "p1", async () => {
      throw new Error("start failed");
    }),
  );
  await withManagedLock(workspace, "p1", async () => {
    /* reachable only if the failed run let go */
  });
});

test("platform files are never written through a symlink planted in the project", async () => {
  // A container/remote project shares this tree with code running inside it.
  // Validating `.zelyq` as a directory and then writing into it is not enough:
  // real directory + symlinked entries means the host writes wherever those
  // links point, outside the project, as the Zelyq user.
  const root = await scratch();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-victim-"));
  const victim = path.join(outside, "victim.conf");
  await fs.writeFile(victim, "ORIGINAL");

  await fs.mkdir(path.join(root, ".zelyq"), { recursive: true });
  for (const name of ["runtime.json", "supervisor.mjs", "install"]) {
    await fs.symlink(victim, path.join(root, ".zelyq", name));
  }

  await prepareManagedRuntime(root, MANIFEST);
  assert.equal(await fs.readFile(victim, "utf8"), "ORIGINAL", "runtime.json/supervisor escaped");

  const runtime = recordingRuntime(root);
  await installManagedDependencies(runtime, "p1", root, MANIFEST);
  assert.equal(await fs.readFile(victim, "utf8"), "ORIGINAL", "the install fingerprint escaped");

  // The real files landed inside the project, replacing the links.
  for (const name of ["runtime.json", "supervisor.mjs", "install"]) {
    const written = await fs.lstat(path.join(root, ".zelyq", name));
    assert.equal(written.isSymbolicLink(), false, `${name} is still a link`);
  }
  await fs.rm(outside, { recursive: true, force: true });
});

test("a symlinked .zelyq or .runtime-data is refused outright", async () => {
  for (const name of [".zelyq", ".runtime-data"]) {
    const root = await scratch();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-victim-"));
    await fs.symlink(outside, path.join(root, name));
    await assert.rejects(
      () => prepareManagedRuntime(root, MANIFEST),
      /not a link/,
      `${name} must not be followed`,
    );
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("service status is validated, not echoed, since a project file writes it", async () => {
  const root = await scratch();
  await fs.mkdir(path.join(root, ".zelyq"), { recursive: true });
  const write = (value: unknown) =>
    fs.writeFile(path.join(root, ".zelyq", "services.json"), JSON.stringify(value));

  // An invented status and an extra field must not reach the UI or the agent.
  await write({
    services: [
      { id: "backend", status: "totally-made-up", lastError: null },
      { id: "frontend", status: "running", lastError: null, extra: { nested: true } },
    ],
  });
  assert.equal((await managedStatus(root, stoppedPreview)).services, undefined);

  // A huge lastError would otherwise be spent verbatim as prompt tokens.
  await write({
    services: [{ id: "backend", status: "crashed", lastError: "x".repeat(200_000) }],
  });
  const huge = await managedStatus(root, stoppedPreview);
  assert.equal(huge.services, undefined, "an oversized status file is ignored");
  assert.equal(huge.lastError, stoppedPreview.lastError);

  // A plausible-but-long error is bounded rather than dropped.
  await write({ services: [{ id: "backend", status: "crashed", lastError: "y".repeat(5_000) }] });
  const bounded = await managedStatus(root, stoppedPreview);
  assert.equal(bounded.status, "crashed");
  assert.equal(bounded.lastError, null, "an over-long error is discarded, not forwarded");
});

test("a stale lease is reclaimed by exactly one waiter", async () => {
  const workspace = await scratch();
  const directory = path.join(workspace, ".zelyq-previews");
  await fs.mkdir(directory, { recursive: true });
  const lock = path.join(directory, "p1.managed-lock");
  await fs.mkdir(lock);
  const old = new Date(Date.now() - 120_000);
  await fs.utimes(lock, old, old);

  // Several waiters see the same dead holder at once. Only one may run at a
  // time, or two service groups supervise one project.
  let inside = 0;
  let overlapped = false;
  await Promise.all(
    Array.from({ length: 4 }, () =>
      withManagedLock(workspace, "p1", async () => {
        inside += 1;
        if (inside > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 40));
        inside -= 1;
      }),
    ),
  );
  assert.equal(overlapped, false, "two holders ran concurrently after a stale reclaim");
});

test("an existing uv on PATH is used rather than downloaded again", async () => {
  resetToolchainProvisioning();
  const workspace = await scratch();
  const attempted: string[] = [];
  const result = await ensureUvToolchain(workspace, {
    run: async (command) => {
      attempted.push(command);
      return { exitCode: 0 }; // as if the host already has uv
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(attempted, ["uv --version"], "nothing is downloaded when uv already works");
  await assert.rejects(
    () => fs.stat(path.join(toolchainBinDir(workspace), "uv")),
    "no toolchain is installed when the host has its own",
  );
  resetToolchainProvisioning();
});

test("a failed toolchain setup is tried again, not remembered until a restart", async () => {
  // Found in review: one failure (here, a workspace it cannot write to) was
  // kept for the life of the process, so the Python stack stayed hidden.
  resetToolchainProvisioning();
  const workspace = await scratch();
  await fs.chmod(workspace, 0o500);
  try {
    const failed = await ensureUvToolchain(workspace, {
      run: async (command) => ({ exitCode: command.startsWith("uv ") ? 1 : 0 }),
    });
    assert.equal(failed.ok, false);
  } finally {
    await fs.chmod(workspace, 0o700);
  }
  // The cause is gone and uv works now.
  const retried = await ensureUvToolchain(workspace, { run: async () => ({ exitCode: 0 }) });
  assert.equal(retried.ok, true);
  resetToolchainProvisioning();
});

test("provisioning is attempted once per workspace, not per caller", async () => {
  resetToolchainProvisioning();
  const workspace = await scratch();
  let probes = 0;
  const run = async () => {
    probes += 1;
    return { exitCode: 0 };
  };
  const [a, b, c] = await Promise.all([
    ensureUvToolchain(workspace, { run }),
    ensureUvToolchain(workspace, { run }),
    ensureUvToolchain(workspace, { run }),
  ]);
  assert.deepEqual([a.ok, b.ok, c.ok], [true, true, true]);
  assert.equal(probes, 1, "three concurrent starts must not each install a toolchain");
  resetToolchainProvisioning();
});

test("a toolchain that cannot be provisioned explains why", async () => {
  resetToolchainProvisioning();
  const workspace = await scratch();
  const result = await ensureUvToolchain(workspace, {
    run: async (command) => ({ exitCode: command.startsWith("uv ") ? 1 : 0 }),
  });
  // No network in this test, so the download fails — what matters is that the
  // failure carries a reason rather than a bare "not supported".
  assert.equal(result.ok, false);
  assert.ok(result.reason && result.reason.length > 0, "a failure must say what went wrong");
  resetToolchainProvisioning();
});

test("the error tells the user what Zelyq tried, not just what they must do", () => {
  const error = managedUnsupported("this machine", "the download was blocked");
  assert.match(error.message, /Zelyq could not set up the uv toolchain/);
  assert.match(error.message, /the download was blocked/);
  // Doing it by hand is offered as a fallback, never as the first instruction.
  assert.match(error.message, /also works/);
});

test("project commands look in Zelyq's toolchain before the rest of PATH", () => {
  const resolved = toolchainPath("/srv/zelyq", "/usr/bin:/bin");
  assert.ok(resolved.startsWith(toolchainBinDir("/srv/zelyq")));
  assert.ok(resolved.endsWith("/usr/bin:/bin"), "the host's own PATH is kept after ours");
});

test("commands never get FORCE_COLOR, which forces colour whatever its value", async () => {
  // ruff read FORCE_COLOR=0 as "colour on" and outranked NO_COLOR, filling
  // every Python check with escape codes.
  const { agentCommandEnv } = await import("../src/local.js");
  const env = agentCommandEnv();
  assert.equal("FORCE_COLOR" in env, false);
  assert.equal(env.NO_COLOR, "1");
});
