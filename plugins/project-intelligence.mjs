import { z } from "zod";
import { jsonOutput, projectFiles, readJson } from "./lib/shared.mjs";

async function inventory(context, depth) {
  const entries = await projectFiles(context, depth);
  const files = entries.filter((entry) => entry.type !== "directory").map((entry) => entry.path);
  const manifests = {};
  for (const path of [
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "docker-compose.yml",
    "Dockerfile",
  ]) {
    if (files.includes(path))
      manifests[path] = path === "package.json" ? await readJson(context, path) : "present";
  }
  const extensions = {};
  for (const file of files) {
    const match = file.match(/\.([^./]+)$/);
    const key = match?.[1] ?? "none";
    extensions[key] = (extensions[key] ?? 0) + 1;
  }
  return {
    fileCount: files.length,
    directories: entries.filter((e) => e.type === "directory").length,
    manifests,
    extensions,
    sample: files.slice(0, 160),
  };
}

export default [
  {
    name: "analyze_project",
    description:
      "Return a compact, structured inventory of an unfamiliar project: manifests, languages, directories, scripts, and representative files. Use before guessing how a repository is organized.",
    schema: z.object({ depth: z.number().int().min(1).max(16).default(8) }),
    async run(context, input) {
      return jsonOutput(await inventory(context, input.depth));
    },
  },
  {
    name: "dependency_report",
    description:
      "Report JavaScript dependencies and scripts from package.json, grouped by production and development use. Does not install or update anything.",
    schema: z.object({}),
    async run(context) {
      const pkg = await readJson(context, "package.json");
      if (!pkg) return { output: "No readable package.json was found.", isError: true };
      return jsonOutput({
        packageManager: pkg.packageManager,
        engines: pkg.engines,
        scripts: pkg.scripts ?? {},
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
        peerDependencies: pkg.peerDependencies ?? {},
      });
    },
  },
  {
    name: "find_dead_code",
    description:
      "Find likely orphaned source files using import-reference heuristics. Results are leads for review, not proof; dynamic imports and framework entry points can create false positives.",
    schema: z.object({ source_path: z.string().default("src") }),
    async run(context, input) {
      const entries = await context.runtime.listFiles(context.projectId, {
        path: input.source_path,
        depth: 16,
      });
      const candidates = entries.filter(
        (e) => e.type !== "directory" && /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(e.path),
      );
      const contents = [];
      for (const entry of candidates.slice(0, 500)) {
        const file = await context.runtime.readFile(context.projectId, entry.path);
        if (file.encoding === "utf8") contents.push([entry.path, file.content]);
      }
      const allText = contents.map(([, content]) => content).join("\n");
      const likelyOrphans = contents
        .map(([path]) => path)
        .filter((path) => {
          if (/(^|\/)(index|main|app|route|page|layout)\.[^.]+$/i.test(path)) return false;
          const stem = path
            .split("/")
            .pop()
            .replace(/\.[^.]+$/, "");
          return stem.length > 2 && !allText.includes(`/${stem}`) && !allText.includes(`./${stem}`);
        });
      return jsonOutput({
        scanned: contents.length,
        likelyOrphans,
        warning:
          "Heuristic only; verify framework conventions and dynamic imports before deleting.",
      });
    },
  },
  {
    name: "explain_architecture",
    description:
      "Return architecture evidence for the model to explain: project layout, manifests, entry-point candidates, and configuration files. It reports facts rather than inventing design intent.",
    schema: z.object({ depth: z.number().int().min(1).max(16).default(10) }),
    async run(context, input) {
      const data = await inventory(context, input.depth);
      const entryPoints = data.sample.filter((path) =>
        /(^|\/)(main|index|app|server|route)\.[^.]+$/i.test(path),
      );
      const configs = data.sample.filter((path) =>
        /(^|\/)(vite|next|webpack|tsconfig|eslint|biome|docker|compose)/i.test(path),
      );
      return jsonOutput({ ...data, entryPoints, configs });
    },
  },
];
