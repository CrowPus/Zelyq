import { z } from "zod";
import { files, jsonOutput, readText } from "./lib/shared.mjs";

async function styles(context) {
  const entries = await files(context, 14);
  const selected = entries
    .filter(
      (e) => e.type !== "directory" && /\.(css|scss|sass|less|tsx|jsx|vue|svelte)$/.test(e.path),
    )
    .slice(0, 400);
  const result = [];
  for (const entry of selected) {
    const content = await readText(context, entry.path);
    if (content !== null) result.push([entry.path, content]);
  }
  return result;
}
export default [
  {
    name: "scan_design_tokens",
    description:
      "Inventory CSS custom properties, literal colors, spacing values, font families, and breakpoints used by the project.",
    schema: z.object({}),
    async run(context) {
      const sources = await styles(context);
      const text = sources.map(([, c]) => c).join("\n");
      const unique = (re) => [...new Set(text.match(re) ?? [])].sort();
      return jsonOutput({
        cssVariables: unique(/--[\w-]+\s*:/g).map((v) => v.slice(0, -1)),
        colors: unique(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g),
        spacing: unique(/\b\d+(?:\.\d+)?(?:px|rem|em)\b/g),
        fontFamilies: unique(/font-family\s*:[^;}]+/gi),
        breakpoints: unique(/@media[^{]+/g),
        scannedFiles: sources.length,
      });
    },
  },
  {
    name: "find_ui_inconsistencies",
    description:
      "Find repeated hard-coded visual values that may indicate inconsistent design-token usage.",
    schema: z.object({ minimum_occurrences: z.number().int().min(2).max(20).default(3) }),
    async run(context, input) {
      const sources = await styles(context);
      const occurrences = new Map();
      for (const [path, content] of sources)
        for (const match of content.matchAll(/#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem)\b/g)) {
          const list = occurrences.get(match[0]) ?? [];
          list.push(path);
          occurrences.set(match[0], list);
        }
      return jsonOutput(
        [...occurrences]
          .filter(([, paths]) => paths.length >= input.minimum_occurrences)
          .map(([value, paths]) => ({
            value,
            occurrences: paths.length,
            files: [...new Set(paths)].slice(0, 30),
          }))
          .sort((a, b) => b.occurrences - a.occurrences)
          .slice(0, 100),
      );
    },
  },
  {
    name: "component_inventory",
    description: "Inventory likely UI components and their exported component names.",
    schema: z.object({ path: z.string().default("src") }),
    async run(context, input) {
      const entries = await context.runtime.listFiles(context.projectId, {
        path: input.path,
        depth: 16,
      });
      const components = [];
      for (const entry of entries
        .filter((e) => e.type !== "directory" && /\.(tsx|jsx|vue|svelte)$/.test(e.path))
        .slice(0, 500)) {
        const content = await readText(context, entry.path);
        const names = [
          ...(content ?? "").matchAll(
            /(?:export\s+(?:default\s+)?(?:function|class|const)|defineComponent\s*\()\s*([A-Z][\w]*)/g,
          ),
        ]
          .map((m) => m[1])
          .filter(Boolean);
        components.push({ path: entry.path, names });
      }
      return jsonOutput(components);
    },
  },
  {
    name: "contrast_source_report",
    description:
      "Report foreground/background color declarations that need visual contrast verification. This is source triage, not a computed browser contrast audit.",
    schema: z.object({}),
    async run(context) {
      const sources = await styles(context);
      return jsonOutput(
        sources
          .map(([path, content]) => ({
            path,
            declarations: [
              ...content.matchAll(/(?:^|[;{])\s*(color|background(?:-color)?)\s*:\s*([^;}]+)/gim),
            ]
              .map((m) => ({ property: m[1], value: m[2].trim() }))
              .slice(0, 100),
          }))
          .filter((x) => x.declarations.length),
      );
    },
  },
];
