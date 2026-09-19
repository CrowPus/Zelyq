import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ContainerRuntimeDriver } from "../src/container.js";
import { MANAGED_CAPABILITY, resetManagedCapabilities } from "../src/managed.js";

/**
 * A stand-in container engine: the sandbox image does not exist yet, and
 * building it takes several seconds. Everything else answers at once.
 */
async function slowBuildEngine(dir: string): Promise<string> {
  const engine = path.join(dir, "docker");
  await fs.writeFile(
    engine,
    [
      "#!/bin/sh",
      'case "$1" in',
      "  version) echo 99.0.0 ;;",
      "  image) exit 1 ;;",
      "  build) sleep 6 ;;",
      "  run) echo 'uv 0.12.16' ;;",
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  await fs.chmod(engine, 0o755);
  return engine;
}

test("health does not wait out a sandbox image build, and still offers Python", {
  skip: process.platform === "win32",
}, async () => {
  // Found in review: the probe built the image first, so on a fresh install
  // the first page load and the server's health check hung for the build.
  resetManagedCapabilities();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zelyq-capability-"));
  const driver = new ContainerRuntimeDriver(
    {
      kind: "container",
      workspaceDir: path.join(dir, "workspace"),
      execTimeoutMs: 10_000,
      previewPortRange: [4921, 4925],
      previewHost: "127.0.0.1",
    },
    { engine: await slowBuildEngine(dir) },
  );
  try {
    const started = Date.now();
    const health = await driver.health();
    assert.ok(Date.now() - started < 5_000, `health took ${Date.now() - started} ms`);
    assert.deepEqual(health.capabilities, [MANAGED_CAPABILITY]);
  } finally {
    await driver.dispose();
    resetManagedCapabilities();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
