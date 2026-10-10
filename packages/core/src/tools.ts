import type { PipelineTool } from "./pipelines.js";
import index from "./tools.json" with { type: "json" };

/**
 * The approved tools list: what a `setup` step may install. It is built from
 * the official sources by `scripts/tools-index.mjs`, and changed only by a
 * reviewed pull request — merging is the approval.
 */

export const TOOL_PLATFORMS = [
  "linux-x64",
  "linux-arm64",
  "macos-x64",
  "macos-arm64",
  "windows-x64",
  "windows-arm64",
] as const;
export type ToolPlatform = (typeof TOOL_PLATFORMS)[number];

export interface ToolFile {
  url: string;
  sha256: string;
  /** The tool's own folder inside the archive. */
  home: string;
  /** Folders under home that go on PATH ("" is home itself). */
  bins: string[];
}

export interface ToolRelease {
  version: string;
  lts?: boolean;
  files: Partial<Record<ToolPlatform, ToolFile>>;
}

/** Variables some tools expect to point at their folder. */
export const TOOL_HOME_VARIABLES: Partial<Record<PipelineTool, string>> = {
  java: "JAVA_HOME",
  go: "GOROOT",
};

const TOOLS = (index as { tools: Record<PipelineTool, ToolRelease[]> }).tools;

/** Every approved version of a tool, newest first. */
export function toolReleases(tool: PipelineTool): ToolRelease[] {
  return TOOLS[tool] ?? [];
}

/**
 * The approved release a version asks for: "22" → newest 22.x, "22.11" →
 * newest 22.11.x, "22.11.0" → exactly that, "lts" or nothing → newest
 * long-term-support Node, or the newest of any other tool.
 */
export function resolveToolVersion(tool: PipelineTool, wanted: string | null): ToolRelease | null {
  const releases = toolReleases(tool);
  if (wanted === null || wanted === "lts") {
    return releases.find((release) => release.lts) ?? releases[0] ?? null;
  }
  return (
    releases.find(
      (release) => release.version === wanted || release.version.startsWith(`${wanted}.`),
    ) ?? null
  );
}
