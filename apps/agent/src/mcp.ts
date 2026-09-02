import fs from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolResult, ZelyqTool } from "@zelyq/tools";
import { z } from "zod";

/**
 * Calls tools exposed by other applications over MCP. Zelyq is the client:
 * each server's tools are wrapped as ordinary `ZelyqTool`s, so nothing
 * downstream knows the difference.
 *
 * Servers are declared in one operator-owned file (`ZELYQ_MCP_CONFIG`), read
 * at boot and never re-scanned, never reachable from Settings and never read
 * from a project's own directory — the rules `loadPlugins` follows, so a
 * cloned repository cannot pick the tools of the agent reading it.
 *
 * A server has whatever access it was configured with and does NOT inherit
 * Zelyq's project boundary: this config is instance-wide, a session is not. A
 * filesystem server pointed at `workspace/` lets an agent on one project read
 * and write every other one. Zelyq cannot enforce that from here — the server
 * is another program — so `.env.example` says so instead.
 *
 * What a server returns is third-party text: results are marked `untrusted`
 * and the session wraps them in `<untrusted_content>`.
 */

/** One server entry, in the `mcpServers` shape MCP clients conventionally share. */
const serverSchema = z.union([
  z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    disabled: z.boolean().default(false),
  }),
  z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    disabled: z.boolean().default(false),
  }),
]);

export const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), serverSchema).default({}),
});

export type McpServerConfig = z.infer<typeof serverSchema>;

export interface McpLoadResult {
  /** Names of tools actually appended, already namespaced. */
  loaded: string[];
  /** Servers that could not be used, and why — never fatal. */
  skipped: Array<{ server: string; reason: string }>;
  /** Open clients, so a caller can shut them down. */
  clients: Client[];
}

interface McpLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * `github` + `list_issues` -> `github__list_issues`. Two servers naming a tool
 * `search` is ordinary, and the name is all the model has to tell them apart.
 * Double underscore because both halves are usually snake_case already.
 */
export function mcpToolName(server: string, tool: string): string {
  return `${server}__${tool}`;
}

/** Reads and validates the config file. Returns null when none is configured. */
export async function readMcpConfig(
  file: string | undefined,
  log: McpLogger = console,
): Promise<z.infer<typeof mcpConfigSchema> | null> {
  if (!file) return null;
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    // Never fatal: a bad config costs tools, not the agent.
    log.warn(`ZELYQ_MCP_CONFIG ("${file}") could not be read: ${(error as Error).message}`);
    return null;
  }
  try {
    return mcpConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    log.warn(`ZELYQ_MCP_CONFIG ("${file}") is not valid: ${(error as Error).message}`);
    return null;
  }
}

/**
 * The server's JSON Schema goes to the model verbatim; the zod `schema` stays
 * permissive because only the server can validate its own arguments, and a
 * second validator in front would reject calls it would have accepted.
 */
export function toZelyqTool(
  client: Client,
  serverName: string,
  tool: { name: string; description?: string; inputSchema?: Record<string, unknown> },
): ZelyqTool {
  const qualified = mcpToolName(serverName, tool.name);
  return {
    name: qualified,
    description:
      tool.description?.trim() || `The "${tool.name}" tool from the ${serverName} MCP server.`,
    schema: z.record(z.string(), z.unknown()),
    ...(tool.inputSchema ? { jsonSchema: tool.inputSchema } : {}),
    source: `mcp:${serverName}`,
    async run(_context, input): Promise<ToolResult> {
      try {
        const result = (await client.callTool({
          name: tool.name,
          arguments: input as Record<string, unknown>,
        })) as {
          content?: Array<{ type: string; text?: string }>;
          isError?: boolean;
          structuredContent?: unknown;
        };

        const text = (result.content ?? [])
          .map((part) =>
            part.type === "text" ? (part.text ?? "") : `[${part.type} content omitted]`,
          )
          .filter(Boolean)
          .join("\n")
          .trim();

        const output =
          text ||
          (result.structuredContent !== undefined
            ? JSON.stringify(result.structuredContent, null, 2)
            : "The tool returned no content.");

        return {
          output,
          isError: result.isError === true,
          untrusted: { source: `${serverName} (MCP)` },
        };
      } catch (error) {
        // One failed call, not a failed turn.
        return {
          output: `The ${serverName} MCP server could not run "${tool.name}": ${(error as Error).message}`,
          isError: true,
        };
      }
    },
  };
}

/** Connects each server and appends its tools to `tools`, in place. */
export async function loadMcpServers(
  file: string | undefined,
  tools: ZelyqTool[],
  log: McpLogger = console,
  connectTimeoutMs = 15_000,
): Promise<McpLoadResult> {
  const result: McpLoadResult = { loaded: [], skipped: [], clients: [] };
  const config = await readMcpConfig(file, log);
  if (!config) return result;

  const known = new Set(tools.map((tool) => tool.name));

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (server.disabled) {
      result.skipped.push({ server: serverName, reason: "disabled in the config" });
      continue;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(serverName)) {
      result.skipped.push({
        server: serverName,
        reason: "server name must be alphanumeric with - or _, since it prefixes every tool name",
      });
      log.warn(`MCP server "${serverName}" has an unusable name — skipped`);
      continue;
    }

    const client = new Client({ name: "zelyq", version: "0.1.0" }, { capabilities: {} });

    try {
      const transport =
        "command" in server
          ? new StdioClientTransport({
              command: server.command,
              args: server.args,
              // Not `process.env`: that holds every provider key this
              // instance has, and a tool server has no business seeing them.
              env: server.env,
            })
          : new StreamableHTTPClientTransport(new URL(server.url), {
              requestInit: { headers: server.headers },
            });

      // A server that never answers must not hang boot.
      await withTimeout(
        client.connect(transport),
        connectTimeoutMs,
        `did not answer within ${connectTimeoutMs}ms`,
      );

      const listed = await withTimeout(
        client.listTools(),
        connectTimeoutMs,
        "did not list its tools in time",
      );

      let added = 0;
      for (const tool of listed.tools ?? []) {
        const wrapped = toZelyqTool(client, serverName, tool as never);
        if (known.has(wrapped.name)) {
          log.warn(
            `MCP server "${serverName}": tool "${wrapped.name}" collides with an existing tool — skipped, an MCP server may never shadow a built-in tool`,
          );
          continue;
        }
        tools.push(wrapped);
        known.add(wrapped.name);
        result.loaded.push(wrapped.name);
        added += 1;
      }
      result.clients.push(client);
      log.info(`MCP server "${serverName}" connected — ${added} tool(s)`);
    } catch (error) {
      const reason = (error as Error).message;
      result.skipped.push({ server: serverName, reason });
      log.warn(`MCP server "${serverName}" could not be used: ${reason} — skipped`);
      await client.close().catch(() => undefined);
    }
  }

  return result;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
