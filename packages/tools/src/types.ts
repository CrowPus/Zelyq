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
  /**
   * Present only when a Supabase resource is linked to this
   * project. A capability to apply migrations and verify the backend by
   * calling the Zelyq server, which holds the Management credential. The tool
   * never sees a token beyond this session-scoped one.
   */
  supabaseBridge?: { url: string; token: string };
  /**
   * The linked project's public Supabase config (URL + publishable key).
   * `start_preview` merges it so the built app reaches the real backend.
   */
  supabasePreviewEnv?: Record<string, string>;
}

export interface ToolResult {
  /** What the model sees. Keep it terse and factual — this is context budget. */
  output: string;
  isError?: boolean;
  /**
   * Images a tool's result carries — a screenshot, for now. Same shape
   * `PromptAttachment` already uses, minus `filename`. Each provider
   * attaches these to a tool result its own way, some of them by way of a
   * synthetic follow-up message, because not every vendor's tool-result
   * shape can hold an image directly.
   */
  images?: Array<{ mimeType: string; data: string }>;
  /**
   * Set when `output` carries text from outside the user's control — a fetched
   * web page, a cloned repository's own files, a third-party API's response, an
   * issue tracker, a database row. The session wraps such output in
   * `<untrusted_content>` before the model sees it, and the base prompt tells
   * the model to treat anything inside those tags as data, never as
   * instruction (finding E1). A tool that returns only its own summary of such
   * content leaves this unset; a tool that passes the content through must set
   * it. `source` is a short, honest label — a URL, a repo name, a service.
   */
  untrusted?: { source: string };
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
