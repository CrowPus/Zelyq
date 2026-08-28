import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ZelyqTool } from "@zelyq/tools";
import { z } from "zod";

export interface PluginLoadResult {
  /** Names of tools that were actually appended. */
  loaded: string[];
  skipped: Array<{ file: string; reason: string }>;
}

interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Loads plugin tools from `ZELYQ_PLUGIN_DIR`.
 *
 * A plugin tool gets nothing a built-in tool doesn't already have
 * (`ToolContext` is the entire surface for either one), so the trust
 * question is supply-chain, not privilege: a plugin is exactly as trusted as
 * whoever can already configure and restart this instance. That is why
 * loading is boot-time only (never re-scanned while running, never reachable
 * from Settings), filesystem-only (never a network address), and reads only
 * the directory an operator names — never a project's own directory, which
 * would let a cloned repository choose its own tools for the agent that
 * reads it.
 *
 * `tools` is the array to append into (`ALL_TOOLS` at boot, a scratch array
 * in a test) — mutated in place, the same shape every existing call site
 * that defaults to `ALL_TOOLS` already expects.
 */
export async function loadPlugins(
  dir: string | undefined,
  tools: ZelyqTool[],
  log: PluginLogger = console,
): Promise<PluginLoadResult> {
  const result: PluginLoadResult = { loaded: [], skipped: [] };
  if (!dir) return result;

  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter((name) => name.endsWith(".mjs")).sort();
  } catch (error) {
    // A misconfigured or missing directory is a boot-time warning, never a
    // reason the agent fails to start.
    log.warn(`ZELYQ_PLUGIN_DIR ("${dir}") could not be read: ${(error as Error).message}`);
    return result;
  }

  const knownNames = new Set(tools.map((tool) => tool.name));

  for (const entry of entries) {
    const file = path.join(dir, entry);
    let exported: unknown;
    try {
      exported = (await import(pathToFileURL(file).href)).default;
    } catch (error) {
      const reason = `failed to import: ${(error as Error).message}`;
      result.skipped.push({ file: entry, reason });
      log.warn(`plugin "${entry}" ${reason} — skipped`);
      continue;
    }

    if (!Array.isArray(exported)) {
      const reason = "default export is not an array of tools";
      result.skipped.push({ file: entry, reason });
      log.warn(`plugin "${entry}": ${reason} — skipped`);
      continue;
    }

    for (const candidate of exported) {
      const invalidReason = shapeError(candidate);
      if (invalidReason) {
        result.skipped.push({ file: entry, reason: invalidReason });
        log.warn(`plugin "${entry}": ${invalidReason} — skipped`);
        continue;
      }

      const tool = candidate as ZelyqTool;

      // shapeError only confirms `schema.safeParse` exists — that alone
      // isn't enough. Every tool's schema is converted to JSON Schema once
      // per new session (toolDefinitions(), for every tool at once), which
      // needs a genuine zod schema, not just an object shaped like one. A
      // schema that fails this is caught here, at boot, instead of taking
      // down every session created afterward: a plugin with a hand-rolled
      // `{ safeParse }` stand-in passes the shape check and then breaks
      // every new conversation until the agent is restarted.
      try {
        z.toJSONSchema(tool.schema, { io: "input" });
      } catch (error) {
        const reason = `tool "${tool.name}"'s schema is not a real zod schema (${(error as Error).message}) — a plain object with a 'safeParse' method looks valid but is not enough`;
        result.skipped.push({ file: entry, reason });
        log.warn(`plugin "${entry}": ${reason} — skipped`);
        continue;
      }

      if (knownNames.has(tool.name)) {
        const reason = `tool name "${tool.name}" collides with an existing tool`;
        result.skipped.push({ file: entry, reason });
        // Deliberately loud: a plugin is additive, never allowed to shadow
        // or replace a built-in tool.
        log.warn(
          `plugin "${entry}": ${reason} — skipped, a plugin may never shadow a built-in tool`,
        );
        continue;
      }

      tools.push(tool);
      knownNames.add(tool.name);
      result.loaded.push(tool.name);
      log.info(`plugin tool "${tool.name}" loaded from ${entry}`);
    }
  }

  return result;
}

/** Null when `value` looks enough like a `ZelyqTool` to trust; otherwise why not. */
function shapeError(value: unknown): string | null {
  if (!value || typeof value !== "object") return "a tool entry is not an object";
  const tool = value as Record<string, unknown>;
  if (typeof tool.name !== "string" || !tool.name) return "a tool entry is missing a string 'name'";
  if (typeof tool.description !== "string" || !tool.description) {
    return `tool "${tool.name}" is missing a string 'description'`;
  }
  if (!tool.schema || typeof (tool.schema as { safeParse?: unknown }).safeParse !== "function") {
    return `tool "${tool.name}" is missing a zod 'schema'`;
  }
  if (typeof tool.run !== "function") return `tool "${tool.name}" is missing a 'run' function`;
  return null;
}
