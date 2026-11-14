import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { runMigrations, type Store } from "@zelyq/db";
import { buildServer, type ZelyqServer } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";
import {
  type ChannelService,
  cleanPrefs,
  discordWebhook,
  type Http,
  inQuietHours,
} from "../src/services/ops/channels.js";

/**
 * Channels (075 Step 2): connecting Telegram, Slack and Discord with stand-ins
 * for their APIs (no network); linking a person with a one-time code (right,
 * wrong, expired, reused); an unlinked chat is ignored; each person's choices
 * and quiet hours; a person who left loses their links; tokens never come back
 * out; only a Discord address is accepted as a Discord webhook.
 */

const tmp = path.join(os.tmpdir(), `zelyq-ops-channels-${Date.now()}`);
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  isProduction: true,
  corsOrigin: ["*"],
  databaseUrl: `file:${path.join(tmp, "ops-channels.db")}`,
  agentUrl: "http://127.0.0.1:59995",
  provider: "anthropic",
  model: "claude-opus-5",
  effort: "high",
  allowRegistration: true,
  sessionTtlDays: 30,
  templatesDir: path.join(repoRoot, "templates"),
  webDir: null,
  secretKey: undefined,
  secretKeyFile: path.join(tmp, "secret.key"),
  attachmentsDir: path.join(tmp, "attachments"),
  uploadedSkillsDir: path.join(tmp, "skills"),
  pipelinesDir: path.join(tmp, "pipelines"),
  publicUrl: "https://zelyq.example",
  runtime: {
    kind: "local",
    workspaceDir: path.join(tmp, "workspace"),
    execTimeoutMs: 30_000,
    previewPortRange: [4952, 4955],
    previewHost: "127.0.0.1",
  },
};

const TOKEN = "123456789:AAH-standinTokenForTestsOnly_abcdefghij";
const OTHER_TOKEN = "987654321:AAH-anotherStandinTokenForTests_abcdef";
const SLACK_TOKEN = "xoxb-1111-2222-standinslacktoken";
const WEBHOOK = "https://discord.com/api/webhooks/42/standin-webhook-token";

let server: ZelyqServer;
let store: Store;
let channels: ChannelService;
let teamId: string;
let otherTeamId: string;
let ownerCookie: string;
let viewerCookie: string;
let ownerId: string;
let viewerId: string;

/** Every call the stand-ins received, and what Telegram has waiting to be read. */
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const updates: unknown[] = [];
let updateId = 100;
const sent = (method: string) =>
  calls.filter((call) => call.url.endsWith(`/${method}`) || call.url.includes(`/${method}?`));

const standIn: Http = async (url, init) => {
  const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  calls.push({ url, body });
  const ok = (result: unknown) => ({ status: 200, body: JSON.stringify({ ok: true, result }) });
  if (url.startsWith("https://api.telegram.org/")) {
    const token = url.split("/bot")[1]?.split("/")[0];
    if (token !== TOKEN && token !== OTHER_TOKEN)
      return { status: 401, body: JSON.stringify({ ok: false, description: "Unauthorized" }) };
    if (url.endsWith("/getMe"))
      return ok({ id: token === TOKEN ? 1234 : 9876, username: "zelyq_test_bot", is_bot: true });
    if (url.endsWith("/getUpdates")) {
      const offset = Number(body.offset ?? 0);
      const waiting = (updates as Array<{ update_id: number }>).filter(
        (update) => update.update_id >= offset,
      );
      return ok(waiting);
    }
    if (url.endsWith("/sendMessage")) return ok({ message_id: 1 });
  }
  if (url.startsWith("https://slack.com/api/")) {
    if (init.headers?.authorization !== `Bearer ${SLACK_TOKEN}`)
      return { status: 200, body: JSON.stringify({ ok: false, error: "invalid_auth" }) };
    if (url.includes("/auth.test"))
      return {
        status: 200,
        body: JSON.stringify({ ok: true, team: "Acme", team_id: "T1", user_id: "UBOT" }),
      };
    if (url.includes("/users.lookupByEmail")) {
      const email = new URL(url).searchParams.get("email");
      return email === "viewer@example.com"
        ? { status: 200, body: JSON.stringify({ ok: true, user: { id: "U77", name: "vee" } }) }
        : { status: 200, body: JSON.stringify({ ok: false, error: "users_not_found" }) };
    }
    if (url.includes("/chat.postMessage"))
      return { status: 200, body: JSON.stringify({ ok: true, ts: "1" }) };
  }
  if (url.startsWith("https://discord.com/api/webhooks/")) {
    if (init.method === "GET")
      return { status: 200, body: JSON.stringify({ id: "42", name: "ops-alerts" }) };
    return { status: 200, body: "{}" };
  }
  return { status: 404, body: "{}" };
};

const inject = (
  cookie: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  server.app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload === undefined ? {} : { payload: payload as never }),
  });

async function register(email: string, name: string) {
  const response = await server.app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "correct-horse-battery" },
  });
  return `zelyq_session=${response.cookies.find((c) => c.name === "zelyq_session")?.value}`;
}

/** A message the bot receives, as Telegram would hand it over. */
function incoming(text: string, chatId = 555, type = "private") {
  updateId += 1;
  updates.push({
    update_id: updateId,
    message: { text, chat: { id: chatId, type, username: "founder", first_name: "F" } },
  });
}
const pollNow = async () => {
  const channel = await store.ops.channels.find(teamId, "telegram");
  assert.ok(channel);
  await channels.poll(channel, 0);
};
const repliesTo = (chatId: number) =>
  sent("sendMessage")
    .filter((call) => String(call.body.chat_id) === String(chatId))
    .map((call) => String(call.body.text));

before(async () => {
  await fs.mkdir(tmp, { recursive: true });
  await runMigrations(config.databaseUrl);
  server = await buildServer(config);
  store = server.store;
  channels = server.opsChannels;
  channels.http = standIn;
  ownerCookie = await register("owner@example.com", "Owner");
  viewerCookie = await register("viewer@example.com", "Vee");
  const otherCookie = await register("other@example.com", "Other");
  teamId = (await inject(ownerCookie, "GET", "/api/teams")).json().teams[0].id;
  otherTeamId = (await inject(otherCookie, "GET", "/api/teams")).json().teams[0].id;
  await inject(ownerCookie, "POST", `/api/teams/${teamId}/members`, {
    email: "viewer@example.com",
    role: "viewer",
  });
  ownerId = (await store.users.findByEmail("owner@example.com"))?.id as string;
  viewerId = (await store.users.findByEmail("viewer@example.com"))?.id as string;
});

beforeEach(() => {
  calls.length = 0;
});

after(async () => {
  await server?.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

test("an admin connects Telegram; the token is checked, kept encrypted and never shown again", async () => {
  const bad = await inject(ownerCookie, "PUT", `/api/teams/${teamId}/ops/channels/telegram`, {
    token: "not a token",
  });
  assert.equal(bad.statusCode, 400);
  const refused = await inject(ownerCookie, "PUT", `/api/teams/${teamId}/ops/channels/telegram`, {
    token: "111111111:AAH-wrongButWellFormedTokenxxxxxxxxxxxx",
  });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.json().error?.message ?? refused.body, /refused the token/);
  assert.ok(!refused.body.includes("AAH-wrong"), "a token never comes back in an error");

  const viewer = await inject(viewerCookie, "PUT", `/api/teams/${teamId}/ops/channels/telegram`, {
    token: TOKEN,
  });
  assert.equal(viewer.statusCode, 403, "only an admin connects a service");

  const done = await inject(ownerCookie, "PUT", `/api/teams/${teamId}/ops/channels/telegram`, {
    token: TOKEN,
  });
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().channels[0].name, "@zelyq_test_bot");
  assert.ok(!done.body.includes(TOKEN));
  const row = await store.ops.channels.find(teamId, "telegram");
  assert.ok(row && !row.secret.includes(TOKEN), "stored encrypted, not as typed");
  assert.equal(
    await store.vault.findByName(teamId, "TELEGRAM_BOT_TOKEN"),
    null,
    "not in the Vault",
  );

  // The same bot cannot read its messages for two teams.
  await assert.rejects(
    channels.connect(otherTeamId, "telegram", { token: TOKEN }, ownerId),
    /already connected to another team/,
  );
});

test("linking with a code: it works once, in a private chat, for its own team, before it expires", async () => {
  // A stranger writing to the bot, and a group: nothing happens, nothing is answered.
  incoming("hello", 900);
  incoming("/start ABCDEFGH", 901, "group");
  await pollNow();
  assert.deepEqual(repliesTo(900), []);
  assert.deepEqual(repliesTo(901), []);

  // A wrong code is answered as wrong and links nothing.
  incoming("/start WRONGCODE", 555);
  await pollNow();
  assert.match(repliesTo(555)[0] ?? "", /did not work/);
  assert.equal((await store.ops.channelLinks.listForTeam(teamId)).length, 0);

  const start = await inject(
    ownerCookie,
    "POST",
    `/api/teams/${teamId}/ops/channels/telegram/link`,
  );
  assert.equal(start.statusCode, 200, start.body);
  const { code, url } = start.json();
  assert.equal(url, `https://t.me/zelyq_test_bot?start=${code}`);
  incoming(`/start ${code}`, 555);
  await pollNow();
  assert.match(repliesTo(555).at(-1) ?? "", /^Linked\. Owner will get Zelyq alerts here/);
  const links = await store.ops.channelLinks.listForTeam(teamId);
  assert.equal(links.length, 1);
  assert.equal(links[0]?.userId, ownerId);
  assert.equal(links[0]?.chatId, "555");

  // The same code again, from someone else: used, so nothing.
  incoming(`/start ${code}`, 777);
  await pollNow();
  assert.match(repliesTo(777)[0] ?? "", /did not work/);
  assert.equal((await store.ops.channelLinks.listForTeam(teamId)).length, 1);

  // An expired code: nothing.
  const late = await channels.startLink(
    teamId,
    "telegram",
    { id: viewerId, email: "viewer@example.com" },
    new Date(Date.now() - 16 * 60_000),
  );
  incoming(`/start ${late.code}`, 778);
  await pollNow();
  assert.match(repliesTo(778)[0] ?? "", /did not work/);

  // Read messages are not read twice.
  calls.length = 0;
  await pollNow();
  assert.equal(sent("sendMessage").length, 0);
});

test("each person hears what they chose, where they chose; quiet hours hold all but urgent", async () => {
  const notice = {
    title: "Down: shop on production does not answer",
    lines: ["What the check saw: no answer"],
    link: "https://zelyq.example/ops#status",
    teamWide: false,
  };
  await channels.notify(teamId, [ownerId], { ...notice, audience: "urgent" });
  assert.equal(repliesTo(555).length, 1);
  assert.match(
    repliesTo(555)[0] ?? "",
    /Down: shop on production does not answer[\s\S]*ops#status/,
  );

  // Owner takes Telegram off warnings, and sets quiet hours around now.
  const now = new Date();
  const hh = (offset: number) =>
    `${String((now.getUTCHours() + offset + 24) % 24).padStart(2, "0")}:00`;
  const prefs = await inject(ownerCookie, "PUT", `/api/teams/${teamId}/ops/notify`, {
    urgent: ["email", "telegram"],
    warning: ["email"],
    approval: ["telegram"],
    weekly: ["email"],
    quietFrom: hh(-1),
    quietTo: hh(1),
    timeZone: "UTC",
  });
  assert.equal(prefs.statusCode, 200, prefs.body);
  calls.length = 0;
  await channels.notify(teamId, [ownerId], { ...notice, audience: "warning" });
  assert.equal(repliesTo(555).length, 0, "warnings: email only, as chosen");
  await channels.notify(teamId, [ownerId], { ...notice, audience: "approval" });
  assert.equal(repliesTo(555).length, 0, "quiet hours hold an approval");
  await channels.notify(teamId, [ownerId], { ...notice, audience: "urgent" });
  assert.equal(repliesTo(555).length, 1, "urgent goes in quiet hours too");
  assert.equal(await channels.wantsEmail(teamId, ownerId, "approval"), false);
  assert.equal(await channels.wantsEmail(teamId, ownerId, "urgent"), true);
  assert.equal(
    await channels.wantsEmail(teamId, ownerId, "warning"),
    false,
    "quiet hours hold a warning email too",
  );
  assert.equal(
    await channels.wantsEmail(teamId, ownerId, "warning", new Date(now.getTime() + 3 * 3600_000)),
    true,
    "after quiet hours, warnings come by email as chosen",
  );

  // Over midnight, and in the person's own time zone.
  const night = cleanPrefs({ quietFrom: "22:00", quietTo: "07:00", timeZone: "Africa/Freetown" });
  assert.equal(inQuietHours(night, new Date("2026-11-14T23:30:00Z")), true);
  assert.equal(inQuietHours(night, new Date("2026-11-14T12:00:00Z")), false);
  const sydney = cleanPrefs({ quietFrom: "22:00", quietTo: "07:00", timeZone: "Australia/Sydney" });
  assert.equal(inQuietHours(sydney, new Date("2026-11-14T12:00:00Z")), true, "23:00 in Sydney");
  // Nonsense is cleaned, not stored.
  const junk = cleanPrefs({
    urgent: ["sms", "telegram"],
    quietFrom: "25:00",
    timeZone: "Mars/Base",
  });
  assert.deepEqual(junk.urgent, ["telegram"]);
  assert.equal(junk.quietFrom, null);
  assert.equal(junk.timeZone, "UTC");
  await inject(ownerCookie, "PUT", `/api/teams/${teamId}/ops/notify`, {});
});

test("an alert from the watch reaches the linked chat as well as email", async () => {
  const alert = {
    id: "opz_test",
    teamId,
    checkId: null,
    severity: "urgent",
    title: "shop on production does not answer",
    detail: "no answer: timed out",
    openedAt: new Date().toISOString(),
    closedAt: null,
    closedHow: null,
    acknowledgedBy: null,
    acknowledgedAt: null,
    silencedUntil: null,
    silencedBy: null,
    escalation: 0,
    notifiedAt: null,
  };
  server.watch.events?.({ kind: "alert_opened", teamId, alert, to: [ownerId] });
  for (let i = 0; i < 50 && repliesTo(555).length === 0; i += 1)
    await new Promise((resolve) => setTimeout(resolve, 20));
  const text = repliesTo(555)[0] ?? "";
  assert.match(text, /^Down: shop on production does not answer/);
  assert.match(text, /What the check saw: no answer: timed out/);
  assert.match(text, /https:\/\/zelyq\.example\/ops#status/);
});

test("Slack: found by email, the code goes to their DMs and is typed back; wrong codes run out", async () => {
  const connect = await inject(ownerCookie, "PUT", `/api/teams/${teamId}/ops/channels/slack`, {
    token: SLACK_TOKEN,
    teamChat: "#ops",
  });
  assert.equal(connect.statusCode, 200, connect.body);
  assert.ok(!connect.body.includes(SLACK_TOKEN));

  // The owner's email is not in that Slack: said plainly.
  const missing = await inject(ownerCookie, "POST", `/api/teams/${teamId}/ops/channels/slack/link`);
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body, /No one in Acme uses owner@example.com/);

  const start = await inject(viewerCookie, "POST", `/api/teams/${teamId}/ops/channels/slack/link`);
  assert.equal(start.statusCode, 200, start.body);
  assert.equal(start.json().code, null, "the code is not shown in Zelyq: it goes to Slack");
  const dm = sent("chat.postMessage").find((call) => call.body.channel === "U77");
  const code = /Your Zelyq code: (\w+)/.exec(String(dm?.body.text))?.[1] as string;
  assert.ok(code);

  // Someone else typing it in their own session links nothing.
  const stolen = await inject(
    ownerCookie,
    "POST",
    `/api/teams/${teamId}/ops/channels/slack/confirm`,
    {
      code,
    },
  );
  assert.equal(stolen.statusCode, 400);

  const wrong = await inject(
    viewerCookie,
    "POST",
    `/api/teams/${teamId}/ops/channels/slack/confirm`,
    {
      code: "ZZZZZZZZ",
    },
  );
  assert.equal(wrong.statusCode, 400);
  const right = await inject(
    viewerCookie,
    "POST",
    `/api/teams/${teamId}/ops/channels/slack/confirm`,
    {
      code: code.toLowerCase(),
    },
  );
  assert.equal(right.statusCode, 200, right.body);
  const mine = right.json().links;
  assert.deepEqual(
    mine.map((link: { kind: string; label: string }) => `${link.kind} ${link.label}`),
    ["slack @vee"],
    "a viewer sees only their own links",
  );
  const again = await inject(
    viewerCookie,
    "POST",
    `/api/teams/${teamId}/ops/channels/slack/confirm`,
    {
      code,
    },
  );
  assert.equal(again.statusCode, 400, "used once only");

  // Five wrong tries and even the right code no longer works.
  await inject(viewerCookie, "POST", `/api/teams/${teamId}/ops/channels/slack/link`);
  const fresh = /Your Zelyq code: (\w+)/.exec(
    String(sent("chat.postMessage").at(-1)?.body.text),
  )?.[1] as string;
  for (let i = 0; i < 5; i += 1)
    await inject(viewerCookie, "POST", `/api/teams/${teamId}/ops/channels/slack/confirm`, {
      code: `WRONG${i}XX`,
    });
  const tooLate = await inject(
    viewerCookie,
    "POST",
    `/api/teams/${teamId}/ops/channels/slack/confirm`,
    {
      code: fresh,
    },
  );
  assert.equal(tooLate.statusCode, 400);
  assert.match(tooLate.body, /Too many wrong codes/);

  // A team-wide alert goes to the team's channel, once.
  calls.length = 0;
  await channels.notify(teamId, [], {
    audience: "urgent",
    title: "Down: x",
    lines: [],
    link: null,
    teamWide: true,
  });
  assert.deepEqual(
    sent("chat.postMessage").map((call) => call.body.channel),
    ["#ops"],
  );
});

test("Discord takes only a Discord webhook address, and never pings anyone", async () => {
  for (const address of [
    "http://discord.com/api/webhooks/42/abc",
    "https://discord.com.evil.example/api/webhooks/42/abc",
    "https://127.0.0.1/api/webhooks/42/abc",
    "https://discord.com:8443/api/webhooks/42/abc",
    "https://user:pw@discord.com/api/webhooks/42/abc",
    "https://discord.com/api/users/@me",
    "not even an address",
  ]) {
    assert.throws(() => discordWebhook(address), /not a Discord webhook/, address);
  }
  const done = await inject(ownerCookie, "PUT", `/api/teams/${teamId}/ops/channels/discord`, {
    webhook: WEBHOOK,
  });
  assert.equal(done.statusCode, 200, done.body);
  assert.ok(!done.body.includes("standin-webhook-token"));
  calls.length = 0;
  await channels.notify(teamId, [], {
    audience: "warning",
    title: "Warning: @everyone look",
    lines: [],
    link: null,
    teamWide: true,
  });
  const post = calls.find((call) => call.url.startsWith(WEBHOOK));
  assert.ok(post);
  assert.deepEqual(post.body.allowed_mentions, { parse: [] });
});

test("a person who leaves the team loses their links; disconnecting forgets them all", async () => {
  assert.ok(
    (await store.ops.channelLinks.listForTeam(teamId)).some((link) => link.userId === viewerId),
  );
  const members = await inject(ownerCookie, "GET", `/api/teams/${teamId}/members`);
  const viewerMember = members
    .json()
    .members.find((member: { userId: string }) => member.userId === viewerId);
  assert.ok(viewerMember);
  const removed = await inject(ownerCookie, "DELETE", `/api/teams/${teamId}/members/${viewerId}`);
  assert.equal(removed.statusCode < 300, true, removed.body);
  calls.length = 0;
  await channels.notify(teamId, [viewerId], {
    audience: "urgent",
    title: "Down: x",
    lines: [],
    link: null,
    teamWide: false,
  });
  assert.equal(sent("chat.postMessage").length, 0, "nothing to a person who left");
  assert.ok(
    !(await store.ops.channelLinks.listForTeam(teamId)).some((link) => link.userId === viewerId),
  );

  const off = await inject(ownerCookie, "DELETE", `/api/teams/${teamId}/ops/channels/telegram`);
  assert.equal(off.statusCode, 200);
  assert.ok(!(await store.ops.channelLinks.listForTeam(teamId)).some((l) => l.kind === "telegram"));
  assert.equal(await store.ops.channels.find(teamId, "telegram"), null);
});
