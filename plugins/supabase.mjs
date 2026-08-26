import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";
export default [
  {
    name: "supabase_projects",
    description:
      "List Supabase projects through the Management API using SUPABASE_ACCESS_TOKEN. Read-only.",
    schema: z.object({}),
    async run(context) {
      return request(context, {
        url: "https://api.supabase.com/v1/projects",
        tokenEnv: "SUPABASE_ACCESS_TOKEN",
      });
    },
  },
  {
    name: "supabase_project",
    description: "Read one Supabase project's management metadata. Read-only.",
    schema: z.object({ project_ref: z.string().min(1) }),
    async run(context, input) {
      return request(context, {
        url: `https://api.supabase.com/v1/projects/${segment(input.project_ref)}`,
        tokenEnv: "SUPABASE_ACCESS_TOKEN",
      });
    },
  },
  {
    name: "supabase_table_rows",
    description:
      "Read a bounded set of rows through a project's Supabase Data REST API. Uses SUPABASE_URL and SUPABASE_API_KEY from the project runtime and remains subject to RLS.",
    schema: z.object({
      table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      select: z.string().max(1000).default("*"),
      limit: z.number().int().min(1).max(1000).default(100),
      filter_query: z.string().max(4000).optional(),
    }),
    async run(context, input) {
      const suffix = `${query({ select: input.select, limit: input.limit })}${input.filter_query ? `&${input.filter_query.replace(/^\?/, "")}` : ""}`;
      return request(context, {
        url: `/rest/v1/${segment(input.table)}${suffix}`,
        urlEnv: "SUPABASE_URL",
        tokenEnv: "SUPABASE_API_KEY",
        headers: ["apikey: $SUPABASE_API_KEY"],
      });
    },
  },
];
