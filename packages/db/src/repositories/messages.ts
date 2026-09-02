import type { AttachmentRef, Message, MessageRole, ToolCall } from "@zelyq/core";
import { desc, eq } from "drizzle-orm";
import type { ZelyqDb } from "../client.js";
import { messages } from "../schema/sqlite.js";

type Row = typeof messages.$inferSelect;

/** A malformed row should not take down the whole transcript. */
function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type Mentions = NonNullable<Message["mentions"]>;

/** `{ skills, agents, plugins }` or null. Missing arrays default to empty; a
 * malformed value reads as null rather than breaking the transcript. */
function parseMentions(raw: string | null): Mentions | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Mentions>;
    const arr = (v: unknown) =>
      Array.isArray(v) ? (v.filter((x) => typeof x === "string") as string[]) : [];
    const mentions = { skills: arr(p.skills), agents: arr(p.agents), plugins: arr(p.plugins) };
    return mentions.skills.length || mentions.agents.length || mentions.plugins.length
      ? mentions
      : null;
  } catch {
    return null;
  }
}

/** Drop a mentions object with nothing in it to null, so an empty pick does not
 * leave a `{}` on the row. */
function normaliseMentions(mentions: Message["mentions"]): string | null {
  if (!mentions) return null;
  const skills = mentions.skills ?? [];
  const agents = mentions.agents ?? [];
  const plugins = mentions.plugins ?? [];
  if (!skills.length && !agents.length && !plugins.length) return null;
  return JSON.stringify({ skills, agents, plugins });
}

function toMessage(row: Row): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as MessageRole,
    content: row.content,
    thinking: row.thinking,
    toolCalls: parseJsonArray<ToolCall>(row.toolCalls),
    attachments: parseJsonArray<AttachmentRef>(row.attachments),
    mentions: parseMentions(row.mentions),
    snapshotId: row.snapshotId,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    createdAt: row.createdAt,
  };
}

export function messageRepository(db: ZelyqDb) {
  return {
    async append(message: Message): Promise<Message> {
      await db.insert(messages).values({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        thinking: message.thinking ?? null,
        toolCalls: JSON.stringify(message.toolCalls ?? []),
        attachments: JSON.stringify(message.attachments ?? []),
        mentions: normaliseMentions(message.mentions),
        snapshotId: message.snapshotId ?? null,
        tokensIn: message.tokensIn,
        tokensOut: message.tokensOut,
        createdAt: message.createdAt,
      });
      return message;
    },

    async update(
      id: string,
      patch: Partial<
        Pick<
          Message,
          "content" | "thinking" | "toolCalls" | "snapshotId" | "tokensIn" | "tokensOut"
        >
      >,
    ): Promise<void> {
      await db
        .update(messages)
        .set({
          ...(patch.content !== undefined ? { content: patch.content } : {}),
          ...(patch.thinking !== undefined ? { thinking: patch.thinking } : {}),
          ...(patch.toolCalls !== undefined ? { toolCalls: JSON.stringify(patch.toolCalls) } : {}),
          ...(patch.snapshotId !== undefined ? { snapshotId: patch.snapshotId } : {}),
          ...(patch.tokensIn !== undefined ? { tokensIn: patch.tokensIn } : {}),
          ...(patch.tokensOut !== undefined ? { tokensOut: patch.tokensOut } : {}),
        })
        .where(eq(messages.id, id));
    },

    /**
     * The history a resumed session replays (A5). Takes the **newest**
     * messages, not the oldest — an old cut kept turn 1 and silently dropped
     * everything recent, which is amnesia, not a window. Bounded by an
     * approximate token budget as well as a hard count, because tokens are the
     * quantity that actually matters and a single `write_file` turn can be
     * worth fifty greetings.
     *
     * The returned window is trimmed forward to start on a `user` message:
     * every provider 400s on a history that opens with an assistant turn, and
     * `buildAnthropicHistory` can pair tool calls correctly only given a clean
     * start.
     */
    async listForSession(
      sessionId: string,
      { limit = 400, maxTokens = 180_000 }: { limit?: number; maxTokens?: number } = {},
    ): Promise<Message[]> {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(desc(messages.createdAt))
        .limit(limit);

      return historyWindow(rows, maxTokens).map(toMessage);
    },
  };
}

/** Rough token count for one row — chars/4 over the text it carries. */
export function estimateRowTokens(row: {
  content?: string | null;
  thinking?: string | null;
  toolCalls?: string | null;
}): number {
  const text =
    (row.content?.length ?? 0) + (row.thinking?.length ?? 0) + (row.toolCalls?.length ?? 0);
  return Math.ceil(text / 4);
}

/**
 * Given rows newest-first, return a valid replay window in chronological order:
 * take rows back from the newest until `maxTokens` is spent (always at least
 * one), then drop any leading non-`user` rows so the window does not open on an
 * assistant turn — which every provider rejects.
 */
export function historyWindow<T extends { role: string } & Parameters<typeof estimateRowTokens>[0]>(
  rowsNewestFirst: T[],
  maxTokens: number,
): T[] {
  const kept: T[] = [];
  let tokens = 0;
  for (const row of rowsNewestFirst) {
    tokens += estimateRowTokens(row);
    if (tokens > maxTokens && kept.length > 0) break;
    kept.push(row);
  }
  kept.reverse();
  while (kept.length > 0 && kept[0]!.role !== "user") kept.shift();
  return kept;
}

export type MessageRepository = ReturnType<typeof messageRepository>;
