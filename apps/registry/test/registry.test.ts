import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pluginSignaturePayload } from "@zelyq/core";
import { buildRegistry, type Registry } from "../src/app.js";

/**
 * The registry: only our plugins go in, every version signed; only a
 * registered Zelyq installation gets anything out; a withdrawn version stops
 * being installable.
 */

const tmp = path.join(os.tmpdir(), `zelyq-registry-${Date.now()}`);
let registry: Registry;
let session = "";
const ORIGIN = "http://localhost:80";

/** A plugin folder packed the way the docs say: tar -czf … -C folder . */
async function pack(name: string, files: Record<string, string>): Promise<Buffer> {
  const dir = path.join(tmp, "src", `${name}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), content);
  }
  const out = `${dir}.tar.gz`;
  execFileSync("tar", ["-czf", out, "-C", dir, "."]);
  return fs.readFile(out);
}

const manifest = (id: string, version: string) =>
  `id: ${id}\nversion: ${version}\nname: Say hello\ndescription: Prints a greeting.\ncategory: other\ninputs:\n  who:\n    description: Who to greet\n    default: world\nsteps:\n  - name: Greet\n    run: echo "hello $ZELYQ_INPUT_WHO"\n`;

const plugin = (id: string, version: string, extra: Record<string, string> = {}) =>
  pack(id.replace("/", "-"), {
    "zelyq-plugin.yml": manifest(id, version),
    "README.md": "# Say hello\n\nPrints a greeting.\n",
    LICENSE: "MIT\n",
    ...extra,
  });

async function publish(body: Buffer) {
  const boundary = "----zelyqtest";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="package"; filename="p.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n`,
    ),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await registry.app.inject({
    method: "POST",
    url: "/admin/publish",
    headers: {
      cookie: `zr_session=${session}`,
      origin: ORIGIN,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  const location = decodeURIComponent(String(response.headers.location ?? ""));
  return { ok: location.includes("done="), message: location };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  registry = await buildRegistry({
    host: "127.0.0.1",
    port: 0,
    dataDir: path.join(tmp, "data"),
    publicUrl: null,
    trustProxy: false,
    logLevel: "silent",
  });
  await registry.store.addAdmin("owner@zelyq.com", "a-long-admin-password");
});

after(async () => {
  await registry.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("signing in: the right password, from this site only", async () => {
  const form = (password: string, origin = ORIGIN) =>
    registry.app.inject({
      method: "POST",
      url: "/admin/login",
      headers: { "content-type": "application/x-www-form-urlencoded", origin },
      payload: new URLSearchParams({ email: "owner@zelyq.com", password }).toString(),
    });
  assert.equal((await form("wrong-password-123")).statusCode, 401);
  assert.equal((await form("a-long-admin-password", "https://evil.example")).statusCode, 403);
  const ok = await form("a-long-admin-password");
  assert.equal(ok.statusCode, 303);
  session = ok.cookies.find((c) => c.name === "zr_session")?.value ?? "";
  assert.ok(session);
  const dashboard = await registry.app.inject({
    method: "GET",
    url: "/admin",
    headers: { cookie: `zr_session=${session}` },
  });
  assert.match(dashboard.body, /Publish a version/);
});

test("only our own, complete plugins are published, and versions only go up", async () => {
  const first = await publish(await plugin("zelyq/say-hello", "1.0.0"));
  assert.ok(first.ok, first.message);

  const theirs = await publish(await plugin("acme/say-hello", "1.0.0"));
  assert.match(theirs.message, /must start with zelyq\//);
  const noReadme = await publish(
    await pack("x", { "zelyq-plugin.yml": manifest("zelyq/no-readme", "1.0.0"), LICENSE: "MIT" }),
  );
  assert.match(noReadme.message, /README/);
  const again = await publish(await plugin("zelyq/say-hello", "1.0.0"));
  assert.match(again.message, /already published/);
  const lower = await publish(
    await plugin("zelyq/say-hello", "0.9.0", { "CHANGELOG.md": "older" }),
  );
  assert.match(lower.message, /must be higher/);
  const noChangelog = await publish(await plugin("zelyq/say-hello", "1.1.0"));
  assert.match(noChangelog.message, /CHANGELOG/);
  const second = await publish(
    await plugin("zelyq/say-hello", "1.1.0", { "CHANGELOG.md": "## 1.1.0\n- Friendlier." }),
  );
  assert.ok(second.ok, second.message);
});

test("an installation registers, browses, and gets a package signed by our key", async () => {
  const anonymous = await registry.app.inject({ method: "GET", url: "/v1/plugins" });
  assert.equal(anonymous.statusCode, 401);

  const registered = await registry.app.inject({
    method: "POST",
    url: "/v1/installations",
    payload: { zelyqVersion: "0.1.0" },
  });
  assert.equal(registered.statusCode, 201);
  const { key } = registered.json();
  const auth = { authorization: `Bearer ${key}` };

  const list = (
    await registry.app.inject({ method: "GET", url: "/v1/plugins", headers: auth })
  ).json();
  assert.deepEqual(
    list.plugins.map((p: { id: string; latestVersion: string }) => [p.id, p.latestVersion]),
    [["zelyq/say-hello", "1.1.0"]],
  );
  const detail = (
    await registry.app.inject({ method: "GET", url: "/v1/plugins/zelyq/say-hello", headers: auth })
  ).json().plugin;
  assert.match(detail.readme, /Say hello/);
  assert.deepEqual(detail.inputs.who, {
    description: "Who to greet",
    required: false,
    secret: false,
  });
  assert.equal(detail.versions.length, 2);

  const download = await registry.app.inject({
    method: "GET",
    url: "/v1/plugins/zelyq/say-hello/1.1.0/package",
    headers: auth,
  });
  assert.equal(download.statusCode, 200);
  const body = download.rawPayload;
  const sha256 = createHash("sha256").update(body).digest("hex");
  assert.equal(download.headers["x-zelyq-sha256"], sha256);
  const keys = (await registry.app.inject({ method: "GET", url: "/v1/keys" })).json().keys;
  const publicKey = createPublicKey({
    key: Buffer.from(keys[0].publicKey, "base64"),
    format: "der",
    type: "spki",
  });
  assert.ok(
    verify(
      null,
      Buffer.from(pluginSignaturePayload("zelyq/say-hello", "1.1.0", sha256)),
      publicKey,
      Buffer.from(String(download.headers["x-zelyq-signature"]), "base64"),
    ),
    "the package verifies against the registry's public key",
  );
  // A tampered package would not.
  assert.ok(
    !verify(
      null,
      Buffer.from(pluginSignaturePayload("zelyq/say-hello", "1.1.0", "0".repeat(64))),
      publicKey,
      Buffer.from(String(download.headers["x-zelyq-signature"]), "base64"),
    ),
  );

  // Withdrawn: not downloadable, listed with its reason, and 1.0.0 is latest again.
  const yank = await registry.app.inject({
    method: "POST",
    url: "/admin/yank",
    headers: {
      cookie: `zr_session=${session}`,
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload: new URLSearchParams({
      id: "zelyq/say-hello",
      version: "1.1.0",
      reason: "Greets the wrong person",
    }).toString(),
  });
  assert.match(decodeURIComponent(String(yank.headers.location)), /Withdrew/);
  const gone = await registry.app.inject({
    method: "GET",
    url: "/v1/plugins/zelyq/say-hello/1.1.0/package",
    headers: auth,
  });
  assert.equal(gone.statusCode, 410);
  const yanked = (
    await registry.app.inject({ method: "GET", url: "/v1/yanked", headers: auth })
  ).json();
  assert.equal(yanked.yanked[0].reason, "Greets the wrong person");
  const after = (
    await registry.app.inject({ method: "GET", url: "/v1/plugins", headers: auth })
  ).json();
  assert.equal(after.plugins[0].latestVersion, "1.0.0");
});

test("every starter plugin in plugins/ is publishable as it stands", async () => {
  const root = path.resolve(import.meta.dirname, "..", "plugins");
  for (const name of (await fs.readdir(root)).sort()) {
    const out = path.join(tmp, `starter-${name}.tar.gz`);
    execFileSync("tar", ["-czf", out, "-C", path.join(root, name), "."]);
    const published = await registry.store.publish(await fs.readFile(out), "owner@zelyq.com");
    assert.equal(published.id, `zelyq/${name}`);
  }
});
