import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { runMigrations } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import { AppSleep, type StorageConfig } from "../src/services/storage/app-sleep.js";

/**
 * Apps nobody opened for a while sleep in the server's storage (Server settings → Storage) and wake
 * by themselves. Here the storage is a folder; the bucket kind is the same steps over S3
 * (object-store.test.ts runs those against a real S3-compatible server when one is given).
 */

const tmp = path.join(os.tmpdir(), `zelyq-sleep-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const workspace = path.join(tmp, "workspace");
const attachments = path.join(tmp, "attachments");
const archive = path.join(tmp, "archive");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "sleep.db")}`,
  agentUrl: "http://127.0.0.1:59994",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: attachments,
  uploadedSkillsDir: path.join(tmp, "skills"),
  pipelinesDir: path.join(tmp, "pipelines"),
  runtime: {
    kind: "local",
    workspaceDir: workspace,
    execTimeoutMs: 30_000,
    previewPortRange: [4988, 4991],
    previewHost: "127.0.0.1",
  },
};

let server: ZelyqServer;
let cookie: string;
let team: string;
/** The app put to sleep in the second test and woken in the third. */
let sleepy = "";

const call = (method: "GET" | "PUT" | "DELETE" | "POST", url: string, payload?: unknown) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );
const filesUnder = async (root: string): Promise<string[]> =>
  (await fs.readdir(root, { recursive: true }).catch(() => [] as string[])).map(String).sort();
const longAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString();

async function newApp(name: string): Promise<string> {
  const made = await call("POST", "/api/projects", { teamId: team, name });
  assert.equal(made.statusCode, 201, made.body);
  const id = made.json().project?.id ?? made.json().id;
  const root = path.join(workspace, id);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "app.js"), "console.log('mine');\n");
  await fs.writeFile(path.join(root, "run.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
  await fs.symlink("src/app.js", path.join(root, "link.js"));
  await fs.mkdir(path.join(root, "node_modules", "big"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "big", "lib.js"), "y".repeat(50_000));
  await fs.mkdir(path.join(workspace, ".snapshots", id, "one"), { recursive: true });
  await fs.writeFile(path.join(workspace, ".snapshots", id, "one", "app.js"), "before");
  await fs.mkdir(path.join(attachments, id), { recursive: true });
  await fs.writeFile(path.join(attachments, id, "photo.png"), Buffer.alloc(2048, 7));
  await server.store.settings.set(`project:${id}:used`, longAgo());
  return id;
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  const registered = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "admin@example.com", name: "Admin", password: "correct-horse-battery" },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  cookie = `zelyq_session=${registered.cookies.find((c) => c.name === "zelyq_session")?.value}`;
  team = (await call("GET", "/api/teams")).json().teams[0].id;
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("with storage off (the default), nothing ever sleeps", async () => {
  const id = await newApp("Stays");
  assert.equal(await server.usage.sleepIdle(), 0);
  assert.equal(await exists(path.join(workspace, id, "src", "app.js")), true);
  assert.equal((await call("POST", "/api/settings/storage/test")).statusCode, 400);
  await call("DELETE", `/api/projects/${id}`);
});

test("an idle app sleeps in storage with its undo points and attachments, and still counts", async () => {
  const saved = await call("PUT", "/api/settings", {
    storageKind: "folder",
    storageFolder: archive,
    sleepIdleAppsAfterDays: 7,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const tested = await call("POST", "/api/settings/storage/test");
  assert.equal(tested.statusCode, 200, tested.body);
  assert.match(tested.json().where, /folder/);

  const id = await newApp("Sleepy");
  sleepy = id;
  const recent = await newApp("Recent");
  await server.store.settings.set(`project:${recent}:used`, new Date().toISOString());
  const counted = async () => {
    const body = (await call("GET", `/api/teams/${team}/usage?fresh=1`)).json();
    return body.apps.find((app: { id: string }) => app.id === id) as {
      files: number;
      undoPoints: number;
      attachments: number;
    };
  };
  const before = await counted();

  assert.equal(await server.usage.sleepIdle(), 1, "only the one unused for 7 days");
  assert.deepEqual(await fs.readdir(path.join(workspace, id)), [], "its folder stays, empty");
  assert.deepEqual(await filesUnder(path.join(workspace, ".snapshots", id)), []);
  assert.deepEqual(await filesUnder(path.join(attachments, id)), []);
  assert.equal(
    await exists(path.join(workspace, recent, "src", "app.js")),
    true,
    "used today: stays",
  );
  const stored = await filesUnder(path.join(archive, "zelyq", "apps", id));
  assert.equal(stored.filter((f) => f.endsWith(".tar.gz")).length, 3, stored.join(", "));

  // Asleep, it is still the team's: the same storage as before it went.
  const after = await counted();
  assert.ok(Math.abs(after.files - before.files) < 0.001, `${after.files} vs ${before.files}`);
  assert.ok(Math.abs(after.undoPoints - before.undoPoints) < 0.001);
  assert.ok(Math.abs(after.attachments - before.attachments) < 0.001);
  assert.ok(after.attachments > 0);
});

test("opening it wakes it: every file as it was, and the stored copy is gone", async () => {
  const id = sleepy;
  assert.ok(id);
  const listed = await call("GET", `/api/projects/${id}/files`);
  assert.equal(listed.statusCode, 200, listed.body);
  const root = path.join(workspace, id);
  assert.equal(
    await fs.readFile(path.join(root, "src", "app.js"), "utf8"),
    "console.log('mine');\n",
  );
  assert.equal((await fs.stat(path.join(root, "run.sh"))).mode & 0o777, 0o755, "still runnable");
  assert.equal(await fs.readlink(path.join(root, "link.js")), "src/app.js", "links stay links");
  assert.equal(
    await exists(path.join(root, "node_modules")),
    false,
    "packages come back with the next preview",
  );
  assert.equal(
    await fs.readFile(path.join(workspace, ".snapshots", id, "one", "app.js"), "utf8"),
    "before",
  );
  assert.equal((await fs.readFile(path.join(attachments, id, "photo.png"))).length, 2048);
  assert.deepEqual(
    (await filesUnder(path.join(archive, "zelyq", "apps", id))).filter((f) =>
      f.endsWith(".tar.gz"),
    ),
    [],
    "storage is paid by what it holds",
  );
  assert.equal(await server.store.settings.get(`project:${id}:asleep`), null);
});

test("deleting a sleeping app deletes its stored copy without waking it", async () => {
  const id = await newApp("Gone");
  assert.equal(await server.usage.sleepIdle(), 1);
  assert.deepEqual(await fs.readdir(path.join(workspace, id)), []);
  const removed = await call("DELETE", `/api/projects/${id}`);
  assert.ok(removed.statusCode < 300, removed.body);
  assert.equal(await exists(path.join(workspace, id)), false, "not woken just to be deleted");
  assert.deepEqual(
    (await filesUnder(path.join(archive, "zelyq", "apps", id))).filter((f) =>
      f.endsWith(".tar.gz"),
    ),
    [],
  );
});

test("storage switched off under a sleeping app: opening it says so plainly, and nothing is lost", async () => {
  const id = await newApp("Stranded");
  assert.equal(await server.usage.sleepIdle(), 1);
  await call("PUT", "/api/settings", { storageKind: "off" });
  const opened = await call("GET", `/api/projects/${id}/files`);
  assert.equal(opened.statusCode, 503);
  assert.match(opened.body, /asleep in folder .*Server settings → Storage/);
  await call("PUT", "/api/settings", { storageKind: "folder" });
  assert.equal((await call("GET", `/api/projects/${id}/files`)).statusCode, 200);
  assert.equal(await exists(path.join(workspace, id, "src", "app.js")), true);
});

/** An AppSleep on its own folders, with the settings kept in memory. */
function alone(name: string, config: Partial<StorageConfig> = {}) {
  const dir = path.join(tmp, name);
  const settings = new Map<string, string>();
  const store = {
    settings: {
      get: async (k: string) => settings.get(k) ?? null,
      set: async (k: string, v: string) => void settings.set(k, v),
      remove: async (k: string) => void settings.delete(k),
    },
  } as unknown as ConstructorParameters<typeof AppSleep>[0]["store"];
  let current: StorageConfig = {
    kind: "folder",
    folder: path.join(dir, "store"),
    endpoint: "",
    region: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    prefix: "",
    pathStyle: false,
    ...config,
  };
  const sleep = new AppSleep({
    store,
    workspaceDir: path.join(dir, "ws"),
    attachmentsDir: path.join(dir, "att"),
    config: async () => current,
  });
  return {
    dir,
    sleep,
    settings,
    ws: (...parts: string[]) => path.join(dir, "ws", ...parts),
    stored: async () =>
      (await filesUnder(path.join(dir, "store"))).filter((f) => f.endsWith(".tar.gz")),
    set: (next: Partial<StorageConfig>) => {
      current = { ...current, ...next };
    },
  };
}
const idle = { stillIdle: async () => true };

test("opened while being put to sleep: the sleep stops and nothing is left behind", async () => {
  const a = alone("race");
  await fs.mkdir(a.ws("app_1"), { recursive: true });
  await fs.writeFile(a.ws("app_1", "a.txt"), "a");
  let opened = false;
  const going = a.sleep.sleep("app_1", { stillIdle: async () => !opened });
  opened = true; // someone opened it while it was being packed
  const woken = a.sleep.ensureAwake("app_1");
  assert.equal(await going, null);
  await woken;
  assert.equal(await fs.readFile(a.ws("app_1", "a.txt"), "utf8"), "a");
  assert.deepEqual(await a.stored(), []);
  assert.equal(await a.sleep.asleep("app_1"), null);
});

test("an app with an action running (a long command, an install) is never put to sleep", async () => {
  const a = alone("busy");
  await fs.mkdir(a.ws("app_2"), { recursive: true });
  await fs.writeFile(a.ws("app_2", "a.txt"), "v1");
  await a.sleep.begin("app_2"); // e.g. exec started before the sleep
  assert.equal(await a.sleep.sleep("app_2", idle), null);
  // Its command writes, then ends.
  await fs.writeFile(a.ws("app_2", "a.txt"), "v2");
  a.sleep.end("app_2");
  // Reached during the upload: stops too.
  const going = a.sleep.sleep("app_2", {
    stillIdle: async () => true,
    prepare: async () => {
      setImmediate(() => void a.sleep.ensureAwake("app_2"));
      await new Promise((r) => setTimeout(r, 5));
    },
  });
  assert.equal(await going, null);
  assert.equal(await fs.readFile(a.ws("app_2", "a.txt"), "utf8"), "v2");
  assert.deepEqual(await a.stored(), []);
});

test("the app's own folder stays while it sleeps (a container mounting it keeps working)", async () => {
  const a = alone("inode");
  await fs.mkdir(a.ws("app_3", "src"), { recursive: true });
  await fs.writeFile(a.ws("app_3", "src", "x.js"), "x");
  const before = (await fs.stat(a.ws("app_3"))).ino;
  assert.ok(await a.sleep.sleep("app_3", idle));
  assert.deepEqual(await fs.readdir(a.ws("app_3")), [], "empty while asleep");
  await a.sleep.ensureAwake("app_3");
  assert.equal((await fs.stat(a.ws("app_3"))).ino, before, "the same folder");
  assert.equal(await fs.readFile(a.ws("app_3", "src", "x.js"), "utf8"), "x");
});

test("a file that cannot be moved stops the sleep: everything stays, nothing is recorded or stored", {
  skip: process.getuid?.() === 0 && "root may move anything",
}, async () => {
  const a = alone("stuck");
  await fs.mkdir(a.ws("app_4", "locked"), { recursive: true });
  await fs.writeFile(a.ws("app_4", "important.txt"), "keep me");
  await fs.writeFile(a.ws("app_4", "locked", "inside.txt"), "me too");
  await fs.chmod(a.ws("app_4", "locked"), 0o555); // a folder may not be moved without write on it
  try {
    await assert.rejects(a.sleep.sleep("app_4", idle));
    assert.equal(await fs.readFile(a.ws("app_4", "important.txt"), "utf8"), "keep me");
    assert.equal(await fs.readFile(a.ws("app_4", "locked", "inside.txt"), "utf8"), "me too");
    assert.equal(await a.sleep.asleep("app_4"), null);
    assert.deepEqual(await a.stored(), []);
  } finally {
    await fs.chmod(a.ws("app_4", "locked"), 0o755);
  }
});

test("after a restart in the middle of a sleep, files moved aside but not recorded go back", async () => {
  const a = alone("restart");
  await fs.mkdir(a.ws("app_5"), { recursive: true });
  await fs.mkdir(a.ws(".sleeping.app_5.2026-01-01"), { recursive: true });
  await fs.writeFile(a.ws(".sleeping.app_5.2026-01-01", "mine.txt"), "mine");
  await fs.mkdir(a.ws(".waking.app_6.abc123"), { recursive: true });
  await fs.mkdir(a.ws(".packing.app_6.abc123"), { recursive: true });
  await a.sleep.tidy();
  assert.equal(await fs.readFile(a.ws("app_5", "mine.txt"), "utf8"), "mine");
  assert.deepEqual((await fs.readdir(a.ws())).sort(), ["app_5"]);
});

test("storage moved elsewhere: a sleeping app says where it is, and opens again once storage points back", async () => {
  const a = alone("moved");
  await fs.mkdir(a.ws("app_7"), { recursive: true });
  await fs.writeFile(a.ws("app_7", "a.txt"), "a");
  assert.ok(await a.sleep.sleep("app_7", idle));
  const first = path.join(a.dir, "store");
  a.set({ folder: path.join(a.dir, "other") });
  await assert.rejects(
    a.sleep.ensureAwake("app_7"),
    /storage now points to folder .*other.*Set it back/,
  );
  a.set({ folder: first });
  await a.sleep.ensureAwake("app_7");
  assert.equal(await fs.readFile(a.ws("app_7", "a.txt"), "utf8"), "a");
});

test("settings that cannot work are said plainly, and nothing breaks", async () => {
  const saved = await call("PUT", "/api/settings", {
    storageKind: "s3",
    storageEndpoint: "storage.googleapis.com",
    storageBucket: "b",
    storageAccessKeyId: "k",
    storageSecretAccessKey: "s",
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const tested = await call("POST", "/api/settings/storage/test");
  assert.equal(tested.statusCode, 400);
  assert.match(tested.body, /must start with https:\/\//);
  assert.equal(await server.usage.sleepIdle(), 0);
  await call("PUT", "/api/settings", { storageKind: "folder", storageEndpoint: "" });
});

test("adding an attachment to a sleeping app wakes it first, so nothing is lost", async () => {
  const id = await newApp("Attached");
  assert.equal(await server.usage.sleepIdle(), 1);
  const added = await call("POST", `/api/projects/${id}/attachments`, {
    filename: "n.txt",
    mimeType: "text/plain",
    data: Buffer.from("new").toString("base64"),
  });
  assert.ok(added.statusCode < 300, added.body);
  assert.equal(await server.store.settings.get(`project:${id}:asleep`), null, "woken");
  assert.equal(
    (await fs.readFile(path.join(attachments, id, "photo.png"))).length,
    2048,
    "the old one is back",
  );
  assert.equal(
    (await fs.readdir(path.join(attachments, id))).filter((n) => !n.endsWith(".json")).length,
    2,
  );
});

test("a finished sleep's leftover is removed, never put back over an app that has woken since", async () => {
  const a = alone("stale");
  await fs.mkdir(a.ws("app_8"), { recursive: true });
  await fs.writeFile(a.ws("app_8", "a.txt"), "edited after waking");
  const leftover = a.ws(".sleeping.app_8.2026-01-01");
  await fs.mkdir(leftover, { recursive: true });
  await fs.writeFile(path.join(leftover, "a.txt"), "old");
  await fs.writeFile(path.join(leftover, ".zelyq-sleep-done"), "2026-01-01");
  await fs.mkdir(a.ws(".slept.app_8.2026-01-02"), { recursive: true });
  await a.sleep.tidy();
  assert.equal(await fs.readFile(a.ws("app_8", "a.txt"), "utf8"), "edited after waking");
  assert.deepEqual((await fs.readdir(a.ws())).sort(), ["app_8"]);
});

test("an admin can put idle apps to sleep now, even ones used today (0 days); every app wakes when opened", async () => {
  const id = await newApp("Now");
  await server.store.settings.set(`project:${id}:used`, new Date().toISOString());
  const kept = await call("POST", "/api/settings/storage/sleep-now", { days: 7 });
  assert.equal(kept.statusCode, 200, kept.body);
  assert.equal(
    await server.store.settings.get(`project:${id}:asleep`),
    null,
    "used today: not idle for 7 days",
  );
  const now = await call("POST", "/api/settings/storage/sleep-now", { days: 0 });
  assert.equal(now.statusCode, 200, now.body);
  assert.ok(now.json().slept >= 1);
  assert.equal(typeof now.json().media, "number", "images and videos are swept too");
  assert.ok(await server.store.settings.get(`project:${id}:asleep`));
  assert.equal((await call("GET", `/api/projects/${id}/files`)).statusCode, 200);
  assert.equal(await exists(path.join(workspace, id, "src", "app.js")), true);
  assert.equal(
    (await call("POST", "/api/settings/storage/sleep-now", { days: -1 })).statusCode,
    400,
  );
});

test("on a managed server the admin tests storage and puts apps to sleep through the admin API (settings scope)", async () => {
  const made = await call("POST", "/api/admin-keys", {
    name: "Control Tower",
    scopes: ["settings"],
  });
  assert.equal(made.statusCode, 201, made.body);
  const plain = await call("POST", "/api/admin-keys", { name: "Plans only", scopes: ["plans"] });
  const api = (key: string, url: string, payload?: unknown) =>
    server.app.inject({
      method: "POST",
      url: `/api/admin/v1${url}`,
      headers: { authorization: `Bearer ${key}` },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const key = made.json().key as string;
  const tested = await api(key, "/storage/test");
  assert.equal(tested.statusCode, 200, tested.body);
  assert.match(tested.json().where, /folder/);
  const id = await newApp("FromTheAdmin");
  const now = await api(key, "/storage/sleep-now", { days: 0 });
  assert.equal(now.statusCode, 200, now.body);
  assert.ok(await server.store.settings.get(`project:${id}:asleep`));
  assert.equal((await api(plain.json().key, "/storage/sleep-now", { days: 0 })).statusCode, 403);
});
