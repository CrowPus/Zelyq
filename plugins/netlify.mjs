import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const netlify = (context, path) =>
  request(context, {
    url: `https://api.netlify.com/api/v1${path}`,
    tokenEnv: "NETLIFY_ACCESS_TOKEN",
  });
export default [
  {
    name: "netlify_sites",
    description: "List Netlify sites accessible to NETLIFY_ACCESS_TOKEN. Read-only.",
    schema: z.object({
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(1).max(100).default(25),
    }),
    async run(context, input) {
      return netlify(context, `/sites${query(input)}`);
    },
  },
  {
    name: "netlify_site",
    description: "Read one Netlify site/project by its Project ID or site name. Read-only.",
    schema: z.object({ site_id: z.string().min(1) }),
    async run(context, input) {
      return netlify(context, `/sites/${segment(input.site_id)}`);
    },
  },
  {
    name: "netlify_deployments",
    description:
      "List recent deployments for a Netlify site. Read-only and never initiates a deploy.",
    schema: z.object({
      site_id: z.string().min(1),
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(1).max(100).default(25),
    }),
    async run(context, input) {
      return netlify(
        context,
        `/sites/${segment(input.site_id)}/deploys${query({ page: input.page, per_page: input.per_page })}`,
      );
    },
  },
];
