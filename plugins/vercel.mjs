import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const vercel = (context, path) =>
  request(context, { url: `https://api.vercel.com${path}`, tokenEnv: "VERCEL_ACCESS_TOKEN" });
export default [
  {
    name: "vercel_projects",
    description: "List Vercel projects using VERCEL_ACCESS_TOKEN. Read-only.",
    schema: z.object({
      team_id: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    async run(context, input) {
      return vercel(context, `/v9/projects${query({ teamId: input.team_id, limit: input.limit })}`);
    },
  },
  {
    name: "vercel_project",
    description:
      "Read one Vercel project's configuration metadata. Read-only and does not expose environment secret values.",
    schema: z.object({ project_id_or_name: z.string().min(1), team_id: z.string().optional() }),
    async run(context, input) {
      return vercel(
        context,
        `/v9/projects/${segment(input.project_id_or_name)}${query({ teamId: input.team_id })}`,
      );
    },
  },
  {
    name: "vercel_deployments",
    description:
      "List recent Vercel deployments for a project. Read-only and never triggers a deployment.",
    schema: z.object({
      project_id: z.string().optional(),
      team_id: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(25),
      state: z
        .enum(["BUILDING", "ERROR", "INITIALIZING", "QUEUED", "READY", "CANCELED"])
        .optional(),
    }),
    async run(context, input) {
      return vercel(
        context,
        `/v6/deployments${query({ projectId: input.project_id, teamId: input.team_id, limit: input.limit, state: input.state })}`,
      );
    },
  },
];
