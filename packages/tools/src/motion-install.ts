import fs from "node:fs/promises";
import path from "node:path";
import { resolveFromRepoRoot } from "@zelyq/core/node";
import { z } from "zod";
import { defineTool, type ToolResult } from "./types.js";

/**
 * Installing motion components into the project.
 *
 * The components are vendored under `motion-primitives/` rather than fetched:
 * the reasoning and the measurements are in `docs/motion-command.md`, and the
 * short version is that none of them typecheck under React 19 with `strict`,
 * which every Zelyq project runs on every turn. Patched copies we own are the
 * only version that works here.
 *
 * This tool is the bridge — the vendored files live on the host, the project
 * lives in a runtime the agent writes through, and nothing else can carry a
 * file across that line.
 */

/** Where the components land in the project. Fixed, so imports are predictable. */
const COMPONENT_DIR = "src/components/motion";
const HOOK_DIR = "src/hooks";
const UTILS_PATH = "src/lib/utils.ts";

/**
 * Make `@/…` resolve, in both halves.
 *
 * Every component this tool writes imports `@/lib/utils`, and the page that
 * uses them imports `@/components/motion/…`. A project generated before the
 * template carried the alias has neither half, so the install lands code that
 * cannot resolve. Watched live: the agent spent six tool calls discovering
 * that and patching it by hand, and TypeScript and the bundler need telling
 * separately, so half-doing it is the likely outcome.
 */
export function withTsconfigAlias(source: string): string | null {
  let config: { compilerOptions?: Record<string, unknown> };
  try {
    config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));
  } catch {
    return null;
  }
  config.compilerOptions ??= {};
  const options = config.compilerOptions;
  const paths = options.paths as Record<string, string[]> | undefined;
  if (paths?.["@/*"]) return null;
  options.baseUrl ??= ".";
  options.paths = { ...(paths ?? {}), "@/*": ["./src/*"] };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** The vite half. Left alone if anything already aliases `@`. */
export function withViteAlias(source: string): string | null {
  if (/alias\s*:/.test(source) && /["'`]@["'`]\s*:/.test(source)) return null;
  if (!/defineConfig\s*\(\s*\{/.test(source)) return null;
  const withImport = /from ["']node:path["']/.test(source)
    ? source
    : `import path from "node:path";\n${source}`;
  return withImport.replace(
    /(defineConfig\s*\(\s*\{)/,
    "$1\n  // `@/…` means `src/…`, for components that are copied in rather than\n" +
      "  // installed. TypeScript is told the same thing in tsconfig.json.\n" +
      '  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },',
  );
}

/** The `cn` helper every component imports. Written only if absent. */
const CN_HELPER = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge class names, letting a later Tailwind utility beat an earlier one. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

export interface MotionCatalogEntry {
  name: string;
  dependencies: string[];
  hooks: string[];
  lines: number;
}

/** Read once per call — a few KB, and it keeps the tool honest about what exists. */
export async function readCatalog(root = resolveFromRepoRoot("motion-primitives")): Promise<{
  components: MotionCatalogEntry[];
  root: string;
}> {
  const raw = await fs.readFile(path.join(root, "catalog.json"), "utf8");
  return { components: JSON.parse(raw).components as MotionCatalogEntry[], root };
}

/**
 * Everything a set of components needs, resolved.
 *
 * Pure, so the resolution can be tested without a filesystem or a project — and
 * it is the part with the actual logic: three components pull in
 * `react-use-measure`, five need a hook the registry never mentions.
 */
export function resolveInstall(
  wanted: string[],
  catalog: MotionCatalogEntry[],
): { components: MotionCatalogEntry[]; hooks: string[]; packages: string[]; unknown: string[] } {
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  const components: MotionCatalogEntry[] = [];
  const unknown: string[] = [];
  for (const name of [...new Set(wanted)]) {
    const entry = byName.get(name);
    if (entry) components.push(entry);
    else unknown.push(name);
  }
  const hooks = [...new Set(components.flatMap((entry) => entry.hooks))].sort();
  const packages = [
    // Always: every component imports from `motion`, and every component
    // imports `cn`, which is these two.
    "motion",
    "clsx",
    "tailwind-merge",
    ...components.flatMap((entry) => entry.dependencies),
  ];
  return { components, hooks, packages: [...new Set(packages)].sort(), unknown };
}

/** Names that could name a file outside the component directory. */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const schema = z.object({
  components: z
    .array(z.string())
    .min(1)
    .describe(
      'Component names from the catalogue, e.g. ["in-view", "animated-group"]. Install only what ' +
        "the page actually uses.",
    ),
});

export const addMotionTool = defineTool({
  name: "add_motion",
  description:
    "Copy motion components into this project from Zelyq's vendored Motion Primitives set, with " +
    "the hooks and the `cn` helper they need, and add their packages to package.json. Wrappers " +
    "(`in-view`, `animated-group`) animate markup that already exists without changing it and are " +
    "what most pages need; the rest replace an element or decorate a surface. Run `npm install` " +
    "afterwards. Files land in src/components/motion/ — import them from '@/components/motion/<name>'.",
  schema,
  async run(context, input): Promise<ToolResult> {
    for (const name of input.components) {
      if (!NAME_RE.test(name)) {
        return { output: `Not a component name: ${name}`, isError: true };
      }
    }

    let catalog: Awaited<ReturnType<typeof readCatalog>>;
    try {
      catalog = await readCatalog();
    } catch (error) {
      return {
        output: `The vendored component set is missing: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    const plan = resolveInstall(input.components, catalog.components);
    if (plan.unknown.length) {
      const known = catalog.components.map((entry) => entry.name).join(", ");
      return {
        output: `No such component: ${plan.unknown.join(", ")}.\nAvailable: ${known}`,
        isError: true,
      };
    }

    const written: string[] = [];
    for (const entry of plan.components) {
      const source = await fs.readFile(
        path.join(catalog.root, "components", `${entry.name}.tsx`),
        "utf8",
      );
      const target = `${COMPONENT_DIR}/${entry.name}.tsx`;
      await context.runtime.writeFile(context.projectId, target, source);
      context.onFileChanged(target);
      written.push(target);
    }
    for (const hook of plan.hooks) {
      const source = await fs.readFile(path.join(catalog.root, "hooks", `${hook}.tsx`), "utf8");
      const target = `${HOOK_DIR}/${hook}.tsx`;
      await context.runtime.writeFile(context.projectId, target, source);
      context.onFileChanged(target);
      written.push(target);
    }

    // Only if it is not already there — a project may have its own, and
    // overwriting somebody's `cn` because it happens to share a path would be
    // the tool quietly editing code it was not asked about.
    const existingUtils = await context.runtime
      .readFile(context.projectId, UTILS_PATH)
      .catch(() => null);
    if (!existingUtils) {
      await context.runtime.writeFile(context.projectId, UTILS_PATH, CN_HELPER);
      context.onFileChanged(UTILS_PATH);
      written.push(UTILS_PATH);
    }

    const configured = await ensureAlias(context);
    const added = await ensurePackages(context, plan.packages);

    const lines = [`Added ${plan.components.length} component(s) to ${COMPONENT_DIR}/:`];
    for (const entry of plan.components) lines.push(`  ${entry.name}`);
    if (plan.hooks.length) lines.push(`Hooks: ${plan.hooks.join(", ")}`);
    if (configured.length) {
      lines.push(`Configured the \`@/\` import alias in ${configured.join(" and ")}.`);
    }
    if (added.length) {
      lines.push(`package.json: added ${added.join(", ")} — run \`npm install\` before building.`);
    } else {
      lines.push("package.json already had every package these need.");
    }
    lines.push(
      "",
      "Import them as `@/components/motion/<name>`. `in-view` and `animated-group` wrap existing " +
        "markup as children — wrap, do not rewrite.",
    );
    return { output: lines.join("\n") };
  },
});

/** Both halves of the alias, each only if it is not already there. */
async function ensureAlias(context: {
  projectId: string;
  runtime: {
    readFile(projectId: string, path: string): Promise<{ content: string }>;
    writeFile(projectId: string, path: string, content: string): Promise<unknown>;
  };
  onFileChanged(path: string): void;
}): Promise<string[]> {
  const done: string[] = [];
  for (const [file, transform] of [
    ["tsconfig.json", withTsconfigAlias],
    ["vite.config.ts", withViteAlias],
  ] as const) {
    const existing = await context.runtime.readFile(context.projectId, file).catch(() => null);
    if (!existing) continue;
    const next = transform(existing.content);
    if (!next) continue;
    await context.runtime.writeFile(context.projectId, file, next);
    context.onFileChanged(file);
    done.push(file);
  }
  return done;
}

/** Versions pinned here, not read from upstream: these are what was verified. */
const VERSIONS: Record<string, string> = {
  motion: "^13.2.0",
  clsx: "^2.1.1",
  "tailwind-merge": "^2.6.0",
  "react-use-measure": "^2.1.1",
};

interface PackageWriter {
  projectId: string;
  runtime: {
    readFile(projectId: string, path: string): Promise<{ content: string }>;
    writeFile(projectId: string, path: string, content: string): Promise<unknown>;
  };
}

async function ensurePackages(context: PackageWriter, packages: string[]): Promise<string[]> {
  const file = await context.runtime.readFile(context.projectId, "package.json").catch(() => null);
  if (!file) return [];
  let manifest: { dependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(file.content);
  } catch {
    return [];
  }
  const deps = manifest.dependencies ?? {};
  const added: string[] = [];
  for (const name of packages) {
    if (deps[name]) continue;
    deps[name] = VERSIONS[name] ?? "latest";
    added.push(name);
  }
  if (!added.length) return [];
  manifest.dependencies = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)),
  );
  await context.runtime.writeFile(
    context.projectId,
    "package.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return added;
}
