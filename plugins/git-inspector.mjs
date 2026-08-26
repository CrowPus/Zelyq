import { z } from "zod";
import { exec, quote } from "./lib/shared.mjs";

export default [
  {
    name: "git_status",
    description:
      "Show the repository's branch and working-tree status. Read-only; never stages or changes files.",
    schema: z.object({}),
    async run(context) {
      return exec(context, "git status --short --branch", { timeoutMs: 15000 });
    },
  },
  {
    name: "git_diff_summary",
    description: "Show a bounded read-only git diff or diff statistics for working-tree changes.",
    schema: z.object({
      staged: z.boolean().default(false),
      stats_only: z.boolean().default(false),
      path: z.string().optional(),
    }),
    async run(context, input) {
      const command = [
        "git diff",
        input.staged ? "--cached" : "",
        input.stats_only ? "--stat" : "--no-ext-diff",
        input.path ? `-- ${quote(input.path)}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return exec(context, command, { timeoutMs: 30000 });
    },
  },
  {
    name: "git_history",
    description:
      "Show bounded commit history with hashes, dates, authors, and subjects. Read-only.",
    schema: z.object({
      limit: z.number().int().min(1).max(100).default(20),
      path: z.string().optional(),
    }),
    async run(context, input) {
      return exec(
        context,
        `git log -n ${input.limit} --date=iso-strict --pretty=format:${quote("%h%x09%ad%x09%an%x09%s")}${input.path ? ` -- ${quote(input.path)}` : ""}`,
        { timeoutMs: 30000 },
      );
    },
  },
  {
    name: "git_blame",
    description:
      "Show read-only line attribution for a project file, optionally restricted to a line range.",
    schema: z
      .object({
        path: z.string(),
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      })
      .refine(
        (value) => !value.start_line || !value.end_line || value.end_line >= value.start_line,
        "end_line must be at least start_line",
      ),
    async run(context, input) {
      const range = input.start_line
        ? `-L ${input.start_line},${input.end_line ?? input.start_line}`
        : "";
      return exec(context, `git blame --date=short ${range} -- ${quote(input.path)}`, {
        timeoutMs: 30000,
      });
    },
  },
];
