import type { AttachmentRef, Message, MessageRole, ToolCall } from "@zelyq/core";
import { asc, eq } from "drizzle-orm";
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

    async listForSession(sessionId: string, limit = 500): Promise<Message[]> {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.sessionId, sessionId))
        .orderBy(asc(messages.createdAt))
        .limit(limit);
      return rows.map(toMessage);
    },
  };
}

export type MessageRepository = ReturnType<typeof messageRepository>;
