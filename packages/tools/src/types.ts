import type { RuntimeDriver } from "@zelyq/runtime";
import type { z } from "zod";

/**
 * Everything a tool is allowed to touch. A tool gets no ambient access to the
 * filesystem, the network, or the database — only what is on this context.
 */
export interface ToolContext {
  projectId: string;
  runtime: RuntimeDriver;
  /** Aborted when the user cancels the turn; long tools should honour it. */
  signal: AbortSignal;
  /** Report a changed path so the UI can refresh without polling. */
  onFileChanged(path: string): void;
  /** Structured progress for the event stream. */
  log(message: string): void;
}

export interface ToolResult {
  /** What the model sees. Keep it terse and factual — this is context budget. */
  output: string;
  isError?: boolean;
}

export interface ZelyqTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** Written for the model, not for humans: say when to use it and what it returns. */
  description: string;
  schema: TSchema;
  run(context: ToolContext, input: z.infer<TSchema>): Promise<ToolResult>;
}

export function defineTool<TSchema extends z.ZodTypeAny>(
  tool: ZelyqTool<TSchema>,
): ZelyqTool<TSchema> {
  return tool;
}

/** Truncate tool output so one `cat` of a lockfile cannot eat the context window. */
export function truncate(text: string, maxChars = 30_000): string {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.2));
  const omitted = text.length - head.length - tail.length;
  return `${head}\n\n… [${omitted} characters omitted] …\n\n${tail}`;
}
