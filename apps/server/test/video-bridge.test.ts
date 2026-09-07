import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { newId } from "@zelyq/core";
import { createStore, runMigrations, type Store } from "@zelyq/db";
import { VideoBridge } from "../src/services/video-bridge.js";

/**
 * The bridge is the whole enforcement of the per-project video permission, and
 * it is deliberately a SEPARATE permission from images: allowing a project to
 * make pictures must not allow it to make films.
 */

const tmp = path.join(os.tmpdir(), `zelyq-video-bridge-${Date.now()}`);
const dbUrl = `file:${path.join(tmp, "bridge.db")}`;
let store: Store;

const configured = { capabilities: async () => ({ providers: [{ configured: true }] }) };
const unconfigured = { capabilities: async () => ({ providers: [{ configured: false }] }) };

async function project(
  suffix: string,
  flags: { videoGenerationEnabled?: boolean; imageGenerationEnabled?: boolean },
) {
  const user = await store.users.create({
    id: newId("user"),
    email: `v-${suffix}@example.com`,
    name: "V",
    passwordHash: "x",
  });
  const team = await store.teams.create({ id: newId("team"), name: suffix, slug: `vt-${suffix}` });
  await store.teams.addMember(team.id, user.id, "owner");
  const created = await store.projects.create({
    id: newId("project"),
    teamId: team.id,
    name: `Project ${suffix}`,
    slug: `vp-${suffix}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
    ...flags,
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

test("no video permission means no token", async () => {
  const bridge = new VideoBridge(store, configured);
  const off = await project("off", { videoGenerationEnabled: false });
  assert.equal(await bridge.mint("ses_v_off", off.projectId, off.userId), null);
});

test("the image permission does not grant video", async () => {
  // The whole point of a separate permission: pictures cost cents, clips cost
  // dollars, so one must never imply the other.
  const bridge = new VideoBridge(store, configured);
  const imagesOnly = await project("images-only", {
    imageGenerationEnabled: true,
    videoGenerationEnabled: false,
  });
  assert.equal(await bridge.mint("ses_img", imagesOnly.projectId, imagesOnly.userId), null);
});

test("permission plus a configured provider mints a token that resolves", async () => {
  const bridge = new VideoBridge(store, configured);
  const on = await project("on", { videoGenerationEnabled: true });
  const token = await bridge.mint("ses_v_on", on.projectId, on.userId);
  assert.ok(token);
  const grant = bridge.resolve(token as string);
  assert.equal(grant?.userId, on.userId, "an agent clip is owned by the connecting user");
  assert.equal(grant?.projectId, on.projectId);
  assert.equal(grant?.sessionId, "ses_v_on");
  assert.equal(grant?.projectName, "Project on");
});

test("permission but no configured provider still mints nothing", async () => {
  const bridge = new VideoBridge(store, unconfigured);
  const on = await project("nokey", { videoGenerationEnabled: true });
  assert.equal(await bridge.mint("ses_v_nokey", on.projectId, on.userId), null);
});

test("unknown and revoked tokens resolve to nothing", async () => {
  const bridge = new VideoBridge(store, configured);
  const on = await project("revoke", { videoGenerationEnabled: true });
  const token = (await bridge.mint("ses_v_rev", on.projectId, on.userId)) as string;
  assert.ok(bridge.resolve(token));
  bridge.revokeSession("ses_v_rev");
  assert.equal(bridge.resolve(token), null);
  assert.equal(bridge.resolve("not-a-token"), null);
});

test("turning the permission off stops the next session", async () => {
  const bridge = new VideoBridge(store, configured);
  const on = await project("later-off", { videoGenerationEnabled: true });
  assert.ok(await bridge.mint("ses_a", on.projectId, on.userId));
  await store.projects.update(on.projectId, { videoGenerationEnabled: false });
  assert.equal(await bridge.mint("ses_b", on.projectId, on.userId), null);
});
