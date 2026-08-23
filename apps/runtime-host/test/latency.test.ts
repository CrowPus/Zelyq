import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { LocalRuntimeDriver, RemoteRuntimeDriver } from "@zelyq/runtime";
import { buildHost, type RuntimeHost } from "../src/app.js";

/**
 * What the protocol costs.
 *
 * The Principal AI Engineer's condition for approving this work: a turn makes
 * twenty or so tool calls, and every one becomes an HTTP round-trip instead of a
 * filesystem call. If that overhead is large, the agent gets slower and nobody
 * would know why. This measures it rather than assuming.
 */

const scratch = path.join(os.tmpdir(), `zelyq-latency-${Date.now()}`);
let host: RuntimeHost;
let url: string;

before(async () => {
  await fs.mkdir(path.join(scratch, "local"), { recursive: true });
  await fs.mkdir(path.join(scratch, "host"), { recursive: true });
  host = buildHost({
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    token: undefined,
    runtime: {
      kind: "local",
      workspaceDir: path.join(scratch, "host"),
      execTimeoutMs: 20_000,
      previewPortRange: [4850, 4859],
      previewHost: "127.0.0.1",
    },
  });
  await host.app.listen({ host: "127.0.0.1", port: 0 });
  const address = host.app.server.address() as { port: number };
  url = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await host?.close();
  await fs.rm(scratch, { recursive: true, force: true });
});

test("the protocol's overhead per tool call is small enough to ignore", async () => {
  const local = new LocalRuntimeDriver({
    kind: "local",
    workspaceDir: path.join(scratch, "local"),
    execTimeoutMs: 20_000,
    previewPortRange: [4860, 4869],
    previewHost: "127.0.0.1",
  });
  const remote = new RemoteRuntimeDriver({
    kind: "remote",
    workspaceDir: "unused",
    url,
    execTimeoutMs: 20_000,
    previewPortRange: [4850, 4859],
    previewHost: "127.0.0.1",
  });

  const body = "export const x = 1;\n".repeat(200);
  for (const driver of [local, remote]) {
    await driver.ensureProject("prj_latency");
    await driver.writeFile("prj_latency", "src/file.ts", body);
  }

  const time = async (run: () => Promise<unknown>, runs = 60): Promise<number> => {
    await run(); // warm
    const started = performance.now();
    for (let i = 0; i < runs; i++) await run();
    return (performance.now() - started) / runs;
  };

  const localRead = await time(() => local.readFile("prj_latency", "src/file.ts"));
  const remoteRead = await time(() => remote.readFile("prj_latency", "src/file.ts"));
  const overhead = remoteRead - localRead;

  console.log(
    `    read_file: local ${localRead.toFixed(2)}ms · remote ${remoteRead.toFixed(2)}ms · ` +
      `overhead ${overhead.toFixed(2)}ms · a 20-call turn pays ${(overhead * 20).toFixed(0)}ms`,
  );

  // A turn takes minutes. Anything under 10ms a call is 200ms across a whole
  // turn, which is not the reason anybody would call the agent slow.
  assert.ok(
    overhead < 10,
    `the protocol adds ${overhead.toFixed(2)}ms per call, which is enough to notice across a turn`,
  );

  await local.dispose();
  await remote.dispose();
});
