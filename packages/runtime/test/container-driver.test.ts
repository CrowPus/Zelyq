import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ContainerRuntimeDriver, containerCwd, containerName } from "../src/container.js";
import { LocalRuntimeDriver } from "../src/local.js";

/**
 * The container driver is a security control, so these tests are written the
 * way a security control has to be verified: **every isolation claim is run
 * against the local driver too, and must fail there.**
 *
 * `017` made it binding that a check which has never reported a failure is
 * assumed broken. A sandbox test that passes because the probe could not have
 * worked either way — a `curl` that is not installed, a path that never existed
 * — is exactly that, and an earlier version of this file had one.
 */

const scratch = path.join(os.tmpdir(), `zelyq-container-test-${Date.now()}`);
const HOST_SERVICE_PORT = 4795;

function engineAvailable(): boolean {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "pipe",
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

const hasEngine = engineAvailable();

function config(kind: "local" | "container") {
  return {
    kind,
    workspaceDir: scratch,
    execTimeoutMs: 60_000,
    previewPortRange: [4780, 4789] as [number, number],
    previewHost: "127.0.0.1",
  };
}

let hostService: http.Server;

before(async () => {
  await fs.mkdir(path.join(scratch, "prj_victim"), { recursive: true });
  await fs.writeFile(path.join(scratch, "prj_victim", "secret.txt"), "other project's data\n");

  // Stands in for the internal service an operator would have on loopback.
  hostService = http.createServer((_, response) => response.end("HOST SERVICE REACHED"));
  await new Promise<void>((resolve) => hostService.listen(HOST_SERVICE_PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise<void>((resolve) => hostService?.close(() => resolve()));
  if (hasEngine) {
    const driver = new ContainerRuntimeDriver(config("container"));
    await driver.removeProject("prj_attacker").catch(() => undefined);
    await driver.dispose().catch(() => undefined);
  }
  await fs.rm(scratch, { recursive: true, force: true });
});

/** Runs one probe against both drivers and returns what each saw. */
async function bothDrivers(command: string): Promise<{ container: string; local: string }> {
  const container = new ContainerRuntimeDriver(config("container"));
  const local = new LocalRuntimeDriver(config("local"));
  try {
    await container.ensureProject("prj_attacker");
    await local.ensureProject("prj_attacker");
    const inside = await container.exec("prj_attacker", { command });
    const outside = await local.exec("prj_attacker", { command });
    return { container: inside.stdout.trim(), local: outside.stdout.trim() };
  } finally {
    await container.dispose().catch(() => undefined);
    await local.dispose().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// No engine needed
// ---------------------------------------------------------------------------

test("a working directory that climbs out of the project is refused", () => {
  assert.equal(containerCwd(undefined), "/workspace");
  assert.equal(containerCwd("."), "/workspace");
  assert.equal(containerCwd("src"), "/workspace/src");
  assert.equal(containerCwd("./src/app"), "/workspace/src/app");
  assert.equal(containerCwd("src/nested/.."), "/workspace/src");

  // Refused rather than clamped. Clamping would run the command somewhere the
  // caller did not ask for, and the caller is a language model.
  assert.throws(() => containerCwd("../elsewhere"), /escapes the project/i);
  assert.throws(() => containerCwd("src/../../elsewhere"), /escapes the project/i);
  assert.throws(() => containerCwd("/etc"), /must be relative/i);
});

test("a container name is safe to hand to the engine", () => {
  assert.equal(containerName("prj_abc123"), "zelyq-prj_abc123");
  assert.match(containerName("../../etc/passwd"), /^zelyq-[a-zA-Z0-9_.-]+$/);
  assert.match(containerName("a b;rm -rf /"), /^zelyq-[a-zA-Z0-9_.-]+$/);
});

test("CI must have a container engine, so the isolation tests cannot silently skip", () => {
  if (!process.env.CI) return;
  assert.ok(
    hasEngine,
    "CI has no container engine, so every isolation test below skipped. " +
      "A security control whose tests do not run is not a security control.",
  );
});

// ---------------------------------------------------------------------------
// Engine needed. Each asserts the local driver fails the same probe.
// ---------------------------------------------------------------------------

test("a command cannot read another project's files", { skip: !hasEngine }, async () => {
  // Asserts on the secret's *contents*, not on one path to it.
  //
  // The first version of this test ran `cat ../prj_victim/secret.txt` and was
  // shown by mutation to be worthless: widening the bind mount to the whole
  // workspace moved the victim to `prj_victim/secret.txt`, the hard-coded path
  // stopped resolving, and the test passed while the isolation was broken. A
  // probe that only knows one way out proves nothing about the others.
  const probe =
    "for p in ../prj_victim/secret.txt prj_victim/secret.txt " +
    "../../prj_victim/secret.txt /workspace/prj_victim/secret.txt; do " +
    'cat "$p" 2>/dev/null; done; ' +
    // And a sweep, in case the mount is somewhere none of those name.
    'grep -rl "other project\'s data" / 2>/dev/null | head -1';
  const seen = await bothDrivers(probe);

  assert.doesNotMatch(seen.container, /other project's data|prj_victim/, "the container read it");
  // The control: without it, this passes on a driver that cannot run anything.
  assert.match(seen.local, /other project's data/, "the local driver was expected to read it");
});

test("a command cannot see the host's home directory", { skip: !hasEngine }, async () => {
  const seen = await bothDrivers(`ls ${os.homedir()} 2>&1 | head -1`);

  assert.match(seen.container, /No such file|cannot access/i, `container saw: ${seen.container}`);
  assert.doesNotMatch(seen.local, /No such file|cannot access/i, "the host's home should be there");
});

test("a command cannot reach a service on the host's loopback", { skip: !hasEngine }, async () => {
  // node, not curl. curl is absent from the image, so a curl-based probe would
  // "pass" for the wrong reason — which is how the first version of this test
  // was written and why it proved nothing.
  const probe =
    `node -e "fetch('http://127.0.0.1:${HOST_SERVICE_PORT}')` +
    `.then(r=>r.text()).then(t=>console.log(t))` +
    `.catch(e=>console.log('BLOCKED: '+e.message))" 2>&1 | head -1`;
  const seen = await bothDrivers(probe);

  assert.doesNotMatch(seen.container, /HOST SERVICE REACHED/, "the container reached the host");
  assert.match(seen.local, /HOST SERVICE REACHED/, "the local driver was expected to reach it");
});

test("files written inside are owned by the host user", { skip: !hasEngine }, async () => {
  // The failure this design is most likely to have: a container running as root
  // writes root-owned files into the bind mount, and Zelyq can no longer read
  // its own workspace. Everything else works right up until it does not.
  const driver = new ContainerRuntimeDriver(config("container"));
  try {
    await driver.ensureProject("prj_attacker");
    const wrote = await driver.exec("prj_attacker", {
      command: "echo 'written inside' > from-container.txt",
    });
    assert.equal(wrote.exitCode, 0, wrote.stderr);

    const read = await driver.readFile("prj_attacker", "from-container.txt");
    assert.match(read.content, /written inside/);

    const stat = await fs.stat(path.join(scratch, "prj_attacker", "from-container.txt"));
    assert.equal(stat.uid, process.getuid?.(), "the file is not owned by the user Zelyq runs as");
  } finally {
    await driver.dispose().catch(() => undefined);
  }
});

test("the health check reports the engine, and fails without one", {
  skip: !hasEngine,
}, async () => {
  const ok = new ContainerRuntimeDriver(config("container"));
  const healthy = await ok.health();
  assert.equal(healthy.ok, true, healthy.detail);
  assert.match(healthy.detail, /docker/);
  await ok.dispose();

  // A driver pointed at an engine that is not there must say so rather than
  // fail later on somebody's first prompt.
  const broken = new ContainerRuntimeDriver(config("container"), { engine: "definitely-not-here" });
  const unhealthy = await broken.health();
  assert.equal(unhealthy.ok, false);
  assert.match(unhealthy.detail, /not usable|cannot run/i);
});
