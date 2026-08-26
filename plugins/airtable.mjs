import { z } from "zod";
import { query, request, segment } from "./lib/api.mjs";

const airtable = (context, path) =>
  request(context, {
    url: `https://api.airtable.com/v0${path}`,
    tokenEnv: "AIRTABLE_ACCESS_TOKEN",
  });
export default [
  {
    name: "airtable_bases",
    description: "List Airtable bases accessible to AIRTABLE_ACCESS_TOKEN. Read-only.",
    schema: z.object({ offset: z.string().optional() }),
    async run(context, input) {
      return airtable(context, `/meta/bases${query(input)}`);
    },
  },
  {
    name: "airtable_base_schema",
    description: "Read table and field schema for an Airtable base. Read-only.",
    schema: z.object({ base_id: z.string().min(1) }),
    async run(context, input) {
      return airtable(context, `/meta/bases/${segment(input.base_id)}/tables`);
    },
  },
  {
    name: "airtable_records",
    description:
      "List a bounded page of Airtable records. Read-only and does not create or update records.",
    schema: z.object({
      base_id: z.string().min(1),
      table: z.string().min(1),
      view: z.string().optional(),
      max_records: z.number().int().min(1).max(100).default(100),
      offset: z.string().optional(),
    }),
    async run(context, input) {
      return airtable(
        context,
        `/${segment(input.base_id)}/${segment(input.table)}${query({ view: input.view, maxRecords: input.max_records, offset: input.offset })}`,
      );
    },
  },
];
