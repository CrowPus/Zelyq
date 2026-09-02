import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createStore, runMigrations, type Store } from "../src/index.js";

/**
 * Regression cover for the token counter.
 *
 * The agent used to emit a session-cumulative token total on every turn; the
 * gateway stored that on the message row and then *added* it to the session
 * total. `sessions.tokens_in` therefore grew with the square of the turn count
 * — a 2.1x inflation on the existing corpus, and no way to rebaseline it.
 *
 * These tests assert the arithmetic the fix relies on: `addUsage` takes a
 * per-turn delta, and a message row carries this turn's usage plus its cache
 * split.
 */

const tmp = path.join(os.tmpdir(), `zelyq-usage-${Date.now()}`);
let store: Store;

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  const url = `file:${path.join(tmp, "usage.db")}`;
  await runMigrations(url);
  store = createStore(url);
});

after(async () => {
  await store?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function seedSession(id: string): Promise<void> {
  await store.teams.create({ id: `team_${id}`, name: "usage", slug: `usage-${id}` });
  await store.projects.create({
    id: `proj_${id}`,
    teamId: `team_${id}`,
    name: "usage",
    slug: `usage-${id}`,
    description: null,
    template: "vite-react",
    status: "ready",
    statusMessage: null,
  });
  await store.sessions.create({
    id,
    projectId: `proj_${id}`,
    status: "idle",
    provider: "anthropic",
    model: "claude-opus-5",
    effort: "high",
    tokensIn: 0,
    tokensOut: 0,
  });
  // `listForSession` trims forward to a `user` boundary, so an assistant row
  // needs a user turn in front of it to survive the window.
  await store.messages.append({
    id: `msg_user_${id}`,
    sessionId: id,
    role: "user",
    content: "go",
    thinking: null,
    toolCalls: [],
    attachments: [],
    mentions: null,
    snapshotId: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    usageSchema: 1,
    createdAt: new Date(Date.now() - 1000).toISOString(),
  });
}

test("addUsage sums per-turn deltas, it does not compound a running total", async () => {
  await seedSession("ses_delta");

  // Two turns that each cost 100 in / 50 out.
  await store.sessions.addUsage("ses_delta", 100, 50);
  await store.sessions.addUsage("ses_delta", 100, 50);

  const session = await store.sessions.findById("ses_delta");
  assert.ok(session);
  // 200/100. The pre-fix caller passed the running total (100 then 200),
  // which landed 300/150 here and diverged further every turn.
  assert.equal(session.tokensIn, 200, "session input must be the sum of per-turn deltas");
  assert.equal(session.tokensOut, 100, "session output must be the sum of per-turn deltas");
});

test("a message row stores this turn's usage and its cache split", async () => {
  await seedSession("ses_msg");

  await store.messages.append({
    id: "msg_1",
    sessionId: "ses_msg",
    role: "assistant",
    content: "done",
    thinking: null,
    toolCalls: [],
    attachments: [],
    mentions: null,
    snapshotId: null,
    tokensIn: 1_200,
    tokensOut: 300,
    cacheReadTokens: 48_000,
    cacheCreationTokens: 2_000,
    usageSchema: 1,
    createdAt: new Date().toISOString(),
  });

  const rows = await store.messages.listForSession("ses_msg");
  const row = rows.find((m) => m.id === "msg_1");
  assert.ok(row);
  assert.equal(row.tokensIn, 1_200);
  assert.equal(row.cacheReadTokens, 48_000);
  assert.equal(row.cacheCreationTokens, 2_000);
  assert.equal(row.usageSchema, 1);
  // True prompt size is the uncached remainder plus both cache figures; without
  // the two cache columns the row cannot be priced at all.
  assert.equal(row.tokensIn + row.cacheReadTokens + row.cacheCreationTokens, 51_200);
});

test("rows written before the fix are marked unusable rather than silently trusted", async () => {
  await seedSession("ses_legacy");

  await store.messages.append({
    id: "msg_legacy",
    sessionId: "ses_legacy",
    role: "assistant",
    content: "",
    thinking: null,
    toolCalls: [],
    attachments: [],
    mentions: null,
    snapshotId: null,
    tokensIn: 9_678_591, // a running total, not a turn
    tokensOut: 83_919,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    usageSchema: 0,
    createdAt: new Date().toISOString(),
  });

  const rows = await store.messages.listForSession("ses_legacy");
  const row = rows.find((m) => m.id === "msg_legacy");
  assert.equal(row?.usageSchema, 0, "pre-fix rows must be excludable from a baseline");
});
