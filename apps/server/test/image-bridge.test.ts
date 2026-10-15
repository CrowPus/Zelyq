import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import { ImageBridge } from "../src/services/image-bridge.js";

/**
 * The bridge is the whole enforcement of the per-project image permission: no
 * token means the session is never given the image tools. These tests cover
 * that, and the grant's contents — the user it resolves to is what makes an
 * agent's image land in that person's Image Studio library.
 */

const tmp = path.join(os.tmpdir(), `zelyq-image-bridge-${Date.now()}`);
const dbUrl = `file:${path.join(tmp, "bridge.db")}`;
let store: Store;

const configured = { capabilities: async () => ({ configured: true }) };
const unconfigured = { capabilities: async () => ({ configured: false }) };

async function project(suffix: string, imageGenerationEnabled: boolean) {
  const user = await store.users.create({
    id: newId("user"),
    email: `u-${suffix}@example.com`,
    name: "U",
    passwordHash: "x",
  });
  const team = await store.teams.create({ id: newId("team"), name: suffix, slug: `t-${suffix}` });
  await store.teams.addMember(team.id, user.id, "owner");
  const created = await store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: `Project ${suffix}`,
    slug: `p-${suffix}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
    imageGenerationEnabled,
  });
  return { projectId: created.id, userId: user.id };
}

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(dbUrl);
  store = createStore(dbUrl);
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

test("a project without the permission gets no token, and one with it does", async () => {
  const bridge = new ImageBridge(store, configured);
  const off = await project("off", false);
  assert.equal(await bridge.mint("ses_off", off.projectId, off.userId), null);

  const on = await project("on", true);
  const token = await bridge.mint("ses_on", on.projectId, on.userId);
  assert.ok(token, "an allowed project should receive a token");
});

test("permission granted but no provider configured still mints nothing", async () => {
  // Otherwise the model is handed tools that can only fail, and the user is
  // told to fix something only an administrator can fix.
  const bridge = new ImageBridge(store, unconfigured);
  const on = await project("nokey", true);
  assert.equal(await bridge.mint("ses_nokey", on.projectId, on.userId), null);
});

test("a token resolves to its own project, user and session", async () => {
  const bridge = new ImageBridge(store, configured);
  const on = await project("resolve", true);
  const token = (await bridge.mint("ses_resolve", on.projectId, on.userId))!;
  const grant = bridge.resolve(token);
  assert.equal(grant?.userId, on.userId, "the owner of an agent image is the connecting user");
  assert.equal(grant?.projectId, on.projectId);
  assert.equal(grant?.sessionId, "ses_resolve");
  assert.equal(grant?.projectName, "Project resolve");
});

test("an unknown token, and a revoked session's token, resolve to nothing", async () => {
  const bridge = new ImageBridge(store, configured);
  const on = await project("revoke", true);
  const token = (await bridge.mint("ses_revoke", on.projectId, on.userId))!;
  assert.ok(bridge.resolve(token));
  bridge.revokeSession("ses_revoke");
  assert.equal(bridge.resolve(token), null);
  assert.equal(bridge.resolve("not-a-real-token"), null);
});

test("re-minting for a session keeps its token working", async () => {
  // The gateway mints on every prompt, but a reused agent session keeps the
  // token it was created with.
  const bridge = new ImageBridge(store, configured);
  const on = await project("remint", true);
  const first = (await bridge.mint("ses_remint", on.projectId, on.userId))!;
  const second = (await bridge.mint("ses_remint", on.projectId, on.userId))!;
  assert.equal(first, second);
  assert.ok(bridge.resolve(first), "the session's token should keep working");
});

test("re-minting a session for another project retires its previous token", async () => {
  const bridge = new ImageBridge(store, configured);
  const a = await project("remint-a", true);
  const b = await project("remint-b", true);
  const first = (await bridge.mint("ses_remint_ab", a.projectId, a.userId))!;
  const second = (await bridge.mint("ses_remint_ab", b.projectId, b.userId))!;
  assert.notEqual(first, second);
  assert.equal(bridge.resolve(first), null, "the old token should stop working");
  assert.equal(bridge.resolve(second)?.projectId, b.projectId);
});

test("turning the permission off stops the next session from getting a token", async () => {
  const bridge = new ImageBridge(store, configured);
  const on = await project("later-off", true);
  assert.ok(await bridge.mint("ses_a", on.projectId, on.userId));
  await store.projects.update(on.projectId, { imageGenerationEnabled: false });
  assert.equal(await bridge.mint("ses_b", on.projectId, on.userId), null);
});

/**
 * Reusing the library is free, so it does not hide behind the generation
 * switch: a project with image generation off can still list and place what
 * its owner made in Image Studio — but a library token never generates.
 */
test("with generation off, a library token reads the library and nothing more", async () => {
  const bridge = new ImageBridge(store, unconfigured);
  const off = await project("library", false);
  assert.equal(await bridge.mint("ses_lib", off.projectId, off.userId), null);
  const token = await bridge.mintLibrary("ses_lib", off.projectId, off.userId);
  assert.ok(token, "every project gets a library token");
  assert.equal(bridge.resolveLibrary(token)?.userId, off.userId);
  assert.equal(bridge.resolve(token), null, "a library token is not a generation token");
  // Minted again on the next prompt, it stays the same token.
  assert.equal(await bridge.mintLibrary("ses_lib", off.projectId, off.userId), token);
});

test("turning generation off keeps the library token; ending the session drops both", async () => {
  const bridge = new ImageBridge(store, configured);
  const on = await project("switch", true);
  const generation = (await bridge.mint("ses_switch", on.projectId, on.userId))!;
  const library = (await bridge.mintLibrary("ses_switch", on.projectId, on.userId))!;
  assert.ok(bridge.resolveLibrary(generation), "a generation token can read the library too");

  await store.projects.update(on.projectId, { imageGenerationEnabled: false });
  assert.equal(await bridge.mint("ses_switch", on.projectId, on.userId), null);
  assert.equal(bridge.resolve(generation), null, "switched off: generation stops at once");
  assert.ok(bridge.resolveLibrary(library), "the library grant never could spend anything");

  bridge.revokeSession("ses_switch");
  assert.equal(bridge.resolveLibrary(library), null);
});
