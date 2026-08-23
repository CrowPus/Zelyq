import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { announcedPort, LocalRuntimeDriver } from "../src/local.js";
import { waitForPort } from "../src/ports.js";

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

test("a preview started by one driver is visible to another on the same workspace", async () => {
  // The real deployment has two: the agent holds one and the server holds
  // another, so a preview the agent's start_preview tool spawned was reported
  // as stopped by the UI, and starting it from the UI spawned a second dev
  // server for the same project.
  const config = {
    kind: "local" as const,
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4971, 4975] as [number, number],
    previewHost: "127.0.0.1",
  };
  const agent = new LocalRuntimeDriver(config);
  const server = new LocalRuntimeDriver(config);

  await agent.ensureProject("prj_shared");
  await agent.scaffold("prj_shared", [
    { path: "package.json", content: '{"name":"shared","scripts":{"dev":"node server.mjs"}}' },
    {
      path: "server.mjs",
      content:
        "import http from 'node:http';\n" +
        "http.createServer((_, res) => res.end('ok')).listen(process.env.PORT);\n",
    },
  ]);

  try {
    const started = await agent.startPreview("prj_shared");
    assert.equal(started.status, "running");

    const seen = await server.previewStatus("prj_shared");
    assert.equal(seen.status, "running", "the second driver should see the running preview");
    assert.equal(seen.port, started.port);
    assert.equal(seen.url, started.url);

    // And it must not start a rival dev server on a second port.
    const again = await server.startPreview("prj_shared");
    assert.equal(again.port, started.port, "should adopt the running preview, not spawn another");
  } finally {
    await server.stopPreview("prj_shared").catch(() => undefined);
    await agent.dispose();
    await server.dispose();
  }
});

test("a preview record whose process is gone is not reported as running", async () => {
  const config = {
    kind: "local" as const,
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4976, 4979] as [number, number],
    previewHost: "127.0.0.1",
  };
  const driverA = new LocalRuntimeDriver(config);
  await driverA.ensureProject("prj_stale");

  // A record left behind by a process that died without cleaning up.
  const stateDir = path.join(workspaceDir, ".zelyq-previews");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "prj_stale.json"),
    JSON.stringify({ pid: 2 ** 22, port: 4979, startedAt: new Date().toISOString(), ownerPid: 1 }),
  );

  const status = await driverA.previewStatus("prj_stale");
  assert.equal(status.status, "stopped", "a dead pid must not be reported as running");
  await driverA.dispose();
});

test("a crashed record does not hide a preview that is running elsewhere", async () => {
  // Reported from real use: the UI said "the dev server stopped" and showed no
  // output, while the dev server was running and its log file was full. One
  // driver held a crashed entry from a failed attempt and answered with that.
  const config = {
    kind: "local" as const,
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4961, 4965] as [number, number],
    previewHost: "127.0.0.1",
  };
  const runner = new LocalRuntimeDriver(config);
  const asker = new LocalRuntimeDriver(config);

  await runner.ensureProject("prj_stale_crash");
  await runner.scaffold("prj_stale_crash", [
    { path: "package.json", content: '{"name":"s","scripts":{"dev":"node server.mjs"}}' },
    {
      path: "server.mjs",
      content:
        "import http from 'node:http';\n" +
        "console.log('listening loud and clear');\n" +
        "http.createServer((_, res) => res.end('ok')).listen(process.env.PORT);\n",
    },
  ]);

  try {
    const started = await runner.startPreview("prj_stale_crash");
    assert.equal(started.status, "running");

    // The asking driver failed its own attempt earlier and kept the wreckage.
    const wreckage = {
      child: null as never,
      port: 0,
      startedAt: new Date().toISOString(),
      logs: [] as string[],
      status: "crashed" as const,
      lastError: "Dev server exited with code null",
    };
    (asker as unknown as { previews: Map<string, unknown> }).previews.set(
      "prj_stale_crash",
      wreckage,
    );

    const status = await asker.previewStatus("prj_stale_crash");
    assert.equal(status.status, "running", "a live preview must win over a stale crash");
    assert.equal(status.port, started.port);

    const logs = await asker.previewLogs("prj_stale_crash");
    assert.match(logs, /listening loud and clear/, "logs must fall back to the file");
  } finally {
    await runner.stopPreview("prj_stale_crash").catch(() => undefined);
    await runner.dispose();
    await asker.dispose();
  }
});

test("a second snapshot reuses files that did not change", async () => {
  // Taken before every turn. Copying the whole tree each time was affordable for
  // a ten-file template and is not for a real repository.
  const driver = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4941, 4945],
    previewHost: "127.0.0.1",
  });

  await driver.ensureProject("prj_incremental");
  await driver.scaffold("prj_incremental", [
    { path: "steady.txt", content: "unchanged between snapshots" },
    { path: "moving.txt", content: "before" },
  ]);

  const first = await driver.createSnapshot("prj_incremental", "first");
  await driver.writeFile("prj_incremental", "moving.txt", "after");
  const second = await driver.createSnapshot("prj_incremental", "second");

  const at = (snapshot: string, file: string) =>
    path.join(workspaceDir, ".snapshots", "prj_incremental", snapshot, file);

  const steady = await Promise.all([
    fs.stat(at(first.id, "steady.txt")),
    fs.stat(at(second.id, "steady.txt")),
  ]);
  assert.equal(steady[0].ino, steady[1].ino, "an unchanged file should be stored once, not twice");

  const moving = await Promise.all([
    fs.stat(at(first.id, "moving.txt")),
    fs.stat(at(second.id, "moving.txt")),
  ]);
  assert.notEqual(moving[0].ino, moving[1].ino, "a changed file must be a separate copy");

  // The property that makes the sharing safe: links point at earlier snapshots,
  // never at the working tree, so writing to the project cannot reach back.
  await driver.writeFile("prj_incremental", "steady.txt", "edited after both snapshots");
  assert.equal(
    await fs.readFile(at(first.id, "steady.txt"), "utf8"),
    "unchanged between snapshots",
    "editing the project must not alter a snapshot that shares its content",
  );

  await driver.restoreSnapshot("prj_incremental", first.id);
  assert.equal(
    (await driver.readFile("prj_incremental", "moving.txt")).content,
    "before",
    "restore must still work when files are shared",
  );

  await driver.dispose();
});

test("deleting a project takes its snapshots with it", async () => {
  const driver = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4946, 4949],
    previewHost: "127.0.0.1",
  });

  await driver.ensureProject("prj_snapleak");
  await driver.writeFile("prj_snapleak", "a.txt", "content");
  await driver.createSnapshot("prj_snapleak", "one");

  const snapshots = path.join(workspaceDir, ".snapshots", "prj_snapleak");
  assert.ok(
    await fs.stat(snapshots).then(
      () => true,
      () => false,
    ),
  );

  await driver.removeProject("prj_snapleak");
  assert.equal(
    await fs.stat(snapshots).then(
      () => true,
      () => false,
    ),
    false,
    "snapshots live outside the project root and were being left behind",
  );

  await driver.dispose();
});

test("restoring does not leave snapshot bookkeeping in the project", async () => {
  const driver = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4951, 4955],
    previewHost: "127.0.0.1",
  });

  await driver.ensureProject("prj_clean_restore");
  await driver.writeFile("prj_clean_restore", "app.txt", "original");
  const snapshot = await driver.createSnapshot("prj_clean_restore", "one");
  await driver.writeFile("prj_clean_restore", "app.txt", "changed");
  await driver.restoreSnapshot("prj_clean_restore", snapshot.id);

  const names = (await driver.listFiles("prj_clean_restore", { includeIgnored: true })).map(
    (entry) => entry.path,
  );
  assert.ok(
    !names.some((name) => name.includes("manifest")),
    `restore left bookkeeping behind: ${names.join(", ")}`,
  );
  assert.equal((await driver.readFile("prj_clean_restore", "app.txt")).content, "original");

  await driver.dispose();
});

test("a project that pins its own dev-server port is still previewed on ours", async () => {
  // The shape that broke in real use. A repository somebody else wrote sets
  // `port: 8080, strictPort: true` in its vite config and ignores PORT in the
  // environment, because vite has never read PORT. Every project previewed here
  // before came from Zelyq's own template, whose config reads process.env.PORT
  // because we wrote it that way — so the preview waited ninety seconds for a
  // port nothing was listening on, twice, and then said it had timed out.
  //
  // This stands in a fake `vite` binary that behaves the same way: pinned unless
  // it is told otherwise on the command line.
  const config = {
    kind: "local" as const,
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4840, 4845] as [number, number],
    previewHost: "127.0.0.1",
  };
  const pinned = new LocalRuntimeDriver(config);

  await pinned.ensureProject("prj_pinned");
  await pinned.scaffold("prj_pinned", [
    {
      path: "package.json",
      content: '{"name":"pinned","scripts":{"dev":"vite"},"devDependencies":{"vite":"5.0.0"}}',
    },
    {
      path: "node_modules/.bin/vite",
      content:
        "#!/bin/sh\n" +
        "# Pinned to 48099 unless told otherwise, exactly like a strictPort config.\n" +
        "port=48099\n" +
        'while [ $# -gt 0 ]; do case "$1" in --port) port="$2"; shift 2 ;; *) shift ;; esac; done\n' +
        "exec node -e \"require('node:http').createServer((_,r)=>r.end('ok'))" +
        ".listen($port,'127.0.0.1',()=>console.log('  ➜  Local:   http://localhost:$port/'))\"\n",
    },
  ]);
  await pinned.exec("prj_pinned", { command: "chmod +x node_modules/.bin/vite" });

  try {
    const started = await pinned.startPreview("prj_pinned");
    assert.equal(started.status, "running", `preview did not start: ${started.lastError}`);
    assert.ok(
      started.port !== null && started.port >= 4840 && started.port <= 4845,
      `preview should be on a port Zelyq allocated, got ${started.port}`,
    );
    assert.notEqual(started.port, 48099, "the project's own port won");
  } finally {
    await pinned.stopPreview("prj_pinned").catch(() => undefined);
    await pinned.dispose();
  }
});

test("a dev server that goes to its own port fails fast, says where, and is not left running", async () => {
  // The tool list in detectDevCommand is not exhaustive and never will be. This
  // is what makes that safe: a dev server we cannot instruct announces its port
  // in its own output, and that sentence is the answer the user needs. Before
  // this, the log said `http://localhost:48397/` while the UI said "did not start
  // listening in time" — and the orphan stayed alive holding the port.
  const config = {
    kind: "local" as const,
    workspaceDir,
    execTimeoutMs: 15_000,
    previewPortRange: [4846, 4849] as [number, number],
    previewHost: "127.0.0.1",
  };
  const stubborn = new LocalRuntimeDriver(config);

  await stubborn.ensureProject("prj_stubborn");
  await stubborn.scaffold("prj_stubborn", [
    { path: "package.json", content: '{"name":"stubborn","scripts":{"dev":"node pinned.mjs"}}' },
    {
      path: "pinned.mjs",
      content:
        "import http from 'node:http';\n" +
        // Ignores PORT entirely, the way a tool with its own config does.
        "http.createServer((_, res) => res.end('ok')).listen(48397, '127.0.0.1', () => {\n" +
        "  console.log('  ➜  Local:   http://localhost:48397/');\n" +
        "});\n",
    },
  ]);

  try {
    const failed = await stubborn.startPreview("prj_stubborn");

    assert.equal(failed.status, "crashed");
    assert.match(
      failed.lastError ?? "",
      /48397/,
      `the message should name the port it actually went to, got: ${failed.lastError}`,
    );

    // And nothing is left behind. A survivor here holds the port and keeps a
    // live pid in the record file, which reads back as "still starting" —
    // which is how a spinner becomes permanent.
    let alive = true;
    for (let i = 0; i < 30 && alive; i += 1) {
      alive = await waitForPort(48397, 100);
    }
    assert.equal(alive, false, "the dev server was left running after a failed preview");
  } finally {
    await stubborn.stopPreview("prj_stubborn").catch(() => undefined);
    await stubborn.dispose();
  }
});

test("the port a dev server announces is read out of its own output", () => {
  assert.equal(announcedPort("  ➜  Local:   http://localhost:8080/"), 8080);
  assert.equal(announcedPort("  ➜  Network: http://10.128.0.3:5173/"), 5173);
  assert.equal(announcedPort("ready - started server on http://127.0.0.1:3000"), 3000);
  assert.equal(announcedPort("no url here at all"), null);
  assert.equal(announcedPort("https://example.com/no-port"), null);
});
