import { containsOmittedMarker } from "@zelyq/core";
import { z } from "zod";
import { applyEdit } from "./edit-match.js";
import { defineTool, type ToolContext, type ToolResult, truncate } from "./types.js";

/**
 * A per-path lock so two mutations to the same file in one parallel batch
 * cannot both read the original and both write, silently losing the first.
 * `edit_file` is a read-modify-write; the run loop fires the batch through
 * `Promise.all`. Keyed by project + normalised path; each op chains onto the
 * previous one for that key. `run_command` racing an edit is a wider case left
 * for the batch-partition follow-up.
 */
const pathLocks = new Map<string, Promise<unknown>>();

async function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = pathLocks.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  pathLocks.set(key, settled);
  try {
    return await run;
  } finally {
    // Only clear if no later call has already chained onto this key.
    if (pathLocks.get(key) === settled) pathLocks.delete(key);
  }
}

const lockKey = (projectId: string, path: string) => `${projectId}:${path.replace(/^\.?\/+/, "")}`;

/**
 * A file this short always comes back whole, whatever window was asked for.
 *
 * Models economise on read size by paging a file in 20–40 line slices. Measured
 * on a real build: a 467-line `main.py` read in seven slices, a 414-line
 * component in six. But a turn is limited by *steps*, not by read size, and
 * every step re-sends the whole conversation — so seven slices cost six extra
 * steps AND several times the tokens of one read. The whole file is cheaper on
 * both counts.
 */
export const WHOLE_FILE_LINES = 600;
/** For a longer file, the smallest window worth a step. */
export const MIN_READ_WINDOW = 200;

/** A slice of a file with 1-indexed line numbers, `truncate()`-free — never
 * elides the middle of source, cuts at the end with how to resume. */
function numberedSlice(content: string, offset?: number, limit?: number): string {
  const lines = content.split("\n");
  const total = lines.length;
  // "Short" means it comes back whole. A file under the line limit with very
  // long lines (minified CSS, a data file) can still be over the size cap, and
  // then offset/limit must work or its end can never be read.
  const HARD = 60_000;
  const short = total <= WHOLE_FILE_LINES && content.length + total * 7 <= HARD;
  const start = short ? 0 : Math.max(0, (offset ?? 1) - 1);
  const count = short ? total : Math.max(limit ?? 2000, MIN_READ_WINDOW);
  const shown = lines.slice(start, start + count);
  const end = start + shown.length;
  let body = shown.map((line, i) => `${String(start + i + 1).padStart(5)}\t${line}`).join("\n");
  if (body.length > HARD) {
    const lastWhole = body.slice(0, HARD).split("\n").length - 1;
    body = `${body.slice(0, HARD)}\n\n[cut at ${HARD} chars — call read_file again with offset: ${start + Math.max(lastWhole, 1)} for the rest]`;
  } else if (short && (offset !== undefined || limit !== undefined)) {
    // Said explicitly, or the model keeps paging a file it already has.
    body += `\n\n[the whole file — ${total} lines. Files up to ${WHOLE_FILE_LINES} lines always come back in full; there is nothing more to page]`;
  } else if (end < total) {
    body += `\n\n[showing lines ${start + 1}–${end} of ${total} — call read_file again with offset: ${end + 1} for the rest]`;
  } else if (start > 0) {
    body += `\n\n[showing lines ${start + 1}–${end} of ${total}]`;
  }
  return body;
}

/** ±`ctx` lines around a changed region, numbered, for edit/write to hand back. */
function regionSnippet(content: string, fromLine: number, throughLine: number, ctx = 3): string {
  const lines = content.split("\n");
  const start = Math.max(0, fromLine - 1 - ctx);
  const end = Math.min(lines.length, throughLine + ctx);
  return lines
    .slice(start, end)
    .map((line, i) => `${String(start + i + 1).padStart(5)}\t${line}`)
    .join("\n");
}

/** A minimal line diff: trims the common head and tail, shows the middle as
 * `-`/`+`, capped. Enough to verify a `write_file` landed; not a full LCS. */
function briefDiff(before: string, after: string, cap = 80): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const removed = a.slice(head, a.length - tail);
  const added = b.slice(head, b.length - tail);
  if (removed.length === 0 && added.length === 0) return "(no textual change)";
  const lines: string[] = [`@@ around line ${head + 1} @@`];
  for (const line of removed.slice(0, cap)) lines.push(`- ${line}`);
  if (removed.length > cap) lines.push(`  …and ${removed.length - cap} more removed`);
  for (const line of added.slice(0, cap)) lines.push(`+ ${line}`);
  if (added.length > cap) lines.push(`  …and ${added.length - cap} more added`);
  return lines.join("\n");
}

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Read a text file from the project, with line numbers. Always read a file before editing it. " +
    "Each call is one step from a limited budget, so read the whole file at once: a file of up to " +
    `${WHOLE_FILE_LINES} lines always comes back in full, whatever \`offset\`/\`limit\` say. ` +
    "`offset`/`limit` are for longer files only — a large file's middle is never elided. " +
    "Several read_file calls in one reply run together and cost one step.",
  schema: z.object({
    path: z.string().describe("Path relative to the project root, e.g. src/App.tsx"),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("First line to read (1-indexed). Use with `limit` to page a long file."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe("How many lines to read from `offset`. Default 2000."),
  }),
  async run(context, input): Promise<ToolResult> {
    const file = await context.runtime.readFile(context.projectId, input.path);
    if (file.encoding === "base64") {
      return { output: `${input.path} is a binary file (${file.content.length} base64 chars).` };
    }
    const body = numberedSlice(file.content, input.offset, input.limit);
    const note = file.truncated
      ? "\n\n[file also hit the 2 MB runtime ceiling — content beyond that is not available]"
      : "";
    return { output: body + note };
  },
});

/**
 * Older history replaced stored file contents with a one-line placeholder, and
 * models copied it back as real content. Never let it reach disk.
 */
function omittedMarkerRefusal(path: string, field: string): ToolResult {
  return {
    output:
      `Refused: ${field} for ${path} contains the history placeholder "[omitted from history ...]". ` +
      "That text is not file content — it marks where earlier content was left out of the conversation. " +
      `Nothing was written. read_file ${path} to see what is on disk, then send the real text.`,
    isError: true,
  };
}

/** A rewrite this drastic is almost always a mistake, not an intent. */
const SHRINK_MIN_PRIOR_LINES = 40;
const SHRINK_MAX_NEW_LINES = 3;

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "Create a file or replace its entire contents. Use edit_file for small changes to an existing " +
    "file — a full rewrite risks losing code you did not intend to touch.",
  schema: z.object({
    path: z.string().describe("Path relative to the project root"),
    content: z.string().describe("The complete new contents of the file"),
    replace_large_file: z
      .boolean()
      .optional()
      .describe(
        "Set true only when you mean to cut an existing file of 40+ lines down to 3 lines or fewer.",
      ),
  }),
  async run(context, input): Promise<ToolResult> {
    if (containsOmittedMarker(input.content)) return omittedMarkerRefusal(input.path, "content");
    return withPathLock(lockKey(context.projectId, input.path), async () => {
      let prior: string | null = null;
      try {
        const existing = await context.runtime.readFile(context.projectId, input.path);
        if (existing.encoding === "utf8") prior = existing.content;
      } catch {
        // New file — no prior content to diff.
      }
      if (prior !== null && !input.replace_large_file) {
        const priorLines = prior.split("\n").length;
        const newLines = input.content.split("\n").length;
        if (priorLines >= SHRINK_MIN_PRIOR_LINES && newLines <= SHRINK_MAX_NEW_LINES) {
          return {
            output:
              `Refused: this would replace all ${priorLines} lines of ${input.path} with ${newLines}. ` +
              "Nothing was written. To change part of the file use edit_file; if you really mean to " +
              "empty it, send the call again with replace_large_file: true.",
            isError: true,
          };
        }
      }
      await context.runtime.writeFile(context.projectId, input.path, input.content);
      context.onFileChanged(input.path);
      const lines = input.content.split("\n").length;
      if (prior === null) return { output: `Created ${input.path} (${lines} lines).` };
      const priorLines = prior.split("\n").length;
      return {
        output:
          `Wrote ${input.path} (${priorLines} → ${lines} lines).\n\n` +
          truncate(briefDiff(prior, input.content), 4000),
      };
    });
  },
});

export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "Replace a string in a file. `old_text` must appear exactly once — include surrounding " +
    "context to make it unique — or pass replace_all. If it is not found exactly, the same lines " +
    "ignoring trailing whitespace or indentation are used when they occur once, and the result " +
    "says so. Preferred over write_file for changes to existing files.",
  schema: z.object({
    path: z.string(),
    old_text: z.string().describe("Exact text to replace, including whitespace and indentation"),
    new_text: z.string().describe("Replacement text"),
    replace_all: z
      .boolean()
      .optional()
      .describe("Replace every occurrence of old_text instead of requiring exactly one."),
  }),
  async run(context, input): Promise<ToolResult> {
    if (containsOmittedMarker(input.new_text)) return omittedMarkerRefusal(input.path, "new_text");
    if (containsOmittedMarker(input.old_text)) {
      return {
        output:
          `old_text for ${input.path} is the history placeholder "[omitted from history ...]", not text from the file. ` +
          `Nothing was changed. read_file ${input.path} and copy the exact lines you want to replace.`,
        isError: true,
      };
    }
    return withPathLock(lockKey(context.projectId, input.path), async () => {
      const file = await context.runtime.readFile(context.projectId, input.path);
      if (file.encoding !== "utf8") {
        return { output: `${input.path} is not a text file.`, isError: true };
      }

      const edit = applyEdit(file.content, input.old_text, input.new_text, {
        ...(input.replace_all ? { replaceAll: true } : {}),
      });
      if (!edit.ok) {
        return {
          output: `${edit.message.startsWith("Found") ? "" : `No match in ${input.path}. `}${edit.message}`,
          isError: true,
        };
      }
      await context.runtime.writeFile(context.projectId, input.path, edit.updated);
      context.onFileChanged(input.path);
      // Hand back the resulting region so the model can verify its own
      // edit without a full confirmatory read_file.
      const what =
        edit.replacements > 1
          ? `${edit.replacements} replacements; the first at line ${edit.startLine}`
          : `1 replacement at line ${edit.startLine}`;
      return {
        output:
          `Edited ${input.path} (${what}).${edit.note ? ` ${edit.note}` : ""}\n\n` +
          truncate(regionSnippet(edit.updated, edit.startLine, edit.endLine), 4000),
      };
    });
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
    return withPathLock(lockKey(context.projectId, input.path), async () => {
      await context.runtime.deleteFile(context.projectId, input.path);
      context.onFileChanged(input.path);
      return { output: `Deleted ${input.path}.` };
    });
  },
});

export const searchFilesTool = defineTool({
  name: "search_files",
  description:
    "Search file contents with a regular expression. Returns up to `max_results` matching lines " +
    "with their file and line number. Much cheaper than reading files to find something.",
  schema: z.object({
    pattern: z.string().describe("Regular expression, passed to grep -E"),
    path: z.string().optional().describe("Restrict the search to this subdirectory"),
    glob: z
      .string()
      .optional()
      .describe('Only search files matching this shell glob, e.g. "*.tsx" or "*.{ts,tsx}"'),
    context_lines: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .describe("Lines of surrounding context to include with each match (grep -C)"),
    max_results: z.number().int().min(1).max(200).optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    const max = input.max_results ?? 50;
    const ctx = input.context_lines ?? 0;
    // Quote for the shell, and exclude the directories the file tree hides too.
    const pattern = input.pattern.replaceAll("'", "'\\''");
    const target = input.path ? input.path.replaceAll("'", "'\\''") : ".";
    const excludes =
      "--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build";
    // grep's --include has no brace expansion, so `*.{ts,tsx}` — the
    // example in this tool's own description — used to match nothing.
    const include = input.glob
      ? expandBraces(input.glob)
          .map((glob) => ` --include='${glob.replaceAll("'", "'\\''")}'`)
          .join("")
      : "";
    const contextFlag = ctx > 0 ? ` -C ${ctx}` : "";
    // No -m: that is grep's PER-FILE limit, so `-m 50` could mean "50 matches
    // from the first file". `head` is the real global cap. With context on, a
    // match is up to `2*ctx + 1` lines plus a `--` separator, so widen the
    // line budget to still deliver ~`max` matches.
    const lineBudget = ctx > 0 ? max * (2 * ctx + 2) : max;
    // grep's own exit code tells "no match" (1) from "bad pattern" (2); piping
    // straight into `head` lost it, so a broken regex read as no matches.
    // `-e` keeps a pattern that starts with "-" from being read as an option.
    const command =
      `out=$(grep -rnE --binary-files=without-match ${excludes}${include}${contextFlag} ` +
      `-e '${pattern}' '${target}' 2>&1); code=$?; ` +
      `printf '%s\\n' "$out" | head -n ${lineBudget}; exit $code`;

    const result = await context.runtime.exec(context.projectId, { command, timeoutMs: 30_000 });
    const output = result.stdout.trim();
    if (result.exitCode === 1 && output === "") {
      return {
        output: `No matches for /${input.pattern}/${input.glob ? ` in ${input.glob}` : ""}.`,
      };
    }
    // Exit 2 with matches: some file could not be read, the rest searched.
    const lines = output.split("\n");
    const found = lines.filter((line) => !line.startsWith("grep:"));
    if (result.exitCode === 2 && found.some((line) => /^[^:\n]+[:-]\d+[:-]/.test(line))) {
      return { output: truncate(found.join("\n"), 15_000) };
    }
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        output: `search_files failed: ${output || result.stderr.trim() || `grep exited ${result.exitCode}`}. Check the pattern — it is an extended regular expression (grep -E).`,
        isError: true,
      };
    }
    return { output: truncate(result.stdout, 15_000) };
  },
});

/** `*.{ts,tsx}` → `*.ts`, `*.tsx`. One level of braces, which is all a glob here needs. */
export function expandBraces(glob: string): string[] {
  const open = glob.indexOf("{");
  const close = open === -1 ? -1 : glob.indexOf("}", open);
  if (open === -1 || close === -1) return [glob];
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  return glob
    .slice(open + 1, close)
    .split(",")
    .flatMap((alt) => expandBraces(`${head}${alt}${tail}`));
}

/**
 * A shell-style glob → anchored RegExp over a POSIX path. Supports `**`
 * (any run of segments), `*` (within a segment), `?`, and `{a,b}` alternation.
 * A pattern with no `/` matches the basename anywhere in the tree.
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = glob.includes("/") ? glob : `**/${glob}`;
  let re = "";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i] as string;
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        i++;
        if (normalized[i + 1] === "/") i++;
        re += "(?:.*/)?";
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      const end = normalized.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        const alts = normalized.slice(i + 1, end).split(",");
        re += `(?:${alts.map((a) => a.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("|")})`;
        i = end;
      }
    } else if (".+^$()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export const findFilesTool = defineTool({
  name: "find_files",
  description:
    "Find files by name or glob, newest first. Much cheaper than listing a whole project when you " +
    'know roughly what a file is called. Use "**" to cross directories, e.g. "**/*.test.tsx" or ' +
    '"**/Button*". A plain name with no slash matches anywhere. Use search_files to look inside ' +
    "files.",
  schema: z.object({
    pattern: z.string().describe('Glob, e.g. "**/*.test.tsx", "**/Button*", or "vite.config.*"'),
    path: z.string().optional().describe("Restrict the search to this subdirectory"),
    max_results: z.number().int().min(1).max(200).optional(),
  }),
  async run(context, input): Promise<ToolResult> {
    const max = input.max_results ?? 50;
    const entries = await context.runtime.listFiles(context.projectId, {
      path: input.path,
      depth: 32,
    });
    const ignored = await gitIgnored(context, input.path);
    const hidden = (candidate: string): boolean => {
      if (ignored.has(candidate)) return true;
      for (const entry of ignored) {
        if (candidate.startsWith(`${entry}/`)) return true;
      }
      return false;
    };

    let regexp: RegExp;
    try {
      regexp = globToRegExp(input.pattern);
    } catch {
      return { output: `Not a usable glob: ${input.pattern}`, isError: true };
    }

    const matches = entries
      .filter((entry) => entry.type === "file" && !hidden(entry.path) && regexp.test(entry.path))
      .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));

    if (matches.length === 0) return { output: `No files match ${input.pattern}.` };

    const shown = matches.slice(0, max);
    const rendered = shown.map((entry) => `${entry.path}  (${entry.size ?? 0}b)`).join("\n");
    const note =
      matches.length > shown.length
        ? `\n\n[showing the ${shown.length} newest of ${matches.length}. Narrow the pattern.]`
        : "";
    return { output: truncate(rendered, 12_000) + note };
  },
});
