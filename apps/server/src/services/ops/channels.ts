import { createHash, randomBytes } from "node:crypto";
import {
  DEFAULT_NOTIFY_PREFS,
  newId,
  type OpsChannelKind,
  type OpsChannelsView,
  type OpsLinkStart,
  type OpsNotifyAudience,
  type OpsNotifyPrefs,
  type OpsPersonalChannel,
} from "@zelyq/core";
import type { OpsChannelLinkRow, OpsChannelRow, Store } from "@zelyq/db";
import { guardedRequest } from "../net-guard.js";
import type { SecretBox } from "../secrets.js";

/**
 * Where the watch and Ops reach people beyond email (075 Step 2): Telegram,
 * Slack and Discord. A team connects each service once (an admin pastes a bot
 * token or a webhook); each person links their own chat with a one-time code.
 *
 * Tokens are encrypted with the server's key, never put in the Vault (any
 * editor's pipeline can read a Vault secret by name, and could then send as
 * the team's bot). A message never carries a secret. Every request goes
 * through the network guard, to the service's own address only.
 */

export interface HttpAnswer {
  status: number;
  body: string;
}
export type Http = (
  url: string,
  init: {
    method: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
) => Promise<HttpAnswer>;

const guarded: Http = async (url, init) => {
  const answer = await guardedRequest(url, {
    level: "strict",
    method: init.method,
    headers: init.headers,
    body: init.body,
    timeoutMs: init.timeoutMs ?? 15_000,
    maxBytes: 2_000_000,
  });
  return { status: answer.status, body: answer.body };
};

/** A thing to tell, already in plain words. */
export interface Notice {
  audience: OpsNotifyAudience;
  /** One line: what happened. */
  title: string;
  /** The rest, a few short lines. */
  lines: string[];
  /** Where to answer it in Zelyq. */
  link: string | null;
  /** The team's shared place hears it too (Slack channel, Discord). */
  teamWide: boolean;
}

const CODE_TTL_MS = 15 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TELEGRAM = "https://api.telegram.org";
const SLACK = "https://slack.com/api";
const DISCORD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
]);
/** Telegram long-poll: how long one getUpdates waits for news. */
const POLL_WAIT_S = 25;
/** After a failed poll, wait this long before the next. */
const POLL_BACKOFF_MS = 30_000;
const WRONG_TRIES = 5;

interface Secret {
  token?: string;
  webhook?: string;
}

export class ChannelError extends Error {}

export class ChannelService {
  private timer: NodeJS.Timeout | null = null;
  private readonly polling = new Set<string>();
  private readonly resting = new Map<string, number>();
  /** Wrong Slack codes typed, per person: too many and the code is gone. */
  private readonly wrong = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly secrets: SecretBox,
    /** The one way out to the services (a stand-in under test). */
    public http: Http = guarded,
  ) {}

  // ------------------------------------------------------------ connecting

  /** An admin connects (or replaces) a service for the team; it is tried before it is kept. */
  async connect(
    teamId: string,
    kind: OpsChannelKind,
    input: { token?: string; webhook?: string; teamChat?: string | null },
    userId: string,
    now = new Date(),
  ): Promise<OpsChannelRow> {
    let name: string;
    let account: string;
    let teamChat: string | null = null;
    const secret: Secret = {};
    if (kind === "telegram") {
      const token = (input.token ?? "").trim();
      if (!/^\d{5,16}:[A-Za-z0-9_-]{30,64}$/.test(token))
        throw new ChannelError(
          "That does not look like a Telegram bot token (it reads 123456:ABC…).",
        );
      const me = await this.telegram(token, "getMe", {});
      name = `@${String(me.username)}`;
      account = `telegram:${String(me.id)}`;
      // One bot reads its messages for one team: two readers would steal each other's codes.
      const others = (await this.store.ops.channels.findByAccount(account)).filter(
        (row) => row.teamId !== teamId,
      );
      if (others.length > 0)
        throw new ChannelError(
          `${name} is already connected to another team. Make a new bot with @BotFather for this team.`,
        );
      secret.token = token;
    } else if (kind === "slack") {
      const token = (input.token ?? "").trim();
      if (!/^xoxb-[A-Za-z0-9-]{10,200}$/.test(token))
        throw new ChannelError("That does not look like a Slack bot token (it starts with xoxb-).");
      const me = await this.slack(token, "auth.test", {});
      account = `slack:${String(me.team_id)}:${String(me.user_id)}`;
      teamChat = input.teamChat?.trim() || null;
      name = `${String(me.team)}${teamChat ? ` · ${teamChat}` : ""}`;
      secret.token = token;
    } else {
      const webhook = (input.webhook ?? "").trim();
      const url = discordWebhook(webhook);
      const answer = await this.http(url, { method: "GET" });
      if (answer.status !== 200)
        throw new ChannelError(`Discord did not accept that webhook (answer ${answer.status}).`);
      const hook = parse(answer.body);
      account = `discord:${String(hook.id ?? "")}`;
      name = `Discord · ${String(hook.name ?? "webhook")}`;
      secret.webhook = url;
    }

    const at = now.toISOString();
    const found = await this.store.ops.channels.find(teamId, kind);
    const sealed = this.secrets.encrypt(JSON.stringify(secret));
    if (found) {
      // Another bot or workspace: the chats linked to the old one cannot be reached by it.
      if (found.account !== account) await this.store.ops.channelLinks.removeForKind(teamId, kind);
      const patch = {
        name,
        account,
        secret: sealed,
        teamChat,
        status: "ok",
        lastError: null,
        updatedAt: at,
        ...(found.account !== account ? { pollOffset: 0 } : {}),
      };
      await this.store.ops.channels.update(found.id, patch);
      return { ...found, ...patch };
    }
    return await this.store.ops.channels.create({
      id: newId("opsChannel"),
      teamId,
      kind,
      name,
      account,
      secret: sealed,
      teamChat,
      status: "ok",
      lastError: null,
      pollOffset: 0,
      createdBy: userId,
      createdAt: at,
      updatedAt: at,
    });
  }

  /** Forgets the service and every chat linked through it. */
  async disconnect(teamId: string, kind: OpsChannelKind): Promise<void> {
    const found = await this.store.ops.channels.find(teamId, kind);
    if (!found) return;
    await this.store.ops.channelLinks.removeForKind(teamId, kind);
    await this.store.ops.channels.remove(found.id);
  }

  /** Sends a test to the team's place and to the asking person's own chat; says where it went. */
  async test(teamId: string, kind: OpsChannelKind, userId: string): Promise<string[]> {
    const channel = await this.store.ops.channels.find(teamId, kind);
    if (!channel) throw new ChannelError("That service is not connected.");
    const text = "Zelyq test: alerts from your team will arrive here.";
    const went: string[] = [];
    const errors: string[] = [];
    const link = (await this.store.ops.channelLinks.listForTeam(teamId)).find(
      (row) => row.kind === kind && row.userId === userId,
    );
    const targets: Array<{ chat: string | null; where: string }> = [];
    if (kind === "discord") targets.push({ chat: null, where: channel.name });
    if (kind === "slack" && channel.teamChat)
      targets.push({ chat: channel.teamChat, where: channel.teamChat });
    if (link) targets.push({ chat: link.chatId, where: "your own chat" });
    if (targets.length === 0)
      throw new ChannelError(
        kind === "telegram"
          ? "Link your own Telegram first (Link my Telegram), then test."
          : "Link your own Slack or set a team channel first, then test.",
      );
    for (const target of targets) {
      try {
        await this.deliver(channel, target.chat, text);
        went.push(target.where);
      } catch (error) {
        errors.push(`${target.where}: ${(error as Error).message}`);
      }
    }
    await this.mark(channel, errors[0] ?? null);
    if (went.length === 0) throw new ChannelError(errors.join("; "));
    return went;
  }

  // ------------------------------------------------------------ linking a person

  /** A one-time code for a person to link their own chat. */
  async startLink(
    teamId: string,
    kind: OpsChannelKind,
    user: { id: string; email: string },
    now = new Date(),
  ): Promise<OpsLinkStart> {
    if (kind === "discord")
      throw new ChannelError("Discord sends to the team's channel; there is nothing to link.");
    const channel = await this.store.ops.channels.find(teamId, kind);
    if (!channel) throw new ChannelError("An admin connects this service first.");
    const code = makeCode();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
    const row = {
      codeHash: hash(code),
      teamId,
      userId: user.id,
      kind,
      chatId: null as string | null,
      label: null as string | null,
      expiresAt,
      usedAt: null,
    };
    if (kind === "telegram") {
      await this.store.ops.linkCodes.create(row);
      const bot = channel.name.replace(/^@/, "");
      return {
        kind,
        url: `https://t.me/${encodeURIComponent(bot)}?start=${code}`,
        code,
        expiresAt,
        words: `Open the link and press Start in Telegram, or send ${channel.name} the message "/start ${code}". The code works once, for 15 minutes.`,
      };
    }
    // Slack: found by the person's own email, and the code goes to their direct messages;
    // typing it back here proves the Slack account is theirs.
    const token = this.open(channel).token as string;
    let found: Record<string, unknown>;
    try {
      found = await this.slack(token, "users.lookupByEmail", { email: user.email }, "GET");
    } catch {
      throw new ChannelError(
        `No one in ${channel.name.split(" · ")[0]} uses ${user.email}. Use the same email in Slack and Zelyq.`,
      );
    }
    const person = found.user as { id: string; name?: string };
    await this.slack(token, "chat.postMessage", {
      channel: person.id,
      text: `Your Zelyq code: ${code}\nType it in Zelyq (Ops → Alerts) to get alerts here. It works once, for 15 minutes. If you did not ask for it, ignore this message.`,
    });
    await this.store.ops.linkCodes.create({
      ...row,
      chatId: person.id,
      label: person.name ? `@${person.name}` : null,
    });
    this.wrong.delete(`${teamId}/${user.id}`);
    return {
      kind,
      url: null,
      code: null,
      expiresAt,
      words: "Zelyq sent you a code in Slack, in your direct messages. Type it here.",
    };
  }

  /** Slack: the person types the code they were sent. */
  async confirmLink(
    teamId: string,
    userId: string,
    code: string,
    now = new Date(),
  ): Promise<OpsChannelLinkRow> {
    const key = `${teamId}/${userId}`;
    const found = await this.store.ops.linkCodes.find(hash(code.trim().toUpperCase()));
    const fits =
      found &&
      found.teamId === teamId &&
      found.userId === userId &&
      found.kind === "slack" &&
      found.chatId &&
      !found.usedAt &&
      found.expiresAt > now.toISOString() &&
      (this.wrong.get(key) ?? 0) < WRONG_TRIES;
    if (!fits || !found) {
      this.wrong.set(key, (this.wrong.get(key) ?? 0) + 1);
      throw new ChannelError(
        (this.wrong.get(key) ?? 0) >= WRONG_TRIES
          ? "Too many wrong codes. Ask for a new one."
          : "That code did not work. Check it, or ask for a new one.",
      );
    }
    if (!(await this.store.ops.linkCodes.use(found.codeHash, now.toISOString())))
      throw new ChannelError("That code was already used. Ask for a new one.");
    this.wrong.delete(key);
    return await this.store.ops.channelLinks.put({
      id: newId("opsChannelLink"),
      teamId,
      userId,
      kind: "slack",
      chatId: found.chatId as string,
      label: found.label,
      createdAt: now.toISOString(),
    });
  }

  async unlink(teamId: string, linkId: string, userId: string, isAdmin: boolean): Promise<void> {
    const link = await this.store.ops.channelLinks.findById(linkId);
    if (!link || link.teamId !== teamId) throw new ChannelError("No such linked chat.");
    if (link.userId !== userId && !isAdmin)
      throw new ChannelError("Only the person, or an admin, unlinks a chat.");
    await this.store.ops.channelLinks.remove(link.id);
  }

  // ------------------------------------------------------------ what a person wants

  async prefsOf(teamId: string, userId: string): Promise<OpsNotifyPrefs> {
    const row = (await this.store.ops.notifyPrefs.listForTeam(teamId)).find(
      (one) => one.userId === userId,
    );
    return row ? cleanPrefs(parse(row.prefs)) : { ...DEFAULT_NOTIFY_PREFS };
  }

  async setPrefs(
    teamId: string,
    userId: string,
    prefs: unknown,
    now = new Date(),
  ): Promise<OpsNotifyPrefs> {
    const clean = cleanPrefs(prefs);
    await this.store.ops.notifyPrefs.put({
      teamId,
      userId,
      prefs: JSON.stringify(clean),
      updatedAt: now.toISOString(),
    });
    return clean;
  }

  /** Whether this person wants this kind of news by email. */
  async wantsEmail(teamId: string, userId: string, audience: OpsNotifyAudience): Promise<boolean> {
    return (await this.prefsOf(teamId, userId))[audience].includes("email");
  }

  async view(teamId: string, userId: string, isAdmin: boolean): Promise<OpsChannelsView> {
    const members = await this.store.teams.listMembers(teamId);
    const links = await this.currentLinks(teamId, members);
    return {
      channels: (await this.store.ops.channels.listForTeam(teamId)).map((row) => ({
        kind: row.kind as OpsChannelKind,
        name: row.name,
        status: row.status === "ok" ? "ok" : "failing",
        lastError: row.lastError,
        teamChat: row.teamChat,
        updatedAt: row.updatedAt,
      })),
      links: links
        .filter((row) => isAdmin || row.userId === userId)
        .map((row) => ({
          id: row.id,
          kind: row.kind as OpsChannelKind,
          userId: row.userId,
          userName: members.find((member) => member.userId === row.userId)?.name ?? "",
          label: row.label,
          createdAt: row.createdAt,
        })),
      prefs: await this.prefsOf(teamId, userId),
      canManage: isAdmin,
      me: userId,
    };
  }

  /** Links of people still in the team; a person who left loses theirs. */
  private async currentLinks(
    teamId: string,
    members?: Array<{ userId: string }>,
  ): Promise<OpsChannelLinkRow[]> {
    const people = new Set(
      (members ?? (await this.store.teams.listMembers(teamId))).map((member) => member.userId),
    );
    const links = await this.store.ops.channelLinks.listForTeam(teamId);
    for (const link of links.filter((row) => !people.has(row.userId)))
      await this.store.ops.channelLinks.remove(link.id);
    return links.filter((row) => people.has(row.userId));
  }

  // ------------------------------------------------------------ sending

  /**
   * Tells these people through their own chats, as each one chose, and the team's shared
   * place when the notice is team-wide. Email is the mailer's; this never throws.
   */
  async notify(teamId: string, userIds: string[], notice: Notice, now = new Date()): Promise<void> {
    try {
      const channels = await this.store.ops.channels.listForTeam(teamId);
      if (channels.length === 0) return;
      const links = await this.currentLinks(teamId);
      const text = render(notice);
      const sends: Array<Promise<void>> = [];
      for (const userId of new Set(userIds)) {
        const prefs = await this.prefsOf(teamId, userId);
        const quiet = notice.audience !== "urgent" && inQuietHours(prefs, now);
        if (quiet) continue;
        for (const kind of prefs[notice.audience]) {
          if (kind === "email") continue;
          const channel = channels.find((row) => row.kind === kind);
          const link = links.find((row) => row.userId === userId && row.kind === kind);
          if (channel && link) sends.push(this.send(channel, link.chatId, text));
        }
      }
      if (notice.teamWide) {
        for (const channel of channels) {
          if (channel.kind === "discord") sends.push(this.send(channel, null, text));
          if (channel.kind === "slack" && channel.teamChat)
            sends.push(this.send(channel, channel.teamChat, text));
        }
      }
      await Promise.all(sends);
    } catch {
      // The watch and Ops go on whatever a chat service does.
    }
  }

  private async send(channel: OpsChannelRow, chat: string | null, text: string): Promise<void> {
    try {
      await this.deliver(channel, chat, text);
      if (channel.status !== "ok") await this.mark(channel, null);
    } catch (error) {
      await this.mark(channel, (error as Error).message);
    }
  }

  private async deliver(channel: OpsChannelRow, chat: string | null, text: string): Promise<void> {
    const secret = this.open(channel);
    if (channel.kind === "telegram") {
      await this.telegram(secret.token as string, "sendMessage", {
        chat_id: chat,
        text,
        disable_web_page_preview: true,
      });
    } else if (channel.kind === "slack") {
      await this.slack(secret.token as string, "chat.postMessage", {
        channel: chat,
        text,
        unfurl_links: false,
      });
    } else {
      const answer = await this.http(`${secret.webhook as string}?wait=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Never ping anyone through a message: no @everyone, no roles.
        body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
      });
      if (answer.status >= 300) throw new ChannelError(`Discord answered ${answer.status}.`);
    }
  }

  private async mark(channel: OpsChannelRow, error: string | null): Promise<void> {
    channel.status = error ? "failing" : "ok";
    channel.lastError = error;
    await this.store.ops.channels.update(channel.id, {
      status: channel.status,
      lastError: error ? error.slice(0, 300) : null,
    });
  }

  // ------------------------------------------------------------ Telegram: reading the codes

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollAll(), 3000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async pollAll(): Promise<void> {
    const telegrams = (await this.store.ops.channels.listAll().catch(() => [])).filter(
      (row) => row.kind === "telegram",
    );
    for (const channel of telegrams) {
      if (this.polling.has(channel.id)) continue;
      if ((this.resting.get(channel.id) ?? 0) > Date.now()) continue;
      this.polling.add(channel.id);
      void this.poll(channel)
        .catch(() => this.resting.set(channel.id, Date.now() + POLL_BACKOFF_MS))
        .finally(() => this.polling.delete(channel.id));
    }
  }

  /**
   * One read of the bot's new messages. Only "/start CODE" in a private chat does anything:
   * a code that fits links that chat to its person. Anything else, from anyone, is ignored.
   */
  async poll(channel: OpsChannelRow, wait = POLL_WAIT_S, now = () => new Date()): Promise<void> {
    const token = this.open(channel).token as string;
    const updates = (await this.telegram(
      token,
      "getUpdates",
      { offset: channel.pollOffset, timeout: wait, allowed_updates: ["message"] },
      "POST",
      (wait + 10) * 1000,
    )) as unknown as Array<{
      update_id: number;
      message?: {
        text?: string;
        chat?: { id: number; type?: string; username?: string; first_name?: string };
      };
    }>;
    if (!Array.isArray(updates) || updates.length === 0) return;
    for (const update of updates) {
      const message = update.message;
      const words = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,32})\s*$/.exec(message?.text ?? "");
      if (!message?.chat || message.chat.type !== "private" || !words) continue;
      const chatId = String(message.chat.id);
      const reply = await this.linkTelegram(
        channel,
        chatId,
        words[1] as string,
        message.chat,
        now(),
      );
      await this.telegram(token, "sendMessage", { chat_id: chatId, text: reply }).catch(
        () => undefined,
      );
    }
    const next = Math.max(...updates.map((update) => update.update_id)) + 1;
    channel.pollOffset = next;
    await this.store.ops.channels.update(channel.id, { pollOffset: next });
  }

  private async linkTelegram(
    channel: OpsChannelRow,
    chatId: string,
    code: string,
    chat: { username?: string; first_name?: string },
    now: Date,
  ): Promise<string> {
    const nope = "That code did not work. Get a new one in Zelyq: Ops → Alerts.";
    const found = await this.store.ops.linkCodes.find(hash(code.toUpperCase()));
    if (
      !found ||
      found.teamId !== channel.teamId ||
      found.kind !== "telegram" ||
      found.usedAt ||
      found.expiresAt <= now.toISOString()
    )
      return nope;
    const member = (await this.store.teams.listMembers(channel.teamId)).find(
      (row) => row.userId === found.userId,
    );
    if (!member) return nope;
    if (!(await this.store.ops.linkCodes.use(found.codeHash, now.toISOString()))) return nope;
    await this.store.ops.channelLinks.put({
      id: newId("opsChannelLink"),
      teamId: channel.teamId,
      userId: found.userId,
      kind: "telegram",
      chatId,
      label: chat.username ? `@${chat.username}` : (chat.first_name ?? null),
      createdAt: now.toISOString(),
    });
    return `Linked. ${member.name || member.email} will get Zelyq alerts here. Change what comes here in Zelyq: Ops → Alerts.`;
  }

  // ------------------------------------------------------------ the services' own calls

  private open(channel: OpsChannelRow): Secret {
    const plain = this.secrets.decrypt(channel.secret);
    if (!plain) throw new ChannelError("The saved token cannot be read; connect it again.");
    return parse(plain) as Secret;
  }

  private async telegram(
    token: string,
    method: string,
    body: Record<string, unknown>,
    verb: "GET" | "POST" = "POST",
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    let answer: HttpAnswer;
    try {
      answer = await this.http(`${TELEGRAM}/bot${token}/${method}`, {
        method: verb,
        headers: { "content-type": "application/json" },
        body: verb === "POST" ? JSON.stringify(body) : undefined,
        timeoutMs,
      });
    } catch (error) {
      throw new ChannelError(
        `Telegram could not be reached: ${scrub((error as Error).message, token)}`,
      );
    }
    const json = parse(answer.body);
    if (!json.ok) {
      const why = String(json.description ?? `answer ${answer.status}`);
      throw new ChannelError(
        answer.status === 401 ? "Telegram refused the token." : `Telegram: ${scrub(why, token)}`,
      );
    }
    return json.result as Record<string, unknown>;
  }

  private async slack(
    token: string,
    method: string,
    body: Record<string, string | boolean | null>,
    verb: "GET" | "POST" = "POST",
  ): Promise<Record<string, unknown>> {
    const query =
      verb === "GET" ? `?${new URLSearchParams(body as Record<string, string>).toString()}` : "";
    let answer: HttpAnswer;
    try {
      answer = await this.http(`${SLACK}/${method}${query}`, {
        method: verb,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: verb === "POST" ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new ChannelError(
        `Slack could not be reached: ${scrub((error as Error).message, token)}`,
      );
    }
    const json = parse(answer.body);
    if (!json.ok) {
      const why = String(json.error ?? `answer ${answer.status}`);
      throw new ChannelError(
        why === "invalid_auth" || why === "not_authed"
          ? "Slack refused the token."
          : why === "channel_not_found" || why === "not_in_channel"
            ? "Slack: the bot is not in that channel. Invite it there (/invite @your-bot)."
            : why === "missing_scope"
              ? "Slack: the app is missing a permission. Make it from Zelyq's ready-made manifest."
              : `Slack: ${why}`,
      );
    }
    return json;
  }
}

// ------------------------------------------------------------ small pieces

function makeCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function hash(code: string): string {
  return createHash("sha256").update(`zelyq-ops-link:${code}`).digest("hex");
}

function parse(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function scrub(text: string, token: string): string {
  return token ? text.split(token).join("…") : text;
}

/** Only a Discord webhook address, nothing else. */
export function discordWebhook(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new ChannelError("That is not a Discord webhook address.");
  }
  if (
    url.protocol !== "https:" ||
    !DISCORD_HOSTS.has(url.hostname) ||
    url.port !== "" ||
    url.username ||
    url.password ||
    !/^\/api(\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  )
    throw new ChannelError(
      "That is not a Discord webhook address (https://discord.com/api/webhooks/…).",
    );
  return `https://${url.hostname}${url.pathname.replace(/\/$/, "")}`;
}

const PERSONAL: OpsPersonalChannel[] = ["email", "telegram", "slack"];

export function cleanPrefs(input: unknown): OpsNotifyPrefs {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const list = (key: OpsNotifyAudience) => {
    const raw = value[key];
    return Array.isArray(raw)
      ? PERSONAL.filter((kind) => raw.includes(kind))
      : [...DEFAULT_NOTIFY_PREFS[key]];
  };
  const time = (raw: unknown) =>
    typeof raw === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
  let timeZone = typeof value.timeZone === "string" ? value.timeZone : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    timeZone = "UTC";
  }
  const quietFrom = time(value.quietFrom);
  const quietTo = time(value.quietTo);
  return {
    urgent: list("urgent"),
    warning: list("warning"),
    approval: list("approval"),
    weekly: list("weekly"),
    quietFrom: quietFrom && quietTo ? quietFrom : null,
    quietTo: quietFrom && quietTo ? quietTo : null,
    timeZone,
  };
}

export function inQuietHours(prefs: OpsNotifyPrefs, now: Date): boolean {
  if (!prefs.quietFrom || !prefs.quietTo) return false;
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: prefs.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const from = prefs.quietFrom;
  const to = prefs.quietTo;
  // Over midnight (22:00–07:00) or within a day (13:00–14:00).
  return from <= to ? local >= from && local < to : local >= from || local < to;
}

function render(notice: Notice): string {
  return [notice.title, ...notice.lines, ...(notice.link ? ["", notice.link] : [])]
    .join("\n")
    .slice(0, 3500);
}
