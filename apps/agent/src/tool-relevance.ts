import type { ZelyqTool } from "@zelyq/tools";

/**
 * A default-mode session was handed all ~90 tools, including
 * `stripe_prices`, `cloudflare_pages_deployments` and `figma_file_comments`
 * while building a landing page. Every unused schema is selection noise and a
 * wrong turn waiting to happen.
 *
 * This gate applies only to a **default top-level** session — not a lean
 * builder (already filtered by `toolNames`), and not Architect / Engineer mode,
 * which are the deliberate power modes and keep the full weave. Architect names
 * task tools per build-plan step, specialists get them via `SpecialistConfig`,
 * and `/agent` grants them, so nothing loses a capability it actually reaches
 * for.
 *
 * Kept: the built-ins, plus the plugin families a UI build genuinely uses —
 * `ai-docs` (provider docs mid-build), `image-assets` (placeholder / reference
 * imagery), and `browser-qa` (does the page actually render, no console errors,
 * a11y). Dropped: the connectors (a `github_*` tool with no token in the
 * runtime is 100 tokens of schema, not a capability) and the remaining
 * inspection families (`static-analysis`, `test-intelligence`, `git-inspector`,
 * `database-inspector`, `container-inspector`, `deployment-readiness`,
 * `design-system-auditor`, `documentation-generator`, `api-tester`,
 * `project-intelligence`).
 */
const DEFAULT_MODE_PLUGIN_FILES = new Set(["ai-docs.mjs", "image-assets.mjs", "browser-qa.mjs"]);

/**
 * MCP tools carry `source: "mcp:<server>"` and are never gated. The rule above
 * is for the plugins that ship in the box; an MCP server was named in a config
 * file by hand, and gating it would leave it configured but unreachable in the
 * mode most sessions run in.
 */
export function isMcpTool(tool: ZelyqTool): boolean {
  return tool.source?.startsWith("mcp:") === true;
}

/** A tool loaded from a plugin file we do not surface in default mode. */
export function isTaskOnlyPluginTool(tool: ZelyqTool): boolean {
  if (tool.source === undefined || isMcpTool(tool)) return false;
  return !DEFAULT_MODE_PLUGIN_FILES.has(tool.source);
}

/**
 * The tool pool for a default top-level session: the built-ins and the
 * build-relevant plugin families, nothing else.
 */
export function gateToolsForDefaultMode(tools: ZelyqTool[]): ZelyqTool[] {
  return tools.filter((tool) => !isTaskOnlyPluginTool(tool));
}
