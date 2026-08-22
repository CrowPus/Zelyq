import { z } from "zod";
import { type ToolResult, defineTool, truncate } from "./types.js";

/**
 * Commands that would hang a turn forever. The agent has no terminal to
 * interrupt, so a blocking command is a dead session — refuse with an
 * explanation rather than letting it time out silently.
 */
const BLOCKING_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b/,
    reason:
      "Use the start_preview tool to run the dev server — it manages the process and the port.",
  },
  { pattern: /\bvite\b(?!.*\bbuild\b)/, reason: "Use start_preview for the dev server." },
  { pattern: /\b(tail\s+-f|watch\s|nodemon)\b/, reason: "Long-running watchers never return." },
];

export const runCommandTool = defineTool({
  name: "run_command",
  description:
    "Run a shell command in the project directory and return its output. Use it to install " +
    "dependencies, run builds, typecheck, and run tests. Commands must terminate on their own — " +
    "start the dev server with start_preview instead.",
  schema: z.object({
    command: z.string().describe("Shell command, e.g. npm install zod or npx tsc --noEmit"),
    timeout_ms: z.number().int().min(1000).max(600_000).optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    for (const { pattern, reason } of BLOCKING_PATTERNS) {
      if (pattern.test(input.command)) {
        return { output: `Refused: that command does not terminate. ${reason}`, isError: true };
      }
    }

    context.log(`$ ${input.command}`);
    const result = await context.runtime.exec(context.projectId, {
      command: input.command,
      timeoutMs: input.timeout_ms,
    });

    const parts = [
      result.stdout.trim() && `stdout:\n${result.stdout.trim()}`,
      result.stderr.trim() && `stderr:\n${result.stderr.trim()}`,
      `exit code: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
    ].filter(Boolean);

    return {
      output: truncate(parts.join("\n\n")),
      isError: result.exitCode !== 0,
    };
  },
});
