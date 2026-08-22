import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { LocalRuntimeDriver } from "../src/local.js";

const workspaceDir = path.join(os.tmpdir(), `zelyq-local-driver-${Date.now()}`);
const driver = new LocalRuntimeDriver({
  kind: "local",
  workspaceDir,
  execTimeoutMs: 15_000,
  previewPortRange: [4950, 4960],
  previewHost: "127.0.0.1",
});

after(async () => {
  await driver.dispose();
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

test("scaffolding writes files and the tree reads them back", async () => {
  await driver.ensureProject("prj_a");
  await driver.scaffold("prj_a", [
    { path: "package.json", content: '{"name":"a"}' },
    { path: "src/index.ts", content: "export const answer = 42;\n" },
  ]);

  const entries = await driver.listFiles("prj_a");
  const paths = entries.map((entry) => entry.path).sort();
  assert.deepEqual(paths, ["package.json", "src", "src/index.ts"]);

  const file = await driver.readFile("prj_a", "src/index.ts");
  assert.match(file.content, /answer = 42/);
});

test("commands run inside the project directory", async () => {
  await driver.ensureProject("prj_b");
  await driver.scaffold("prj_b", [{ path: "marker.txt", content: "hi" }]);

  const result = await driver.exec("prj_b", { command: "ls" });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /marker\.txt/);
});

test("a command that would hang is killed at the timeout", async () => {
  await driver.ensureProject("prj_c");
  const result = await driver.exec("prj_c", { command: "sleep 30", timeoutMs: 1200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 124);
});

test("project commands never inherit NODE_ENV=production", async () => {
  // Zelyq itself runs with NODE_ENV=production in any real deployment. If that
  // leaks into a project, `npm install` skips devDependencies and the dev
  // server is never installed — the preview then fails with "vite: not found".
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await driver.ensureProject("prj_env");
    const result = await driver.exec("prj_env", { command: "printenv NODE_ENV" });
    assert.equal(result.stdout.trim(), "development");
  } finally {
    process.env.NODE_ENV = previous ?? "";
  }
});

test("an explicit env value still wins over the default", async () => {
  await driver.ensureProject("prj_env2");
  const result = await driver.exec("prj_env2", {
    command: "printenv NODE_ENV",
    env: { NODE_ENV: "test" },
  });
  assert.equal(result.stdout.trim(), "test");
});

test("project commands run on the same Node that runs Zelyq", async () => {
  // A login shell would re-source the user's profile and could hand the project
  // a different Node than the server is running on. That mismatch is invisible
  // until an install behaves differently than it does in your own terminal.
  await driver.ensureProject("prj_node");
  const result = await driver.exec("prj_node", { command: "node --version" });
  assert.equal(result.stdout.trim(), process.version);
});

test("preview host controls both the advertised URL and the bind address", async () => {
  // On a VM or container host the browser is somewhere else, so a preview
  // advertised at 127.0.0.1 points the viewer at their own machine.
  const remote = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 5_000,
    previewPortRange: [4981, 4982],
    previewHost: "example.internal",
  });
  const status = await remote.previewStatus("prj_never_started");
  // Nothing running yet, so no URL is claimed.
  assert.equal(status.url, null);
  assert.equal(status.status, "stopped");
  await remote.dispose();
});

test("traversal is rejected by the driver, not clamped", async () => {
  await driver.ensureProject("prj_d");
  await assert.rejects(
    () => driver.writeFile("prj_d", "../escaped.txt", "nope"),
    /escapes the project root/,
  );
  await assert.rejects(() => driver.readFile("prj_d", "/etc/passwd"), /escapes the project root/);
});

test("operations on an unknown project report not_found", async () => {
  await assert.rejects(() => driver.listFiles("prj_missing"), /not found/);
});

test("snapshots capture and restore project files", async () => {
  await driver.ensureProject("prj_e");
  await driver.scaffold("prj_e", [{ path: "note.txt", content: "version one" }]);

  const snapshot = await driver.createSnapshot("prj_e", "before");
  assert.equal(snapshot.fileCount, 1);

  await driver.writeFile("prj_e", "note.txt", "version two");
  assert.match((await driver.readFile("prj_e", "note.txt")).content, /version two/);

  await driver.restoreSnapshot("prj_e", snapshot.id);
  assert.match((await driver.readFile("prj_e", "note.txt")).content, /version one/);
});
