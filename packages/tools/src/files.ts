import { z } from "zod";
import { defineTool, type ToolContext, type ToolResult, truncate } from "./types.js";

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Read a text file from the project. Returns the file with line numbers so you can reference " +
    "exact lines. Always read a file before editing it.",
  schema: z.object({
    path: z.string().describe("Path relative to the project root, e.g. src/App.tsx"),
  }),
  async run(context, input): Promise<ToolResult> {
    const file = await context.runtime.readFile(context.projectId, input.path);
    if (file.encoding === "base64") {
      return { output: `${input.path} is a binary file (${file.content.length} base64 chars).` };
    }
    const numbered = file.content
      .split("\n")
      .map((line, index) => `${String(index + 1).padStart(5)}\t${line}`)
      .join("\n");
    const note = file.truncated ? "\n\n[file truncated — it is larger than the read limit]" : "";
    return { output: truncate(numbered) + note };
  },
});

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "Create a file or replace its entire contents. Use edit_file for small changes to an existing " +
    "file — a full rewrite risks losing code you did not intend to touch.",
  schema: z.object({
    path: z.string().describe("Path relative to the project root"),
    content: z.string().describe("The complete new contents of the file"),
  }),
  async run(context, input): Promise<ToolResult> {
    await context.runtime.writeFile(context.projectId, input.path, input.content);
    context.onFileChanged(input.path);
    const lines = input.content.split("\n").length;
    return { output: `Wrote ${input.path} (${lines} lines).` };
  },
});

export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "Replace an exact string in a file. `old_text` must appear exactly once — include surrounding " +
    "context to make it unique. Preferred over write_file for changes to existing files.",
  schema: z.object({
    path: z.string(),
    old_text: z.string().describe("Exact text to replace, including whitespace and indentation"),
    new_text: z.string().describe("Replacement text"),
  }),
  async run(context, input): Promise<ToolResult> {
    const file = await context.runtime.readFile(context.projectId, input.path);
    if (file.encoding !== "utf8") {
      return { output: `${input.path} is not a text file.`, isError: true };
    }

    const occurrences = file.content.split(input.old_text).length - 1;
    if (occurrences === 0) {
      return {
        output: `No match in ${input.path}. The text to replace was not found exactly — check whitespace and indentation, and read the file again if needed.`,
        isError: true,
      };
    }
    if (occurrences > 1) {
      return {
        output: `Found ${occurrences} matches in ${input.path}. Include more surrounding context so the text appears exactly once.`,
        isError: true,
      };
    }

    const updated = file.content.replace(input.old_text, input.new_text);
    await context.runtime.writeFile(context.projectId, input.path, updated);
    context.onFileChanged(input.path);
    return { output: `Edited ${input.path}.` };
  },
});

/**
 * Enough of a project to understand its shape, and no more.
 *
 * The agent had only ever met a ten-file template it scaffolded itself. A real
 * repository answers this question with thousands of paths, and a model that
 * spends its context reading a file list has none left for the work.
 */
const MAX_LISTED = 400;

export const listFilesTool = defineTool({
  name: "list_files",
  description:
    "List the project's files. Dependency and build directories are excluded, and so is anything " +
    "the project's .gitignore excludes. Use this first to learn the layout before guessing at " +
    "paths. Large projects are cut short — narrow with `path` rather than asking for everything.",
  schema: z.object({
    path: z.string().optional().describe("Subdirectory to list; defaults to the project root"),
    depth: z.number().int().min(1).max(16).optional().describe("How deep to walk (default 6)"),
  }),
  async run(context, input): Promise<ToolResult> {
    const entries = await context.runtime.listFiles(context.projectId, {
      path: input.path,
      depth: input.depth ?? 6,
    });
    if (entries.length === 0) return { output: "No files found." };

    const ignored = await gitIgnored(context, input.path);
    // An ignored directory hides everything beneath it, and git reports the
    // directory rather than each file inside it.
    const hidden = (candidate: string): boolean => {
      if (ignored.has(candidate)) return true;
      for (const entry of ignored) {
        if (candidate.startsWith(`${entry}/`)) return true;
      }
      return false;
    };
    const visible = entries.filter((entry) => !hidden(entry.path));
    if (visible.length === 0) return { output: "No files found." };

    const shown = visible.slice(0, MAX_LISTED);
    const rendered = shown
      .map((entry) =>
        entry.type === "directory" ? `${entry.path}/` : `${entry.path}  (${entry.size ?? 0}b)`,
      )
      .join("\n");

    const note =
      visible.length > shown.length
        ? `\n\n[showing ${shown.length} of ${visible.length}. Narrow with the path argument, ` +
          "or use search_files to find something specific.]"
        : "";
    return { output: truncate(rendered, 12_000) + note };
  },
});

/**
 * What the project's own .gitignore excludes, asked of git rather than
 * reimplemented. `git ls-files` already knows the rules exactly — including
 * nested ignore files and negations — so anything git would not show is
 * something the agent has no business reading either.
 *
 * Deliberately confined to the tool. The runtime's own file listing still sees
 * everything, because a snapshot that skipped ignored files would restore an
 * incomplete project when somebody undid a turn.
 */
async function gitIgnored(context: ToolContext, subPath?: string): Promise<Set<string>> {
  const result = await context.runtime
    .exec(context.projectId, {
      command: "git ls-files --others --ignored --exclude-standard --directory",
      ...(subPath ? { cwd: subPath } : {}),
      timeoutMs: 15_000,
    })
    .catch(() => null);

  // Not a git repository, or git is unavailable: nothing extra to hide.
  if (!result || result.exitCode !== 0) return new Set();

  const prefix = subPath ? `${subPath.replace(/\/+$/, "")}/` : "";
  return new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim().replace(/\/+$/, ""))
      .filter(Boolean)
      .map((line) => prefix + line),
  );
}

export const deleteFileTool = defineTool({
  name: "delete_file",
  description: "Delete a file or directory from the project. Deletions are not recoverable.",
  schema: z.object({ path: z.string() }),
  async run(context, input): Promise<ToolResult> {
    await context.runtime.deleteFile(context.projectId, input.path);
    context.onFileChanged(input.path);
    return { output: `Deleted ${input.path}.` };
  },
});

export const searchFilesTool = defineTool({
  name: "search_files",
  description:
    "Search file contents with a regular expression. Returns matching lines with their file and " +
    "line number. Much cheaper than reading files to find something.",
  schema: z.object({
    pattern: z.string().describe("Regular expression, passed to grep -E"),
    path: z.string().optional().describe("Restrict the search to this subdirectory"),
    max_results: z.number().int().min(1).max(200).optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    const max = input.max_results ?? 50;
    // Quote for the shell, and exclude the directories the file tree hides too.
    const pattern = input.pattern.replaceAll("'", "'\\''");
    const target = input.path ? input.path.replaceAll("'", "'\\''") : ".";
    const excludes =
      "--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build";
    const command = `grep -rnE --binary-files=without-match ${excludes} -m ${max} '${pattern}' '${target}' | head -n ${max}`;

    const result = await context.runtime.exec(context.projectId, { command, timeoutMs: 30_000 });
    if (result.exitCode !== 0 && result.stdout.trim() === "") {
      return { output: `No matches for /${input.pattern}/.` };
    }
    return { output: truncate(result.stdout, 15_000) };
  },
});
