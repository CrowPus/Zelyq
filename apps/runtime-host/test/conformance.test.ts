import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  ContainerRuntimeDriver,
  LocalRuntimeDriver,
  RemoteRuntimeDriver,
  type RuntimeDriver,
} from "@zelyq/runtime";
import { buildHost, type RuntimeHost } from "../src/app.js";

/**
 * The conformance suite.
 *
 * `RuntimeDriver` is the most load-bearing interface in Zelyq, and until now it
 * had one implementation that anybody exercised. An interface with one
 * implementation is a guess: the second one is where you find out which of your
 * assumptions were really about the first.
 *
 * So every assertion below runs twice, unchanged — once against the local driver
 * and once against a remote driver pointed at the reference host. Anything that
 * passes one and fails the other is either a protocol gap or a lie in
 * `docs/runtime-protocol.md`.
 */

const scratch = path.join(os.tmpdir(), `zelyq-conformance-${Date.now()}`);
const localWorkspace = path.join(scratch, "local");
const containerWorkspace = path.join(scratch, "container");
const hostWorkspace = path.join(scratch, "host");
const TOKEN = "conformance-token";

let host: RuntimeHost;
let hostUrl: string;

before(async () => {
  await fs.mkdir(localWorkspace, { recursive: true });
  await fs.mkdir(hostWorkspace, { recursive: true });
  await fs.mkdir(containerWorkspace, { recursive: true });

  host = buildHost({
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    token: TOKEN,
    runtime: {
      kind: "local",
      workspaceDir: hostWorkspace,
      execTimeoutMs: 20_000,
      previewPortRange: [4820, 4829],
      previewHost: "127.0.0.1",
    },
  });
  await host.app.listen({ host: "127.0.0.1", port: 0 });
  const address = host.app.server.address();
  assert.ok(address && typeof address === "object", "expected a bound address");
  hostUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await host?.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

function drivers(): Array<{ name: string; make(): RuntimeDriver }> {
  const list: Array<{ name: string; make(): RuntimeDriver }> = [
    {
      name: "local",
      make: () =>
        new LocalRuntimeDriver({
          kind: "local",
          workspaceDir: localWorkspace,
          execTimeoutMs: 20_000,
          previewPortRange: [4810, 4819],
          previewHost: "127.0.0.1",
        }),
    },
    {
      name: "remote (reference host)",
      make: () =>
        new RemoteRuntimeDriver({
          kind: "remote",
          workspaceDir: "unused",
          url: hostUrl,
          token: TOKEN,
          execTimeoutMs: 20_000,
          previewPortRange: [4820, 4829],
          previewHost: "127.0.0.1",
        }),
    },
  ];

  // The suite exists to prove the drivers are interchangeable, so a driver that
  // opts out of it proves nothing. Included only when an engine is present:
  // `packages/runtime/test/container-driver.test.ts` is what fails CI if an
  // engine is missing, so the gap cannot go unnoticed.
  if (containerEngineAvailable()) {
    list.push({
      name: "container",
      make: () =>
        new ContainerRuntimeDriver({
          kind: "container",
          workspaceDir: containerWorkspace,
          execTimeoutMs: 60_000,
          previewPortRange: [4830, 4839],
          previewHost: "127.0.0.1",
        }),
    });
  }

  return list;
}

function containerEngineAvailable(): boolean {
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

for (const { name, make } of drivers()) {
  describe(`RuntimeDriver conformance — ${name}`, () => {
    test("creating a project is idempotent and reports a root", async () => {
      const driver = make();
      const first = await driver.ensureProject("prj_conform");
      const second = await driver.ensureProject("prj_conform");
      assert.equal(first.projectId, "prj_conform");
      assert.equal(second.root, first.root);
      assert.ok(first.root.length > 0);
      await driver.dispose();
    });

    test("scaffolded files read back, and the tree lists them", async () => {
      const driver = make();
      await driver.ensureProject("prj_files");
      await driver.scaffold("prj_files", [
        { path: "package.json", content: '{"name":"c"}' },
        { path: "src/main.ts", content: "export const answer = 42;\n" },
      ]);

      const file = await driver.readFile("prj_files", "src/main.ts");
      assert.match(file.content, /answer = 42/);
      assert.equal(file.encoding, "utf8");

      const paths = (await driver.listFiles("prj_files")).map((entry) => entry.path).sort();
      assert.deepEqual(paths, ["package.json", "src", "src/main.ts"]);
      await driver.dispose();
    });

    test("writing and deleting a file both take effect", async () => {
      const driver = make();
      await driver.ensureProject("prj_write");
      await driver.writeFile("prj_write", "note.txt", "first");
      assert.equal((await driver.readFile("prj_write", "note.txt")).content, "first");

      await driver.writeFile("prj_write", "note.txt", "second");
      assert.equal((await driver.readFile("prj_write", "note.txt")).content, "second");

      await driver.deleteFile("prj_write", "note.txt");
      await assert.rejects(() => driver.readFile("prj_write", "note.txt"));
      await driver.dispose();
    });

    test("base64 survives the round trip", async () => {
      const driver = make();
      await driver.ensureProject("prj_binary");
      const bytes = Buffer.from([0, 1, 2, 250, 251, 252]).toString("base64");
      await driver.writeFile("prj_binary", "blob.bin", bytes, "base64");

      const read = await driver.readFile("prj_binary", "blob.bin");
      assert.equal(read.encoding, "base64");
      assert.equal(read.content, bytes);
      await driver.dispose();
    });

    test("commands run in the project and report their exit code", async () => {
      const driver = make();
      await driver.ensureProject("prj_exec");
      await driver.scaffold("prj_exec", [{ path: "marker.txt", content: "here" }]);

      const ok = await driver.exec("prj_exec", { command: "cat marker.txt" });
      assert.equal(ok.exitCode, 0);
      assert.match(ok.stdout, /here/);

      const bad = await driver.exec("prj_exec", { command: "exit 3" });
      assert.equal(bad.exitCode, 3);
      await driver.dispose();
    });

    test("a command that would hang is killed at the timeout", async () => {
      const driver = make();
      await driver.ensureProject("prj_timeout");
      const result = await driver.exec("prj_timeout", { command: "sleep 30", timeoutMs: 1500 });
      assert.equal(result.timedOut, true);
      await driver.dispose();
    });

    test("traversal is rejected rather than clamped", async () => {
      const driver = make();
      await driver.ensureProject("prj_escape");
      // The protocol calls this out explicitly: silently writing elsewhere is a
      // vulnerability, so the only correct answer is a refusal.
      await assert.rejects(
        () => driver.writeFile("prj_escape", "../escaped.txt", "nope"),
        "writing outside the project root must be refused",
      );
      await assert.rejects(() => driver.readFile("prj_escape", "../../etc/passwd"));
      await driver.dispose();
    });

    test("an unknown project reports not_found", async () => {
      const driver = make();
      await assert.rejects(
        () => driver.readFile("prj_missing_entirely", "any.txt"),
        (error: Error & { code?: string }) =>
          error.code === "not_found" || /not.?found/i.test(error.message),
      );
      await driver.dispose();
    });

    test("deleting a project that does not exist succeeds", async () => {
      const driver = make();
      await driver.removeProject("prj_never_existed");
      await driver.dispose();
    });

    test("snapshots capture, read back and restore", async () => {
      const driver = make();
      await driver.ensureProject("prj_snap");
      await driver.writeFile("prj_snap", "story.txt", "chapter one");

      const snapshot = await driver.createSnapshot("prj_snap", "before");
      assert.ok(snapshot.id.length > 0);
      assert.equal(snapshot.projectId, "prj_snap");

      await driver.writeFile("prj_snap", "story.txt", "chapter two");
      const asItWas = await driver.readSnapshotFile("prj_snap", snapshot.id, "story.txt");
      assert.equal(asItWas.content, "chapter one");

      await driver.restoreSnapshot("prj_snap", snapshot.id);
      assert.equal((await driver.readFile("prj_snap", "story.txt")).content, "chapter one");
      await driver.dispose();
    });

    test("a preview that was never started reads as stopped", async () => {
      const driver = make();
      await driver.ensureProject("prj_nopreview");
      const preview = await driver.previewStatus("prj_nopreview");
      assert.equal(preview.status, "stopped");
      assert.equal(preview.url, null);
      await driver.dispose();
    });

    test("health reports the runtime as reachable", async () => {
      const driver = make();
      const health = await driver.health();
      assert.equal(health.ok, true);
      await driver.dispose();
    });
  });
}
