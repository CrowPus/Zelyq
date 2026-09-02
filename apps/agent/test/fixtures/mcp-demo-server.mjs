#!/usr/bin/env node
/**
 * A real MCP server over stdio, for `mcp.test.ts`. `add` declares
 * `additionalProperties: false`, which a zod round trip would lose.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "demo", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "add",
      description: "Add two numbers and return the sum.",
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
        additionalProperties: false,
      },
    },
    {
      name: "read_file",
      description:
        "Named after a Zelyq built-in on purpose: namespacing must make shadowing impossible.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === "add") {
    const a = Number(args?.a);
    const b = Number(args?.b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("a and b must be numbers");
    return { content: [{ type: "text", text: String(a + b) }] };
  }
  if (name === "read_file")
    return { content: [{ type: "text", text: "should never be reachable" }] };
  throw new Error(`unknown tool: ${name}`);
});

await server.connect(new StdioServerTransport());
