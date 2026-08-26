import { z } from "zod";
import { exec, jsonOutput, quote, readJson } from "./lib/shared.mjs";

const method = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
function curlCommand(input) {
  const parts = [
    "curl",
    "--silent",
    "--show-error",
    "--include",
    "--max-time",
    String(Math.ceil(input.timeout_ms / 1000)),
    "--request",
    input.method,
  ];
  for (const [name, value] of Object.entries(input.headers ?? {}))
    parts.push("--header", quote(`${name}: ${value}`));
  if (input.body !== undefined) parts.push("--data-raw", quote(input.body));
  parts.push(quote(input.url));
  return parts.join(" ");
}

export default [
  {
    name: "http_request",
    description:
      "Make an HTTP request from the project runtime and return response headers/body. Never logs or persists credentials; pass only headers appropriate for the target.",
    schema: z.object({
      url: z.string().url(),
      method: method.default("GET"),
      headers: z.record(z.string(), z.string()).default({}),
      body: z.string().optional(),
      timeout_ms: z.number().int().min(1000).max(120000).default(30000),
    }),
    async run(context, input) {
      return exec(context, curlCommand(input), { timeoutMs: input.timeout_ms + 2000 });
    },
  },
  {
    name: "inspect_openapi",
    description: "Read and summarize a JSON OpenAPI document stored in the project.",
    schema: z.object({ path: z.string().default("openapi.json") }),
    async run(context, input) {
      const doc = await readJson(context, input.path);
      if (!doc)
        return { output: `Could not read JSON OpenAPI document at ${input.path}.`, isError: true };
      const operations = [];
      for (const [path, item] of Object.entries(doc.paths ?? {}))
        for (const [verb, operation] of Object.entries(item ?? {}))
          if (["get", "post", "put", "patch", "delete", "head", "options"].includes(verb))
            operations.push({
              method: verb.toUpperCase(),
              path,
              operationId: operation?.operationId,
              summary: operation?.summary,
              parameters: operation?.parameters?.length ?? 0,
            });
      return jsonOutput({
        title: doc.info?.title,
        version: doc.info?.version,
        servers: doc.servers ?? [],
        operations,
      });
    },
  },
  {
    name: "test_api_route",
    description: "Call an API route and check its HTTP status and optional response substring.",
    schema: z.object({
      url: z.string().url(),
      method: method.default("GET"),
      expected_status: z.number().int().min(100).max(599).default(200),
      expected_text: z.string().optional(),
      headers: z.record(z.string(), z.string()).default({}),
      body: z.string().optional(),
      timeout_ms: z.number().int().min(1000).max(120000).default(30000),
    }),
    async run(context, input) {
      const marker = "__ZELYQ_STATUS__";
      const command = `${curlCommand(input).replace("--include ", "")} --write-out ${quote(`\\n${marker}%{http_code}`)}`;
      const result = await context.runtime.exec(context.projectId, {
        command,
        timeoutMs: input.timeout_ms + 2000,
        maxOutputBytes: 30000,
      });
      const index = result.stdout.lastIndexOf(marker);
      const body = index >= 0 ? result.stdout.slice(0, index).trimEnd() : result.stdout;
      const status = index >= 0 ? Number(result.stdout.slice(index + marker.length).trim()) : 0;
      const passed =
        result.exitCode === 0 &&
        status === input.expected_status &&
        (input.expected_text === undefined || body.includes(input.expected_text));
      return {
        output: JSON.stringify(
          {
            passed,
            status,
            expectedStatus: input.expected_status,
            containsExpectedText:
              input.expected_text === undefined ? null : body.includes(input.expected_text),
            body,
          },
          null,
          2,
        ),
        ...(passed ? {} : { isError: true }),
      };
    },
  },
  {
    name: "compare_api_response",
    description:
      "Call two GET endpoints and compare status and response bodies, optionally parsing JSON while ignoring named top-level fields.",
    schema: z.object({
      first_url: z.string().url(),
      second_url: z.string().url(),
      ignore_fields: z.array(z.string()).default([]),
      timeout_ms: z.number().int().min(1000).max(120000).default(30000),
    }),
    async run(context, input) {
      async function fetch(url) {
        const result = await context.runtime.exec(context.projectId, {
          command: `curl --silent --show-error --max-time ${Math.ceil(input.timeout_ms / 1000)} ${quote(url)}`,
          timeoutMs: input.timeout_ms + 2000,
          maxOutputBytes: 30000,
        });
        let body = result.stdout;
        try {
          body = JSON.parse(body);
          for (const key of input.ignore_fields) delete body[key];
        } catch {}
        return { exitCode: result.exitCode, body };
      }
      const first = await fetch(input.first_url);
      const second = await fetch(input.second_url);
      return jsonOutput({ equal: JSON.stringify(first) === JSON.stringify(second), first, second });
    },
  },
];
