import { z } from "zod";
import { defineTool, type ToolResult, truncate } from "./types.js";

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

/**
 * Commands that throw away work Zelyq cannot give back.
 *
 * A turn is undoable because a snapshot is taken before it, and snapshots do not
 * contain `.git` — it is excluded from the file tree everywhere. So anything the
 * agent does *through* git is outside the one safety net the user has been
 * promised. `git reset --hard` in somebody's repository is unrecoverable, and the
 * undo button sitting next to it is a lie.
 *
 * These are refused rather than warned about, because the model cannot know
 * which repository matters to whom.
 */
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bgit\s+reset\b[^|;&]*--hard\b/,
    reason: "A hard reset throws away changes that no snapshot can restore.",
  },
  {
    pattern: /\bgit\s+clean\b[^|;&]*-[a-z]*[fx]/,
    reason: "git clean deletes untracked files permanently.",
  },
  {
    pattern: /\bgit\s+(checkout|restore|switch)\b[^|;&]*(--force|-f|\.\s*$|--\s+\.)/,
    reason: "Discarding working-tree changes cannot be undone from a snapshot.",
  },
  {
    pattern: /\bgit\s+(push|remote\s+set-url)\b/,
    reason: "Zelyq works on a copy. Pushing is the user's decision, not yours.",
  },
  {
    pattern: /\bgit\s+branch\b[^|;&]*\s-[dD]\b/,
    reason: "Deleting a branch removes work that is not in the snapshot.",
  },
  {
    pattern: /\brm\s+-[a-z]*[rR][a-z]*f?\b[^|;&]*(\s\/|\s~|\s\.git\b)/,
    reason: "That would delete the repository itself, or something outside it.",
  },
];

export const runCommandTool = defineTool({
  name: "run_command",
  description:
    "Run a shell command in the project directory and return its output. Use it to install " +
    "dependencies, run builds, typecheck, and run tests. Commands must terminate on their own — " +
    "start the dev server with start_preview instead. Commands that throw away work are refused: " +
    "the project's git history is outside the snapshot that makes a turn undoable, so change " +
    "files with edit_file or write_file rather than through git.",
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

    for (const { pattern, reason } of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(input.command)) {
        return {
          output:
            `Refused: that would destroy work Zelyq cannot restore. ${reason} ` +
            "Change files with edit_file or write_file instead — those are covered by the " +
            "snapshot taken before this turn.",
          isError: true,
        };
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
