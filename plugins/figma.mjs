import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const figma = (context, path) =>
  request(context, { url: `https://api.figma.com/v1${path}`, tokenEnv: "FIGMA_ACCESS_TOKEN" });
export default [
  {
    name: "figma_file",
    description:
      "Read a Figma file document and component metadata using FIGMA_ACCESS_TOKEN. Read-only.",
    schema: z.object({
      file_key: z.string().min(1),
      depth: z.number().int().min(1).max(4).default(2),
    }),
    async run(context, input) {
      return figma(context, `/files/${segment(input.file_key)}${query({ depth: input.depth })}`);
    },
  },
  {
    name: "figma_file_comments",
    description:
      "List comments on a Figma file. Requires file_comments:read and never posts comments.",
    schema: z.object({ file_key: z.string().min(1), as_markdown: z.boolean().default(true) }),
    async run(context, input) {
      return figma(
        context,
        `/files/${segment(input.file_key)}/comments${query({ as_md: input.as_markdown })}`,
      );
    },
  },
  {
    name: "figma_file_nodes",
    description: "Read selected Figma nodes by ID for focused design context.",
    schema: z.object({
      file_key: z.string().min(1),
      node_ids: z.array(z.string().min(1)).min(1).max(50),
      depth: z.number().int().min(1).max(4).default(2),
    }),
    async run(context, input) {
      return figma(
        context,
        `/files/${segment(input.file_key)}/nodes${query({ ids: input.node_ids.join(","), depth: input.depth })}`,
      );
    },
  },
];
