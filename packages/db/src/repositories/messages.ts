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

function toMessage(row: Row): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as MessageRole,
    content: row.content,
    thinking: row.thinking,
    toolCalls: parseJsonArray<ToolCall>(row.toolCalls),
    attachments: parseJsonArray<AttachmentRef>(row.attachments),
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
