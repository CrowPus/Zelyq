import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const repo = z.object({ owner: z.string().min(1), repo: z.string().min(1) });
const github = (context, path) =>
  request(context, {
    url: `https://api.github.com${path}`,
    tokenEnv: "GITHUB_TOKEN",
    headers: ["Accept: application/vnd.github+json", "X-GitHub-Api-Version: 2026-03-10"],
  });
export default [
  {
    name: "github_repository",
    description: "Read GitHub repository metadata using GITHUB_TOKEN from the project runtime.",
    schema: repo,
    async run(context, input) {
      return github(context, `/repos/${segment(input.owner)}/${segment(input.repo)}`);
    },
  },
  {
    name: "github_issues",
    description: "List GitHub issues or pull requests for a repository. Read-only.",
    schema: repo.extend({
      state: z.enum(["open", "closed", "all"]).default("open"),
      per_page: z.number().int().min(1).max(100).default(30),
    }),
    async run(context, input) {
      return github(
        context,
        `/repos/${segment(input.owner)}/${segment(input.repo)}/issues${query({ state: input.state, per_page: input.per_page })}`,
      );
    },
  },
  {
    name: "github_actions_runs",
    description: "List recent GitHub Actions workflow runs for a repository. Read-only.",
    schema: repo.extend({
      branch: z.string().optional(),
      status: z
        .enum(["completed", "in_progress", "queued", "requested", "waiting", "pending"])
        .optional(),
      per_page: z.number().int().min(1).max(100).default(30),
    }),
    async run(context, input) {
      return github(
        context,
        `/repos/${segment(input.owner)}/${segment(input.repo)}/actions/runs${query({ branch: input.branch, status: input.status, per_page: input.per_page })}`,
      );
    },
  },
];
