import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import type { Preview } from "@zelyq/core";
import { RemoteRuntimeDriver } from "../src/remote.js";

/**
 * A stand-in runtime host. It answers every preview route with the address a
 * host actually sees — its own bind address — which is the whole reason the
 * template exists: that address means nothing to a browser on the other side
 * of a reverse proxy.
 */
function hostAnswering(preview: Partial<Preview>): Promise<{ url: string; close: () => void }> {
  const body: Preview = {
    projectId: "prj_1",
    status: "running",
    url: "http://0.0.0.0:4310",
    port: 4310,
    pid: 42,
    startedAt: new Date().toISOString(),
    lastError: null,
    ...preview,
  };
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const base = { kind: "remote", workspaceDir: "/tmp", execTimeoutMs: 5_000 } as const;

test("a configured template decides the preview address, not the host's own", async () => {
  const host = await hostAnswering({});
  after(host.close);
  const driver = new RemoteRuntimeDriver({
    ...base,
    url: host.url,
    previewUrlTemplate: "https://p{port}.preview.example.com",
  });

  for (const preview of [
    await driver.startPreview("prj_1"),
    await driver.previewStatus("prj_1"),
    await driver.stopPreview("prj_1"),
  ]) {
    assert.equal(preview.url, "https://p4310.preview.example.com");
    // The port is what the proxy maps back, so it has to survive the rewrite.
    assert.equal(preview.port, 4310);
  }
});

test("without a template the host's answer is passed through untouched", async () => {
  const host = await hostAnswering({ url: "http://10.1.2.3:4310" });
  after(host.close);
  const driver = new RemoteRuntimeDriver({ ...base, url: host.url });

  assert.equal((await driver.startPreview("prj_1")).url, "http://10.1.2.3:4310");
});

test("a stopped preview keeps its null address rather than inventing one", async () => {
  const host = await hostAnswering({ status: "stopped", url: null, port: null, pid: null });
  after(host.close);
  const driver = new RemoteRuntimeDriver({
    ...base,
    url: host.url,
    previewUrlTemplate: "https://p{port}.preview.example.com",
  });

  const preview = await driver.stopPreview("prj_1");
  assert.equal(preview.url, null);
  assert.equal(preview.status, "stopped");
});
