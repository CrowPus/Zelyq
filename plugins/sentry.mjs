import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const host = z.enum(["sentry.io", "us.sentry.io", "de.sentry.io"]).default("sentry.io");
const sentry = (context, hostname, path) =>
  request(context, { url: `https://${hostname}/api/0${path}`, tokenEnv: "SENTRY_AUTH_TOKEN" });
export default [
  {
    name: "sentry_projects",
    description: "List Sentry projects in an organization using SENTRY_AUTH_TOKEN. Read-only.",
    schema: z.object({
      organization: z.string().min(1),
      host,
      per_page: z.number().int().min(1).max(100).default(50),
    }),
    async run(context, input) {
      return sentry(
        context,
        input.host,
        `/organizations/${segment(input.organization)}/projects/${query({ per_page: input.per_page })}`,
      );
    },
  },
  {
    name: "sentry_issues",
    description:
      "List unresolved or filtered Sentry issues for an organization or project. Read-only.",
    schema: z.object({
      organization: z.string().min(1),
      project: z.string().optional(),
      host,
      query: z.string().max(1000).default("is:unresolved"),
      per_page: z.number().int().min(1).max(100).default(50),
    }),
    async run(context, input) {
      const path = input.project
        ? `/projects/${segment(input.organization)}/${segment(input.project)}/issues/`
        : `/organizations/${segment(input.organization)}/issues/`;
      return sentry(
        context,
        input.host,
        `${path}${query({ query: input.query, per_page: input.per_page })}`,
      );
    },
  },
  {
    name: "sentry_releases",
    description: "List recent Sentry releases for an organization. Read-only.",
    schema: z.object({
      organization: z.string().min(1),
      host,
      per_page: z.number().int().min(1).max(100).default(25),
    }),
    async run(context, input) {
      return sentry(
        context,
        input.host,
        `/organizations/${segment(input.organization)}/releases/${query({ per_page: input.per_page })}`,
      );
    },
  },
];
