import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const cloudflare = (context, path) =>
  request(context, {
    url: `https://api.cloudflare.com/client/v4${path}`,
    tokenEnv: "CLOUDFLARE_API_TOKEN",
  });
export default [
  {
    name: "cloudflare_zones",
    description: "List Cloudflare zones using a least-privilege CLOUDFLARE_API_TOKEN. Read-only.",
    schema: z.object({
      name: z.string().optional(),
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(5).max(50).default(20),
    }),
    async run(context, input) {
      return cloudflare(context, `/zones${query(input)}`);
    },
  },
  {
    name: "cloudflare_pages_projects",
    description: "List Cloudflare Pages projects for an account. Read-only.",
    schema: z.object({ account_id: z.string().min(1) }),
    async run(context, input) {
      return cloudflare(context, `/accounts/${segment(input.account_id)}/pages/projects`);
    },
  },
  {
    name: "cloudflare_pages_deployments",
    description: "List deployments for a Cloudflare Pages project. Read-only.",
    schema: z.object({
      account_id: z.string().min(1),
      project_name: z.string().min(1),
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(1).max(100).default(25),
    }),
    async run(context, input) {
      return cloudflare(
        context,
        `/accounts/${segment(input.account_id)}/pages/projects/${segment(input.project_name)}/deployments${query({ page: input.page, per_page: input.per_page })}`,
      );
    },
  },
];
